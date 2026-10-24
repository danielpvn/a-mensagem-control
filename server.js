const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const db = require('./src/db');
const { parseRawSermonText, slugify } = require('./src/sermon-text');
const updater = require('./src/updater');
const { createDesktopShortcut } = require('./src/shortcut');

const CURRENT_VERSION = '1.0.3';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Fontes servidas localmente: o overlay continua bonito mesmo se a internet da igreja cair
['outfit', 'montserrat', 'lora', 'playfair-display'].forEach(name => {
  const dir = path.dirname(require.resolve(`@fontsource/${name}/package.json`));
  app.use(`/fonts/${name}`, express.static(dir));
});

const DEFAULT_MESSAGE_STYLES = {
  fontFamily: 'Outfit, sans-serif',
  fontSize: '2.6rem',
  textColor: '#ffffff',
  titleColor: '#3b82f6',
  titleSize: '1.1rem',
  bgColor: 'rgba(10, 15, 30, 0.85)',
  accentColor: '#2563eb',
  animationType: 'slide-up',
  alignment: 'center',
  showTitle: true,
  showParagraphNumber: true,
  telaoMode: false,
  textOutline: false,
  outlineColor: '#000000'
};

// Estado global do que está no ar (compartilhado entre painel, celular e OBS)
let globalState = {
  activeSermonId: null,
  activeSermonTitle: '',
  activeSermonDate: '',
  paragraphCount: 0,
  currentParagraphIndex: -1,
  currentParagraphText: '',
  currentParagraphNumber: null,
  isCleared: true,
  // "Armado": parágrafo posicionado mas oculto; o próximo "avançar" exibe ele em vez de pular
  armed: false,
  styles: { ...DEFAULT_MESSAGE_STYLES, ...db.getSetting('styles.message', {}) }
};

let activeSermonParagraphs = [];

// WebSocket: Enviar estado atualizado para todos os clientes conectados
function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastContent() {
  broadcast('update-content', globalState);
}

function resetParagraphState() {
  globalState.currentParagraphIndex = -1;
  globalState.currentParagraphText = '';
  globalState.currentParagraphNumber = null;
  globalState.isCleared = true;
  globalState.armed = false;
}

function loadSermonOnServer(id) {
  const sermon = id ? db.getSermon(id) : null;
  activeSermonParagraphs = sermon ? sermon.paragraphs : [];
  globalState.activeSermonId = sermon ? sermon.id : null;
  globalState.activeSermonTitle = sermon ? sermon.title : '';
  globalState.activeSermonDate = sermon ? sermon.date : '';
  globalState.paragraphCount = activeSermonParagraphs.length;
  resetParagraphState();
  broadcastContent();
}

function positionParagraph(index) {
  const p = activeSermonParagraphs[index];
  globalState.currentParagraphIndex = index;
  globalState.currentParagraphText = p.text || '';
  globalState.currentParagraphNumber = p.number ?? null;
}

function setParagraphOnServer(index) {
  if (index < 0 || index >= activeSermonParagraphs.length) return;
  positionParagraph(index);
  globalState.isCleared = false;
  globalState.armed = false;
  db.saveProgress(globalState.activeSermonId, index, globalState.currentParagraphNumber);
  broadcastContent();
}

// Deixa o parágrafo pronto (oculto). Usado no "continuar de onde parou".
function armParagraphOnServer(index) {
  if (index < 0 || index >= activeSermonParagraphs.length) return;
  positionParagraph(index);
  globalState.isCleared = true;
  globalState.armed = true;
  broadcastContent();
}

function nextParagraph() {
  if (activeSermonParagraphs.length === 0) return;
  if (globalState.armed) {
    setParagraphOnServer(globalState.currentParagraphIndex);
    return;
  }
  const nextIndex = globalState.currentParagraphIndex + 1;
  if (nextIndex < activeSermonParagraphs.length) {
    setParagraphOnServer(nextIndex);
  }
}

function prevParagraph() {
  if (activeSermonParagraphs.length === 0) return;
  const prevIndex = globalState.currentParagraphIndex - 1;
  if (prevIndex >= 0) {
    setParagraphOnServer(prevIndex);
  }
}

function toggleClearOnServer() {
  if (globalState.currentParagraphIndex === -1) return;
  if (globalState.isCleared) {
    setParagraphOnServer(globalState.currentParagraphIndex);
  } else {
    globalState.isCleared = true;
    broadcastContent();
  }
}

function clearScreenOnServer() {
  globalState.isCleared = true;
  globalState.armed = false;
  broadcastContent();
}

// Estilos são salvos no banco com um pequeno atraso para não gravar a cada movimento do slider
let saveStylesTimer = null;
function updateStyles(partial) {
  globalState.styles = { ...globalState.styles, ...partial };
  broadcast('update-style', globalState.styles);
  clearTimeout(saveStylesTimer);
  saveStylesTimer = setTimeout(() => db.setSetting('styles.message', globalState.styles), 400);
}

let shutdownTimer = null;

// Modo servidor avulso (sem Electron): desliga quando nenhum painel está aberto
function checkAdminConnections() {
  if (process.versions.electron) return;
  let adminCount = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.isAdmin) {
      adminCount++;
    }
  });

  if (adminCount === 0) {
    if (!shutdownTimer) {
      console.log('Nenhum painel administrativo ativo. Agendando desligamento automático em 10 segundos...');
      shutdownTimer = setTimeout(() => {
        console.log('Desligando o servidor automaticamente (sem painéis ativos).');
        process.exit(0);
      }, 10000);
    }
  } else if (shutdownTimer) {
    console.log('Painel do operador detectado. Cancelando desligamento automático.');
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', payload: globalState }));

  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      const payload = data.payload || {};

      switch (data.type) {
        case 'register-admin':
          ws.isAdmin = true;
          checkAdminConnections();
          break;
        case 'select-sermon':
          loadSermonOnServer(payload.id);
          break;
        case 'show-paragraph':
          setParagraphOnServer(payload.index);
          break;
        case 'arm-paragraph':
          armParagraphOnServer(payload.index);
          break;
        case 'next':
          nextParagraph();
          break;
        case 'prev':
          prevParagraph();
          break;
        case 'toggle-clear':
          toggleClearOnServer();
          break;
        case 'clear-screen':
          clearScreenOnServer();
          break;
        case 'update-styles':
          updateStyles(payload);
          break;
        case 'reset-styles':
          updateStyles(DEFAULT_MESSAGE_STYLES);
          break;
        default:
          console.warn('Tipo de mensagem desconhecido:', data.type);
      }
    } catch (err) {
      console.error('Erro ao processar mensagem do WebSocket:', err);
    }
  });

  ws.on('close', () => {
    setTimeout(checkAdminConnections, 2000);
  });
});

// Endereços para abrir o painel em outro aparelho da mesma rede (celular, notebook)
function getLanUrls() {
  const urls = [];
  Object.values(os.networkInterfaces()).forEach(list => {
    (list || []).forEach(net => {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    });
  });
  return urls;
}

app.get('/api/info', (req, res) => {
  res.json({ version: CURRENT_VERSION, port: PORT, lanUrls: getLanUrls() });
});

// API: Listar sermões disponíveis
app.get('/api/sermons', (req, res) => {
  try {
    res.json(db.listSermons());
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar sermões', details: err.message });
  }
});

// API: Obter sermão por ID (já paginado, com o ponto onde a leitura parou)
app.get('/api/sermons/:id', (req, res) => {
  try {
    const sermon = db.getSermon(req.params.id);
    if (!sermon) {
      return res.status(404).json({ error: 'Sermão não encontrado' });
    }
    res.json(sermon);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter sermão', details: err.message });
  }
});

// API: Excluir sermão por ID
app.delete('/api/sermons/:id', (req, res) => {
  try {
    if (!db.deleteSermon(req.params.id)) {
      return res.status(404).json({ error: 'Sermão não encontrado' });
    }

    // Se o sermão excluído era o ativo, limpa o estado global
    if (globalState.activeSermonId === req.params.id) {
      loadSermonOnServer(null);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir sermão', details: err.message });
  }
});

// API: Importar sermão a partir de texto copiado
app.post('/api/import', (req, res) => {
  const { title, date, rawText, overwrite } = req.body;

  if (!title || !rawText) {
    return res.status(400).json({ error: 'Título e Texto são obrigatórios' });
  }

  const id = slugify(title);
  if (!id) {
    return res.status(400).json({ error: 'O título precisa ter letras ou números' });
  }
  if (!overwrite && db.getSermon(id)) {
    return res.status(409).json({ error: 'Já existe uma mensagem com esse título', id });
  }

  try {
    const paragraphs = parseRawSermonText(rawText);
    db.saveSermon({ id, title, date, paragraphs });
    res.json({ success: true, id, paragraphCount: paragraphs.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar importação', details: err.message });
  }
});

app.get('/api/check-update', async (req, res) => {
  try {
    res.json(await updater.checkForUpdate(CURRENT_VERSION));
  } catch (err) {
    console.error('Erro ao checar atualizações:', err);
    res.json({ updateAvailable: false, currentVersion: CURRENT_VERSION, error: err.message });
  }
});

// A URL do pacote nunca vem do navegador: o updater lê do update.json oficial
app.post('/api/trigger-update', async (req, res) => {
  try {
    const launch = await updater.prepareUpdate(CURRENT_VERSION);
    res.json({ success: true });
    launch();
  } catch (err) {
    console.error('Erro ao processar atualização automática:', err);
    res.status(500).json({ error: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso. O A Mensagem Control já está aberto?`);
  } else {
    console.error('Erro no servidor:', err);
  }
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`-> Painel do Operador: http://localhost:${PORT}/admin.html`);
  console.log(`-> Overlay do OBS: http://localhost:${PORT}/overlay.html`);
  console.log(`-> Banco de dados: ${db.DATA_DIR}`);

  try {
    createDesktopShortcut();
  } catch (err) {
    console.error('Erro na criação automática do atalho:', err);
  }
});

module.exports = {
  PORT,
  nextParagraph,
  prevParagraph,
  toggleClearOnServer
};

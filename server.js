const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const db = require('./src/db');
const { parseRawSermonText, slugify } = require('./src/sermon-text');
const hymns = require('./src/hymns');
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

const DEFAULT_HYMN_STYLES = {
  layout: 'fullscreen',          // 'fullscreen' (tela cheia) ou 'lower-third' (faixa embaixo)
  fontFamily: 'Montserrat, sans-serif',
  fontSize: '4.2rem',
  textColor: '#ffffff',
  accentColor: '#93c5fd',
  bgColor: 'rgba(5, 8, 20, 0.9)',
  uppercase: false,
  showTitle: true,
  showNumber: true,
  titleSize: '1.25rem',
  showLabel: true,
  textOutline: false,
  outlineColor: '#000000',
  animationType: 'fade',
  linesPerSlide: 4
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
  styles: { ...DEFAULT_MESSAGE_STYLES, ...db.getSetting('styles.message', {}) },

  // Qual camada o passador controla: a última que foi para o ar ('message' ou 'hymn')
  activeLayer: 'message',
  hymn: {
    id: null,
    number: null,
    title: '',
    slides: [],
    slideIndex: -1,
    isCleared: true,
    armed: false
  },
  hymnStyles: { ...DEFAULT_HYMN_STYLES, ...db.getSetting('styles.hymn', {}) }
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

// Só um conteúdo no ar por vez: mostrar a Mensagem tira o hino da tela (e vice-versa)
function hideHymn() {
  globalState.hymn.isCleared = true;
  globalState.hymn.armed = false;
}

function hideMessage() {
  globalState.isCleared = true;
  globalState.armed = false;
}

function setParagraphOnServer(index) {
  if (index < 0 || index >= activeSermonParagraphs.length) return;
  positionParagraph(index);
  hideHymn();
  globalState.activeLayer = 'message';
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

// Botão "Limpar tela": tira tudo do ar
function clearScreenOnServer() {
  hideMessage();
  hideHymn();
  broadcastContent();
}

// ---------- Hinos ao vivo ----------

function hymnSlidesFor(id) {
  return hymns.getHymnSlides(id, Number(globalState.hymnStyles.linesPerSlide) || 4);
}

function setHymnState(hymn, slideIndex = -1) {
  globalState.hymn = {
    id: hymn ? hymn.id : null,
    number: hymn ? hymn.number : null,
    title: hymn ? hymn.title : '',
    collection: hymn ? hymn.collection : null,
    slides: hymn ? hymn.slides : [],
    slideIndex,
    isCleared: true,
    armed: false
  };
}

// Abre o hino. Vindo da busca, já deixa pronta (oculta) a tela com o trecho encontrado.
function selectHymnOnServer(id, match) {
  const hymn = id ? hymnSlidesFor(id) : null;
  setHymnState(hymn);
  if (hymn && match && Number.isInteger(match.sectionIndex)) {
    const line = Number(match.lineIndex) || 0;
    const index = hymn.slides.findIndex(s => s.sectionIndex === match.sectionIndex && line >= s.firstLine && line < s.firstLine + s.lineCount);
    if (index !== -1) {
      globalState.hymn.slideIndex = index;
      globalState.hymn.armed = true;
    }
  }
  broadcastContent();
}

function showHymnSlide(index) {
  const hymn = globalState.hymn;
  if (index < 0 || index >= hymn.slides.length) return;
  hymn.slideIndex = index;
  hymn.isCleared = false;
  hymn.armed = false;
  hideMessage();
  globalState.activeLayer = 'hymn';
  broadcastContent();
}

function nextHymnSlide() {
  const hymn = globalState.hymn;
  if (hymn.slides.length === 0) return;
  if (hymn.armed || hymn.slideIndex === -1) {
    showHymnSlide(Math.max(0, hymn.slideIndex));
    return;
  }
  if (hymn.slideIndex + 1 < hymn.slides.length) showHymnSlide(hymn.slideIndex + 1);
}

function prevHymnSlide() {
  const hymn = globalState.hymn;
  if (hymn.slideIndex > 0) showHymnSlide(hymn.slideIndex - 1);
}

function toggleHymn() {
  const hymn = globalState.hymn;
  if (hymn.slideIndex === -1) return;
  if (hymn.isCleared) {
    showHymnSlide(hymn.slideIndex);
  } else {
    hideHymn();
    broadcastContent();
  }
}

// Recarrega as telas do hino aberto (letra editada ou mudança de linhas por tela),
// mantendo a posição na mesma parte da sequência
function refreshActiveHymn() {
  const current = globalState.hymn;
  if (!current.id) return;
  const hymn = hymnSlidesFor(current.id);
  if (!hymn) {
    setHymnState(null);
    broadcastContent();
    return;
  }
  const old = current.slides[current.slideIndex];
  let index = current.slideIndex;
  if (old) {
    const same = hymn.slides.findIndex(s => s.seq === old.seq && old.firstLine >= s.firstLine && old.firstLine < s.firstLine + s.lineCount);
    index = same !== -1 ? same : Math.min(index, hymn.slides.length - 1);
  }
  Object.assign(current, { number: hymn.number, title: hymn.title, collection: hymn.collection, slides: hymn.slides, slideIndex: index });
  broadcastContent();
}

let saveHymnStylesTimer = null;
function updateHymnStyles(partial) {
  const linesChanged = partial.linesPerSlide !== undefined && Number(partial.linesPerSlide) !== Number(globalState.hymnStyles.linesPerSlide);
  globalState.hymnStyles = { ...globalState.hymnStyles, ...partial };
  broadcast('update-hymn-style', globalState.hymnStyles);
  if (linesChanged) refreshActiveHymn();
  clearTimeout(saveHymnStylesTimer);
  saveHymnStylesTimer = setTimeout(() => db.setSetting('styles.hymn', globalState.hymnStyles), 400);
}

// Passador/teclado: o painel diz a aba (mode); o R400 com o app minimizado usa a última camada no ar
function layerFor(mode) {
  return mode === 'hymn' || mode === 'message' ? mode : globalState.activeLayer;
}

function next(mode) {
  if (layerFor(mode) === 'hymn') nextHymnSlide();
  else nextParagraph();
}

function prev(mode) {
  if (layerFor(mode) === 'hymn') prevHymnSlide();
  else prevParagraph();
}

function toggleClear(mode) {
  if (layerFor(mode) === 'hymn') toggleHymn();
  else toggleClearOnServer();
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
          next(payload.mode);
          break;
        case 'prev':
          prev(payload.mode);
          break;
        case 'toggle-clear':
          toggleClear(payload.mode);
          break;
        case 'hymn-select':
          selectHymnOnServer(payload.id, payload.match);
          break;
        case 'hymn-show':
          showHymnSlide(payload.index);
          break;
        case 'update-hymn-styles':
          updateHymnStyles(payload);
          break;
        case 'reset-hymn-styles':
          updateHymnStyles(DEFAULT_HYMN_STYLES);
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

// ---------- API de hinos ----------

app.get('/api/hymns', (req, res) => {
  res.json(hymns.listHymns(req.query.category || null));
});

app.get('/api/hymns/categories', (req, res) => {
  res.json(hymns.listCategories());
});

app.get('/api/hymns/search', (req, res) => {
  res.json(hymns.search(req.query.q, Number(req.query.limit) || 12, req.query.category || null));
});

app.get('/api/hymns/:id', (req, res) => {
  const hymn = hymns.getHymn(Number(req.params.id));
  if (!hymn) return res.status(404).json({ error: 'Hino não encontrado' });
  res.json(hymn);
});

app.post('/api/hymns', (req, res) => {
  try {
    res.json({ success: true, id: hymns.createHymn(req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/hymns/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!hymns.updateHymn(id, req.body)) return res.status(404).json({ error: 'Hino não encontrado' });
    if (globalState.hymn.id === id) refreshActiveHymn();
    res.json({ success: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/hymns/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!hymns.deleteHymn(id)) return res.status(404).json({ error: 'Hino não encontrado' });
  if (globalState.hymn.id === id) {
    setHymnState(null);
    broadcastContent();
  }
  res.json({ success: true });
});

app.post('/api/hymns/import', (req, res) => {
  const list = Array.isArray(req.body.hymns) ? req.body.hymns : [];
  if (list.length === 0) return res.status(400).json({ error: 'Nenhum hino para importar' });
  res.json({ success: true, ...hymns.importHymns(list) });
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
  next,
  prev,
  toggleClear
};

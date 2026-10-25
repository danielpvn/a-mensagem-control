const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const db = require('./src/db');
const { parseRawSermonText, slugify } = require('./src/sermon-text');
const hymns = require('./src/hymns');
const bible = require('./src/bible');
const backgrounds = require('./src/backgrounds');

// Primeira vez neste PC: traz a Bíblia e os fundos da pasta da igreja, se existirem
bible.autoImport();
backgrounds.autoImport();
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
['outfit', 'montserrat', 'lora', 'playfair-display', 'crimson-pro'].forEach(name => {
  const dir = path.dirname(require.resolve(`@fontsource/${name}/package.json`));
  app.use(`/fonts/${name}`, express.static(dir));
});

app.use('/backgrounds', express.static(backgrounds.DIR));

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
  linesPerSlide: 4,
  bgImage: null,                 // '/backgrounds/arquivo.jpg' ou null
  position: 'center',            // tela cheia: texto no 'center' ou 'bottom'
  bgMode: 'color',               // 'color', 'gradient' ou 'image'
  gradientFrom: '#1a0b2e',
  gradientTo: '#5b2a86',
  gradientAngle: 135,
  gradientKind: 'linear',        // 'linear' ou 'radial'
  gradientOpacity: 1,
  gradientAnimate: false,
  bgVignette: false
};

// Padrão baseado nos presets que a igreja já usava (Crimson Pro, versículo branco, referência amarela)
const DEFAULT_BIBLE_STYLES = {
  layout: 'fullscreen',
  fontFamily: "'Crimson Pro', serif",
  fontSize: '4.4rem',
  bold: true,
  textColor: '#ffffff',
  refColor: '#ffeb07',
  refSize: '1.8rem',
  showRef: true,
  refPosition: 'bottom',         // 'top' ou 'bottom'
  showVersion: false,            // " (ACF)" depois da referência
  textAlign: 'center',           // 'center', 'justify' ou 'left'
  bgColor: 'rgba(0, 0, 0, 1)',
  bgImage: null,
  position: 'center',
  bgMode: 'gradient',
  gradientFrom: '#0f2027',
  gradientTo: '#2c5364',
  gradientAngle: 135,
  gradientKind: 'linear',
  gradientOpacity: 1,
  gradientAnimate: false,
  bgVignette: true,
  textShadow: true,
  animationType: 'fade'
};

// Estilos salvos antes de existir o degradê não têm `bgMode`: mantém o fundo que a pessoa
// já usava (imagem ou cor) em vez de trocar pelo degradê padrão
function loadScreenStyles(key, defaults) {
  const saved = db.getSetting(key, {});
  if (Object.keys(saved).length && !saved.bgMode) saved.bgMode = saved.bgImage ? 'image' : 'color';
  return { ...defaults, ...saved };
}

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
  hymnStyles: loadScreenStyles('styles.hymn', DEFAULT_HYMN_STYLES),

  // Bíblia: capítulo aberto, dividido em telas (versículos longos vêm em mais de uma tela)
  bible: {
    book: null,
    bookName: '',
    chapter: null,
    chapters: 0,
    slides: [],
    slideIndex: -1,
    isCleared: true,
    armed: false
  },
  bibleStyles: loadScreenStyles('styles.bible', DEFAULT_BIBLE_STYLES)
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

function hideBible() {
  globalState.bible.isCleared = true;
  globalState.bible.armed = false;
}

function setParagraphOnServer(index) {
  if (index < 0 || index >= activeSermonParagraphs.length) return;
  positionParagraph(index);
  hideHymn();
  hideBible();
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
  hideBible();
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
  hideBible();
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

// ---------- Bíblia ao vivo ----------

// Cada versículo vira uma ou mais telas (as quebras já vêm da pasta da Bíblia)
// Cada versículo é uma tela só. Só divide os enormes, que não caberiam nem diminuindo a letra:
// acima de ~450 caracteres na tela cheia, ou ~230 quando o espaço é menor (faixa ou texto embaixo).
// Quando divide, usa os pontos de quebra que a pasta da igreja já marca.
function verseCharLimit(styles) {
  return styles.layout === 'lower-third' || styles.position === 'bottom' ? 230 : 450;
}

function bibleSlides(chapter) {
  const limit = verseCharLimit(globalState.bibleStyles);
  const slides = [];
  chapter.verses.forEach(v => {
    const pieces = v.text.split('\n').filter(Boolean);
    const screens = [];
    pieces.forEach(piece => {
      const last = screens[screens.length - 1];
      if (last !== undefined && `${last} ${piece}`.length <= limit) screens[screens.length - 1] = `${last} ${piece}`;
      else screens.push(piece);
    });
    screens.forEach((text, i) => slides.push({ verse: v.verse, part: i + 1, parts: screens.length, text }));
  });
  return slides;
}

// Abre o capítulo. Com versículo, deixa ele pronto (oculto) para o próximo "avançar".
function loadBibleChapter(book, chapterNumber) {
  const chapter = bible.getChapter(book, chapterNumber);
  if (!chapter) return false;
  globalState.bible = {
    book,
    bookName: chapter.bookName,
    chapter: chapterNumber,
    chapters: chapter.chapters,
    slides: bibleSlides(chapter),
    slideIndex: -1,
    isCleared: true,
    armed: false
  };
  return true;
}

function selectBibleOnServer(book, chapter, verse) {
  if (!loadBibleChapter(Number(book), Number(chapter))) return;
  if (verse) {
    const index = globalState.bible.slides.findIndex(s => s.verse === Number(verse));
    if (index !== -1) {
      globalState.bible.slideIndex = index;
      globalState.bible.armed = true;
    }
  }
  broadcastContent();
}

function showBibleSlide(index) {
  const b = globalState.bible;
  if (index < 0 || index >= b.slides.length) return;
  b.slideIndex = index;
  b.isCleared = false;
  b.armed = false;
  hideMessage();
  hideHymn();
  globalState.activeLayer = 'bible';
  broadcastContent();
}

// No fim do capítulo, segue para o próximo (o pastor pode ler um trecho que atravessa capítulos)
function nextBibleSlide() {
  const b = globalState.bible;
  if (b.slides.length === 0) return;
  if (b.armed || b.slideIndex === -1) {
    showBibleSlide(Math.max(0, b.slideIndex));
  } else if (b.slideIndex + 1 < b.slides.length) {
    showBibleSlide(b.slideIndex + 1);
  } else if (b.chapter < b.chapters && loadBibleChapter(b.book, b.chapter + 1)) {
    showBibleSlide(0);
  }
}

function prevBibleSlide() {
  const b = globalState.bible;
  if (b.slideIndex > 0) {
    showBibleSlide(b.slideIndex - 1);
  } else if (b.slideIndex === 0 && b.chapter > 1 && loadBibleChapter(b.book, b.chapter - 1)) {
    showBibleSlide(globalState.bible.slides.length - 1);
  }
}

function toggleBible() {
  const b = globalState.bible;
  if (b.slideIndex === -1) return;
  if (b.isCleared) {
    showBibleSlide(b.slideIndex);
  } else {
    hideBible();
    broadcastContent();
  }
}

let saveBibleStylesTimer = null;
// Recalcula as telas do capítulo aberto (o limite muda com o formato), mantendo o versículo
function refreshBibleSlides() {
  const b = globalState.bible;
  if (!b.book) return;
  const current = b.slides[b.slideIndex];
  const chapter = bible.getChapter(b.book, b.chapter);
  if (!chapter) return;
  b.slides = bibleSlides(chapter);
  if (current) {
    const index = b.slides.findIndex(sl => sl.verse === current.verse);
    b.slideIndex = index === -1 ? Math.min(b.slideIndex, b.slides.length - 1) : index;
  }
  broadcastContent();
}

function updateBibleStyles(partial) {
  const oldLimit = verseCharLimit(globalState.bibleStyles);
  globalState.bibleStyles = { ...globalState.bibleStyles, ...partial };
  broadcast('update-bible-style', globalState.bibleStyles);
  if (verseCharLimit(globalState.bibleStyles) !== oldLimit) refreshBibleSlides();
  clearTimeout(saveBibleStylesTimer);
  saveBibleStylesTimer = setTimeout(() => db.setSetting('styles.bible', globalState.bibleStyles), 400);
}

// Passador/teclado: o painel diz a aba (mode); o R400 com o app minimizado usa a última camada no ar
function layerFor(mode) {
  return ['message', 'hymn', 'bible'].includes(mode) ? mode : globalState.activeLayer;
}

function next(mode) {
  const layer = layerFor(mode);
  if (layer === 'hymn') nextHymnSlide();
  else if (layer === 'bible') nextBibleSlide();
  else nextParagraph();
}

function prev(mode) {
  const layer = layerFor(mode);
  if (layer === 'hymn') prevHymnSlide();
  else if (layer === 'bible') prevBibleSlide();
  else prevParagraph();
}

function toggleClear(mode) {
  const layer = layerFor(mode);
  if (layer === 'hymn') toggleHymn();
  else if (layer === 'bible') toggleBible();
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
        case 'bible-select':
          selectBibleOnServer(payload.book, payload.chapter, payload.verse);
          break;
        case 'bible-show':
          showBibleSlide(payload.index);
          break;
        case 'update-bible-styles':
          updateBibleStyles(payload);
          break;
        case 'reset-bible-styles':
          updateBibleStyles(DEFAULT_BIBLE_STYLES);
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

// ---------- API da Bíblia ----------

app.get('/api/bible/books', (req, res) => {
  res.json({ verses: bible.verseCount(), folder: bible.DEFAULT_FOLDER, books: bible.listBooks() });
});

app.get('/api/bible/search', (req, res) => {
  res.json(bible.search(req.query.q, Number(req.query.limit) || 30));
});

app.get('/api/bible/chapter/:book/:chapter', (req, res) => {
  const chapter = bible.getChapter(Number(req.params.book), Number(req.params.chapter));
  if (!chapter) return res.status(404).json({ error: 'Capítulo não encontrado' });
  res.json(chapter);
});

// Importação pelo painel: [{ path, text }] lidos da pasta "2 Biblia_ACF"
app.post('/api/bible/import', (req, res) => {
  try {
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    res.json({ success: true, ...bible.importBible(files) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API de imagens de fundo ----------

app.get('/api/backgrounds', (req, res) => {
  res.json(backgrounds.list());
});

app.post('/api/backgrounds', express.raw({ type: 'image/*', limit: '25mb' }), (req, res) => {
  try {
    res.json({ success: true, ...backgrounds.save(req.query.name, req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/backgrounds/:name', (req, res) => {
  try {
    if (!backgrounds.remove(req.params.name)) return res.status(404).json({ error: 'Imagem não encontrada' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
  next,
  prev,
  toggleClear
};

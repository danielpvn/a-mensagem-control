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
const media = require('./src/media');
const auth = require('./src/auth');
const sync = require('./src/sync');

// Primeira vez neste PC: traz a Bíblia e os fundos da pasta da igreja, se existirem
bible.autoImport();
backgrounds.autoImport();
const updater = require('./src/updater');
const tfSermons = require('./src/tf-sermons');
const sounds = require('./src/sounds');
const { createDesktopShortcut } = require('./src/shortcut');

const CURRENT_VERSION = '2.1.0';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// PIN: protege o painel e a API quando acessados de outro aparelho (antes dos arquivos estáticos)
app.use(auth.middleware);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Fontes servidas localmente: o overlay continua bonito mesmo se a internet da igreja cair
['outfit', 'montserrat', 'lora', 'playfair-display', 'crimson-pro'].forEach(name => {
  const dir = path.dirname(require.resolve(`@fontsource/${name}/package.json`));
  app.use(`/fonts/${name}`, express.static(dir));
});

app.use('/backgrounds', express.static(backgrounds.DIR));
app.use('/media', express.static(media.DIR));
app.use('/sounds', express.static(sounds.DIR));

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
  transitionTime: 0.4,           // segundos da troca de tela
  chorusColorOn: false,          // coro com cor própria
  chorusColor: '#fde68a',
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
  animationType: 'fade',
  transitionTime: 0.4
};

const DEFAULT_MEDIA_STYLES = {
  transition: 'crossfade',       // 'crossfade', 'fade-black', 'cut', 'slide', 'zoom'
  duration: 0.6,                 // segundos
  fit: 'blur',                   // 'blur' (inteira, laterais com a própria foto desfocada), 'contain' (inteira, com bordas) ou 'cover' (preenche a tela)
  focus: 'center',               // ao preencher: parte que aparece ('top', 'center', 'bottom')
  bgColor: '#000000',            // cor das bordas
  endAction: 'clear',            // fim do vídeo: 'clear' (tira da tela) ou 'hold' (fica no último quadro)
  audioOutput: 'obs'             // som dos vídeos: 'obs' (sai onde o link do OBS está aberto) ou 'app' (sai neste computador)
};

// Nome do pregador (lower third)
const DEFAULT_LT_STYLES = {
  position: 'bottom-left',       // 'bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-right'
  look: 'modern',                // 'modern' (barra colorida), 'minimal' (só texto e linha), 'solid' (faixa sólida)
  fontFamily: 'Montserrat, sans-serif',
  scale: 1,
  nameColor: '#ffffff',
  subtitleColor: '#cbd5e1',
  accentColor: '#3b82f6',
  bgColor: 'rgba(10, 15, 30, 0.85)',
  animation: 'slide',            // 'slide', 'rise', 'drop', 'fade', 'zoom', 'blur', 'reveal', 'expand', 'flip', 'stagger'
  speed: 1,                      // multiplicador da duração (0.6 rápida, 1 normal, 1.7 lenta)
  autoHide: 8                    // segundos; 0 = só esconde quando o operador mandar
};

// Louvor especial (fora do hinário): mesma faixa do pregador, com o seu próprio visual
const DEFAULT_SPECIAL_STYLES = {
  ...DEFAULT_LT_STYLES,
  position: 'bottom-left',
  accentColor: '#f2b632',
  subtitleColor: '#fde68a',
  autoHide: 10
};

// Anúncio da leitura bíblica (Bíblia aberta com a faixa da passagem, embaixo no meio)
const DEFAULT_READING_STYLES = {
  // 'photo' (faixa com a Bíblia e a luz), 'full' (tela cheia com a Bíblia), 'bible3d' (Bíblia 3D com faixa),
  // 'card' (cartão escuro), 'light' (faixa clara), 'line' (só texto e linha)
  look: 'photo',
  label: 'LEITURA BÍBLICA',      // texto pequeno em cima da passagem (não aparece na Bíblia 3D)
  fontFamily: 'Montserrat, sans-serif',
  scale: 1,                      // tamanho do conjunto
  textColor: '#ffffff',          // passagem
  bandColor: '#11151c',          // faixa / fundo (nos estilos que têm)
  borderColor: '#9cc7ff',        // borda, ícone, linha e texto de cima
  autoHide: 0                   // segundos; 0 = só esconde quando o operador mandar
};

// Pedidos de oração (tela cheia com os nomes)
const DEFAULT_PRAYER_STYLES = {
  fontFamily: 'Montserrat, sans-serif',
  scale: 1,                      // tamanho dos nomes (a letra ainda diminui sozinha se não couber)
  nameColor: '#ffffff',
  titleColor: '#f2b632',
  accentColor: '#f2b632',        // linhas de enfeite
  bgColor: '#333333',
  bgImage: null,
  decor: true
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
  // Clicar num parágrafo só prepara: com a Mensagem no ar, o escolhido fica em "cue" até o Exibir
  cue: -1,
  // O que está no ar de verdade (fica igual enquanto o operador navega por outra mensagem)
  messageAir: null,
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
    armed: false,
    cue: -1,
    air: null
  },
  hymnStyles: loadScreenStyles('styles.hymn', DEFAULT_HYMN_STYLES),
  // Lista de hinos que vão ser cantados no culto (na ordem)
  hymnPlaylist: db.getSetting('hymnPlaylist', []),

  // Bíblia: capítulo aberto, dividido em telas (versículos longos vêm em mais de uma tela)
  bible: {
    book: null,
    bookName: '',
    chapter: null,
    chapters: 0,
    slides: [],
    slideIndex: -1,
    isCleared: true,
    armed: false,
    cue: -1,
    air: null
  },
  bibleStyles: loadScreenStyles('styles.bible', DEFAULT_BIBLE_STYLES),

  // Mídia: a pasta do culto aberta e o item no ar
  media: {
    folder: null,
    items: [],
    index: -1,
    isCleared: true,
    armed: false,
    // start: segundo em que o vídeo começa; seek: pulo pedido no meio do vídeo (id muda a cada pulo)
    playback: { playing: true, muted: false, volume: 1, loop: false, token: 0, start: 0, seek: { time: 0, id: 0 } },
    // Zoom do item no ar: scale 1 = sem zoom; x/y = ponto (em %) que fica no centro da tela
    zoom: { scale: 1, x: 50, y: 50 },
    // Zoom preparado para cada arquivo da pasta (o operador ajusta antes do culto)
    zooms: {},
    // Ponto de início de cada vídeo (segundos), também preparado antes do culto
    starts: {}
  },
  mediaStyles: { ...DEFAULT_MEDIA_STYLES, ...db.getSetting('styles.media', {}) },

  // Nome do pregador: camada independente, pode aparecer junto com qualquer conteúdo
  // kind: 'preacher' (nome do pregador) ou 'special' (louvor especial, com o visual de specialStyles)
  lowerThird: { visible: false, name: '', subtitle: '', kind: 'preacher', token: 0 },
  lowerThirdStyles: { ...DEFAULT_LT_STYLES, ...db.getSetting('styles.lowerThird', {}) },
  specialStyles: { ...DEFAULT_SPECIAL_STYLES, ...db.getSetting('styles.special', {}) },
  // Leitura bíblica do culto (vai embaixo do nome do pregador)
  serviceReading: db.getSetting('serviceReading', ''),
  // Anúncio da leitura no telão (usa o texto de serviceReading)
  readingAnnounce: { visible: false, token: 0 },
  readingStyles: { ...DEFAULT_READING_STYLES, ...db.getSetting('styles.reading', {}) },

  // Pedidos de oração: os nomes ficam guardados até alguém limpar
  prayer: { visible: false, title: 'Pedidos de oração', names: [], ...db.getSetting('prayer', {}), visible: false },
  prayerStyles: { ...DEFAULT_PRAYER_STYLES, ...db.getSetting('styles.prayer', {}) },

  // Agendamentos (sino antes do culto, vídeos...): o som sai neste computador (janela do programa) ou no OBS
  soundSchedules: sounds.loadSchedules(),
  soundPlaylists: sounds.loadPlaylists(),
  soundOutput: db.getSetting('soundOutput', 'app') === 'obs' ? 'obs' : 'app',
  // O que está tocando agora (som, som com imagem ou vídeo; o overlay mostra a imagem/vídeo por cima de tudo):
  // { id, kind, name, url, image, label, volume, output, transition, transitionTime, startedAt, playlist: { name, index, total } | null }
  soundNow: null
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
  globalState.cue = -1;
  globalState.messageAir = null;
}

function loadSermonOnServer(id) {
  const sermon = id ? db.getSermon(id) : null;
  activeSermonParagraphs = sermon ? sermon.paragraphs : [];
  globalState.activeSermonId = sermon ? sermon.id : null;
  globalState.activeSermonTitle = sermon ? sermon.title : '';
  globalState.activeSermonDate = sermon ? sermon.date : '';
  globalState.paragraphCount = activeSermonParagraphs.length;
  if (globalState.isCleared) {
    resetParagraphState();
  } else {
    // A Mensagem no ar continua na tela até o operador exibir outra coisa
    globalState.currentParagraphIndex = -1;
    globalState.armed = false;
    globalState.cue = -1;
  }
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
  globalState.hymn.cue = -1;
  globalState.hymn.air = null;
}

function hideMessage() {
  globalState.isCleared = true;
  globalState.armed = false;
  globalState.cue = -1;
  globalState.messageAir = null;
}

function hideBible() {
  globalState.bible.isCleared = true;
  globalState.bible.armed = false;
  globalState.bible.cue = -1;
  globalState.bible.air = null;
}

function hideMedia() {
  globalState.media.isCleared = true;
  globalState.media.armed = false;
}

function hidePrayer() {
  globalState.prayer.visible = false;
}

function setParagraphOnServer(index) {
  if (index < 0 || index >= activeSermonParagraphs.length) return;
  positionParagraph(index);
  hideHymn();
  hideBible();
  hideMedia();
  hidePrayer();
  globalState.activeLayer = 'message';
  globalState.isCleared = false;
  globalState.armed = false;
  globalState.cue = -1;
  globalState.messageAir = {
    title: globalState.activeSermonTitle,
    number: globalState.currentParagraphNumber,
    text: globalState.currentParagraphText
  };
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

// Clique num parágrafo: só prepara. Sem nada no ar, fica "pronto"; com a Mensagem no ar,
// o que está na tela continua e o escolhido espera o Exibir (ou o Próximo)
function cueParagraphOnServer(index) {
  if (index < 0 || index >= activeSermonParagraphs.length) return;
  if (globalState.isCleared) {
    positionParagraph(index);
    globalState.armed = true;
    globalState.cue = -1;
  } else {
    globalState.cue = index === globalState.currentParagraphIndex ? -1 : index;
  }
  broadcastContent();
}

function nextParagraph() {
  if (activeSermonParagraphs.length === 0) return;
  if (globalState.cue !== -1) {
    setParagraphOnServer(globalState.cue);
    return;
  }
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

// Exibir/Ocultar: o preparado entra no ar; sem preparado, alterna o que está na tela
function toggleClearOnServer() {
  if (globalState.cue !== -1) {
    setParagraphOnServer(globalState.cue);
  } else if (!globalState.isCleared) {
    hideMessage();
    broadcastContent();
  } else if (globalState.currentParagraphIndex !== -1) {
    setParagraphOnServer(globalState.currentParagraphIndex);
  }
}

// Botão "Limpar tela": tira tudo do ar
function clearScreenOnServer() {
  hideMessage();
  hideHymn();
  hideBible();
  hideMedia();
  hidePrayer();
  hideLowerThird(false);
  hideReading(false);
  // Vídeo ou som com imagem também saem (som sozinho continua tocando)
  const now = globalState.soundNow;
  if (now && (now.kind === 'video' || now.image)) stopSoundRun(false);
  broadcastContent();
}

// ---------- Hinos ao vivo ----------

function hymnSlidesFor(id) {
  return hymns.getHymnSlides(id, Number(globalState.hymnStyles.linesPerSlide) || 4);
}

// Abrir outro hino não mexe na tela: o que está no ar (air) continua até o Exibir
function setHymnState(hymn, slideIndex = -1) {
  const previous = globalState.hymn;
  const live = previous && !previous.isCleared && previous.air;
  globalState.hymn = {
    id: hymn ? hymn.id : null,
    number: hymn ? hymn.number : null,
    title: hymn ? hymn.title : '',
    collection: hymn ? hymn.collection : null,
    slides: hymn ? hymn.slides : [],
    slideIndex,
    isCleared: !live,
    armed: false,
    cue: -1,
    air: live ? previous.air : null
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
      if (globalState.hymn.isCleared) {
        globalState.hymn.slideIndex = index;
        globalState.hymn.armed = true;
      } else {
        globalState.hymn.cue = index;
      }
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
  hymn.cue = -1;
  hymn.air = { id: hymn.id, number: hymn.number, title: hymn.title, collection: hymn.collection, slide: hymn.slides[index] };
  hideMessage();
  hideBible();
  hideMedia();
  hidePrayer();
  globalState.activeLayer = 'hymn';
  broadcastContent();
}

// Clique numa tela do hino: só prepara (mesma regra dos parágrafos)
function cueHymnSlide(index) {
  const hymn = globalState.hymn;
  if (index < 0 || index >= hymn.slides.length) return;
  if (hymn.isCleared) {
    hymn.slideIndex = index;
    hymn.armed = true;
    hymn.cue = -1;
  } else {
    hymn.cue = index === hymn.slideIndex ? -1 : index;
  }
  broadcastContent();
}

function nextHymnSlide() {
  const hymn = globalState.hymn;
  if (hymn.slides.length === 0) return;
  if (hymn.cue !== -1) {
    showHymnSlide(hymn.cue);
    return;
  }
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
  if (hymn.cue !== -1) {
    showHymnSlide(hymn.cue);
  } else if (!hymn.isCleared) {
    hideHymn();
    broadcastContent();
  } else if (hymn.slideIndex !== -1) {
    showHymnSlide(hymn.slideIndex);
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

// Lista do culto: guarda só o necessário para mostrar e abrir cada hino
function setHymnPlaylist(items) {
  const seen = new Set();
  globalState.hymnPlaylist = (Array.isArray(items) ? items : [])
    .map(h => ({ id: Number(h && h.id), number: h.number ? String(h.number) : '', title: String((h && h.title) || ''), collection: h.collection ? String(h.collection) : '' }))
    .filter(h => Number.isInteger(h.id) && h.id > 0 && !seen.has(h.id) && seen.add(h.id))
    .slice(0, 60);
  db.setSetting('hymnPlaylist', globalState.hymnPlaylist);
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
  // Abrir outro capítulo não mexe na tela: o versículo no ar (air) continua até o Exibir
  const previous = globalState.bible;
  const live = !previous.isCleared && previous.air;
  const same = previous.book === book && previous.chapter === chapterNumber;
  globalState.bible = {
    book,
    bookName: chapter.bookName,
    chapter: chapterNumber,
    chapters: chapter.chapters,
    slides: bibleSlides(chapter),
    slideIndex: live && same ? previous.slideIndex : -1,
    isCleared: !live,
    armed: false,
    cue: -1,
    air: live ? previous.air : null
  };
  return true;
}

function selectBibleOnServer(book, chapter, verse) {
  if (!loadBibleChapter(Number(book), Number(chapter))) return;
  if (verse) {
    const b = globalState.bible;
    const index = b.slides.findIndex(s => s.verse === Number(verse));
    if (index !== -1) {
      if (b.isCleared) {
        b.slideIndex = index;
        b.armed = true;
      } else if (index !== b.slideIndex) {
        b.cue = index;
      }
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
  b.cue = -1;
  b.air = { book: b.book, bookName: b.bookName, chapter: b.chapter, slide: b.slides[index] };
  hideMessage();
  hideHymn();
  hideMedia();
  hidePrayer();
  globalState.activeLayer = 'bible';
  broadcastContent();
}

// No fim do capítulo, segue para o próximo (o pastor pode ler um trecho que atravessa capítulos)
// Clique num versículo: só prepara (mesma regra dos parágrafos)
function cueBibleSlide(index) {
  const b = globalState.bible;
  if (index < 0 || index >= b.slides.length) return;
  if (b.isCleared) {
    b.slideIndex = index;
    b.armed = true;
    b.cue = -1;
  } else {
    b.cue = index === b.slideIndex ? -1 : index;
  }
  broadcastContent();
}

function nextBibleSlide() {
  const b = globalState.bible;
  if (b.slides.length === 0) return;
  if (b.cue !== -1) {
    showBibleSlide(b.cue);
    return;
  }
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
  if (b.cue !== -1) {
    showBibleSlide(b.cue);
  } else if (!b.isCleared) {
    hideBible();
    broadcastContent();
  } else if (b.slideIndex !== -1) {
    showBibleSlide(b.slideIndex);
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

// ---------- Mídia ao vivo ----------

const NO_ZOOM = { scale: 1, x: 50, y: 50 };

// Zoom válido: até 6x, e o ponto central limitado para a imagem não "sair" da tela
function cleanZoom(zoom) {
  const scale = Math.min(6, Math.max(1, Number(zoom && zoom.scale) || 1));
  const limit = 50 - 50 / scale; // quanto o centro pode se afastar do meio sem mostrar borda
  const clamp = (v) => Math.min(50 + limit, Math.max(50 - limit, Number.isFinite(Number(v)) ? Number(v) : 50));
  return { scale: Math.round(scale * 100) / 100, x: Math.round(clamp(zoom && zoom.x) * 10) / 10, y: Math.round(clamp(zoom && zoom.y) * 10) / 10 };
}

const zoomKey = (folder, name) => `${folder}/${name}`;
const savedZooms = () => db.getSetting('mediaZooms', {});

// Ajustes preparados da pasta aberta (zoom, início do vídeo), guardados no banco por "pasta/arquivo"
function settingsFor(key, folder) {
  const all = db.getSetting(key, {});
  const result = {};
  Object.keys(all).forEach(k => {
    if (k.startsWith(`${folder}/`)) result[k.slice(folder.length + 1)] = all[k];
  });
  return result;
}
const zoomsFor = (folder) => settingsFor('mediaZooms', folder);

// O que o painel e o overlay precisam de cada item
const mediaItemsFor = (folder) => media.listItems(folder).map(({ name, type, url, videoId, title, thumb }) => ({ name, type, url, videoId, title, thumb }));

// Ponto de início de um vídeo (0 = do começo)
function setMediaStart({ name, start }) {
  const m = globalState.media;
  if (!m.folder || !name) return;
  const seconds = Math.max(0, Math.round((Number(start) || 0) * 10) / 10);
  const all = db.getSetting('mediaStarts', {});
  if (seconds > 0) {
    all[zoomKey(m.folder, name)] = seconds;
    m.starts[name] = seconds;
  } else {
    delete all[zoomKey(m.folder, name)];
    delete m.starts[name];
  }
  db.setSetting('mediaStarts', all);
  broadcastContent();
}

// Nova ordem da pasta aberta (o operador arrastou as mídias)
function setMediaOrder(names) {
  const m = globalState.media;
  if (!m.folder) return;
  media.setOrder(m.folder, names);
  refreshMediaItems(m.folder);
}

// Ajusta o zoom de um arquivo. Se ele estiver no ar, o OBS aproxima na hora (com movimento suave).
function setMediaZoom({ name, zoom }) {
  const m = globalState.media;
  if (!m.folder || !name) return;
  const clean = cleanZoom(zoom);
  const all = savedZooms();
  if (clean.scale === 1) {
    delete all[zoomKey(m.folder, name)];
    delete m.zooms[name];
  } else {
    all[zoomKey(m.folder, name)] = clean;
    m.zooms[name] = clean;
  }
  db.setSetting('mediaZooms', all);
  const live = m.items[m.index];
  if (live && live.name === name && !m.isCleared) m.zoom = clean;
  broadcastContent();
}

function openMediaFolder(folder) {
  const m = globalState.media;
  m.folder = folder || null;
  m.zooms = folder ? zoomsFor(folder) : {};
  m.starts = folder ? settingsFor('mediaStarts', folder) : {};
  m.items = folder ? mediaItemsFor(folder) : [];
  m.index = -1;
  m.isCleared = true;
  m.armed = false;
  broadcastContent();
}

// Arquivos enviados/apagados na pasta aberta: atualiza a lista mantendo o item atual
function refreshMediaItems(folder) {
  const m = globalState.media;
  if (m.folder !== folder) return;
  const current = m.items[m.index];
  m.items = mediaItemsFor(folder);
  if (current) {
    const index = m.items.findIndex(i => i.name === current.name);
    if (index === -1) {
      m.index = -1;
      hideMedia();
    } else {
      m.index = index;
    }
  }
  broadcastContent();
}

function showMediaItem(index) {
  const m = globalState.media;
  if (index < 0 || index >= m.items.length) return;
  m.index = index;
  m.isCleared = false;
  m.armed = false;
  // Entra com o zoom que foi preparado para ele (ou sem zoom)
  m.zoom = m.zooms[m.items[index].name] || NO_ZOOM;
  // Cada vez que vai ao ar o vídeo começa tocando, do ponto de início preparado (ou do começo)
  m.playback = { ...m.playback, playing: true, token: m.playback.token + 1, start: m.starts[m.items[index].name] || 0 };
  hideMessage();
  hideHymn();
  hideBible();
  hidePrayer();
  globalState.activeLayer = 'media';
  broadcastContent();
}

function armMediaItem(index) {
  const m = globalState.media;
  if (index < 0 || index >= m.items.length) return;
  m.index = index;
  m.isCleared = true;
  m.armed = true;
  broadcastContent();
}

function nextMediaItem() {
  const m = globalState.media;
  if (m.items.length === 0) return;
  if (m.armed || m.index === -1) showMediaItem(Math.max(0, m.index));
  else if (m.index + 1 < m.items.length) showMediaItem(m.index + 1);
}

function prevMediaItem() {
  const m = globalState.media;
  if (m.index > 0) showMediaItem(m.index - 1);
}

function toggleMedia() {
  const m = globalState.media;
  if (m.index === -1) return;
  if (m.isCleared) showMediaItem(m.index);
  else {
    hideMedia();
    broadcastContent();
  }
}

// Tocar/pausar, recomeçar, som e repetir (vale para o vídeo no ar)
function controlMedia({ action, value }) {
  const p = globalState.media.playback;
  if (action === 'play') p.playing = true;
  else if (action === 'pause') p.playing = false;
  else if (action === 'restart') { p.playing = true; p.token++; }
  else if (action === 'seek') p.seek = { time: Math.max(0, Number(value) || 0), id: (p.seek ? p.seek.id : 0) + 1 };
  else if (action === 'mute') p.muted = !!value;
  else if (action === 'volume') p.volume = Math.min(1, Math.max(0, Number(value) || 0));
  else if (action === 'loop') p.loop = !!value;
  else return;
  broadcastContent();
}

// O overlay do OBS avisa o andamento do vídeo; no fim, tira da tela se configurado
function onMediaProgress(payload) {
  broadcast('media-progress', payload);
  const m = globalState.media;
  if (payload.ended && payload.token === m.playback.token && !m.playback.loop && !m.isCleared &&
      globalState.mediaStyles.endAction === 'clear') {
    hideMedia();
    broadcastContent();
  }
}

let saveMediaStylesTimer = null;
function updateMediaStyles(partial) {
  globalState.mediaStyles = { ...globalState.mediaStyles, ...partial };
  broadcast('update-media-style', globalState.mediaStyles);
  clearTimeout(saveMediaStylesTimer);
  saveMediaStylesTimer = setTimeout(() => db.setSetting('styles.media', globalState.mediaStyles), 400);
}

// ---------- Nome do pregador (lower third) ----------

let lowerThirdTimer = null;

function hideLowerThird(broadcastNow = true) {
  clearTimeout(lowerThirdTimer);
  globalState.lowerThird.visible = false;
  if (broadcastNow) broadcastContent();
}

function showLowerThird({ name, subtitle, kind }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return;
  clearTimeout(lowerThirdTimer);
  // Os dois ficam embaixo: o nome do pregador tira o anúncio da leitura
  hideReading(false);
  globalState.lowerThird = {
    visible: true,
    name: cleanName,
    subtitle: String(subtitle || '').trim(),
    kind: kind === 'special' ? 'special' : 'preacher',
    token: globalState.lowerThird.token + 1
  };
  broadcastContent();
  // Some sozinho depois de alguns segundos (se configurado; cada um tem o seu tempo)
  const styles = globalState.lowerThird.kind === 'special' ? globalState.specialStyles : globalState.lowerThirdStyles;
  const seconds = Number(styles.autoHide) || 0;
  if (seconds > 0) lowerThirdTimer = setTimeout(() => hideLowerThird(), seconds * 1000);
}

function toggleLowerThird() {
  const lt = globalState.lowerThird;
  if (lt.visible) hideLowerThird();
  else if (lt.name) showLowerThird(lt);
}

let saveLtStylesTimer = null;
function updateLowerThirdStyles(partial) {
  globalState.lowerThirdStyles = { ...globalState.lowerThirdStyles, ...partial };
  broadcast('update-lt-style', globalState.lowerThirdStyles);
  clearTimeout(saveLtStylesTimer);
  saveLtStylesTimer = setTimeout(() => db.setSetting('styles.lowerThird', globalState.lowerThirdStyles), 400);
}

let saveSpecialStylesTimer = null;
function updateSpecialStyles(partial) {
  globalState.specialStyles = { ...globalState.specialStyles, ...partial };
  broadcast('update-special-style', globalState.specialStyles);
  clearTimeout(saveSpecialStylesTimer);
  saveSpecialStylesTimer = setTimeout(() => db.setSetting('styles.special', globalState.specialStyles), 400);
}

function setServiceReading(text) {
  globalState.serviceReading = String(text || '').trim().slice(0, 80);
  db.setSetting('serviceReading', globalState.serviceReading);
  if (!globalState.serviceReading) hideReading(false);
  broadcastContent();
}

// ---------- Anúncio da leitura bíblica ----------

let readingTimer = null;

function hideReading(broadcastNow = true) {
  clearTimeout(readingTimer);
  globalState.readingAnnounce.visible = false;
  if (broadcastNow) broadcastContent();
}

// Da aba Bíblia vem a passagem escolhida (vira também a leitura do culto, embaixo do nome do pregador)
function showReading(text) {
  if (text !== undefined && String(text).trim()) {
    globalState.serviceReading = String(text).trim().slice(0, 80);
    db.setSetting('serviceReading', globalState.serviceReading);
  }
  if (!globalState.serviceReading) return;
  clearTimeout(readingTimer);
  hideLowerThird(false);
  globalState.readingAnnounce = { visible: true, token: globalState.readingAnnounce.token + 1 };
  broadcastContent();
  const seconds = Number(globalState.readingStyles.autoHide) || 0;
  if (seconds > 0) readingTimer = setTimeout(() => hideReading(), seconds * 1000);
}

let saveReadingStylesTimer = null;
function updateReadingStyles(partial) {
  if (partial.label !== undefined) partial = { ...partial, label: String(partial.label || '').slice(0, 40) };
  globalState.readingStyles = { ...globalState.readingStyles, ...partial };
  broadcast('update-reading-style', globalState.readingStyles);
  clearTimeout(saveReadingStylesTimer);
  saveReadingStylesTimer = setTimeout(() => db.setSetting('styles.reading', globalState.readingStyles), 400);
}

// ---------- Agendamentos (sons, vídeos e playlists) ----------

let soundToken = 0;
let soundRun = null; // { items, index, label, playlist, transition, transitionTime, volume }

// Toca um arquivo ou uma playlist: um item atrás do outro; quem avisa o fim de cada um é o overlay
// do OBS ou a janela do programa ("sound-ended"), e o servidor passa para o próximo.
function playSound({ name, playlist, volume, label }) {
  const master = Math.min(1, Math.max(0, Number(volume ?? 1)));
  if (playlist) {
    const list = globalState.soundPlaylists.find(p => p.id === playlist);
    if (!list || list.items.length === 0) return;
    soundRun = { items: list.items, index: 0, label: String(label || list.name), playlist: list.name, transition: list.transition, transitionTime: list.transitionTime, volume: master };
  } else {
    if (!name) return;
    soundRun = { items: [{ name, volume: 1 }], index: 0, label: label ? String(label) : null, playlist: null, transition: 'fade', transitionTime: 0.6, volume: master };
  }
  playRunItem();
}

function playRunItem() {
  const files = sounds.listSounds();
  // Arquivo apagado no meio da playlist: pula
  while (soundRun && soundRun.index < soundRun.items.length && !files.some(f => f.name === soundRun.items[soundRun.index].name)) soundRun.index++;
  if (!soundRun || soundRun.index >= soundRun.items.length) {
    stopSoundRun(true);
    return;
  }
  const item = soundRun.items[soundRun.index];
  const file = files.find(f => f.name === item.name);
  const title = file.name.replace(/\.[^.]+$/, '');
  const now = {
    id: ++soundToken,
    kind: file.kind,
    name: file.name,
    url: file.url,
    image: file.image,
    label: soundRun.playlist ? title : (soundRun.label || title),
    volume: Math.min(1, Math.max(0, item.volume * soundRun.volume)),
    output: globalState.soundOutput,
    transition: soundRun.transition,
    transitionTime: soundRun.transitionTime,
    startedAt: Date.now(),
    playlist: soundRun.playlist ? { name: soundRun.label, index: soundRun.index, total: soundRun.items.length } : null
  };
  globalState.soundNow = now;
  broadcast('sound-play', now);
  broadcastContent();
}

// Acabou o item `id` (ou "pular"): vai para o próximo da playlist
function soundFinished(id) {
  const now = globalState.soundNow;
  if (!now || (id !== undefined && now.id !== id)) return;
  broadcast('sound-ended', { id: now.id });
  if (soundRun) soundRun.index++;
  playRunItem();
}

function stopSoundRun(notify = true) {
  const now = globalState.soundNow;
  soundRun = null;
  globalState.soundNow = null;
  if (now) broadcast('sound-ended', { id: now.id });
  broadcast('sound-stop', {});
  if (notify) broadcastContent();
}

function setSoundOutput(output) {
  globalState.soundOutput = output === 'obs' ? 'obs' : 'app';
  db.setSetting('soundOutput', globalState.soundOutput);
  stopSoundRun();
}

function setSoundSchedules(items) {
  globalState.soundSchedules = sounds.saveSchedules(items);
  broadcastContent();
}

function setSoundPlaylists(items) {
  globalState.soundPlaylists = sounds.savePlaylists(items);
  // Playlist apagada leva os agendamentos dela
  const ids = new Set(globalState.soundPlaylists.map(p => p.id));
  const left = globalState.soundSchedules.filter(s => !s.playlist || ids.has(s.playlist));
  if (left.length !== globalState.soundSchedules.length) globalState.soundSchedules = sounds.saveSchedules(left);
  broadcastContent();
}

sounds.startScheduler({
  getSchedules: () => globalState.soundSchedules,
  onFire: (s) => {
    const list = s.playlist && globalState.soundPlaylists.find(p => p.id === s.playlist);
    console.log(`Agendamento: ${s.label || (list ? list.name : s.name)} (${s.time})`);
    playSound({ name: s.name, playlist: s.playlist, volume: s.volume, label: s.label || (list ? list.name : null) });
  },
  onChange: (list) => {
    globalState.soundSchedules = list;
    broadcastContent();
  }
});

// ---------- Pedidos de oração ----------

function setPrayer({ title, names }) {
  const p = globalState.prayer;
  if (title !== undefined) p.title = String(title || '').trim().slice(0, 40);
  if (names !== undefined) {
    p.names = (Array.isArray(names) ? names : [])
      .map(n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 40);
  }
  db.setSetting('prayer', { title: p.title, names: p.names });
  broadcastContent();
}

// Tela cheia: tira o que estiver no ar (o nome do pregador pode continuar)
function showPrayer(visible) {
  const p = globalState.prayer;
  if (visible && p.names.length === 0) return;
  if (visible) {
    hideMessage();
    hideHymn();
    hideBible();
    hideMedia();
  }
  p.visible = !!visible;
  broadcastContent();
}

let savePrayerStylesTimer = null;
function updatePrayerStyles(partial) {
  globalState.prayerStyles = { ...globalState.prayerStyles, ...partial };
  broadcast('update-prayer-style', globalState.prayerStyles);
  clearTimeout(savePrayerStylesTimer);
  savePrayerStylesTimer = setTimeout(() => db.setSetting('styles.prayer', globalState.prayerStyles), 400);
}

// Passador/teclado: o painel diz a aba (mode); o R400 com o app minimizado usa a última camada no ar
function layerFor(mode) {
  return ['message', 'hymn', 'bible', 'media'].includes(mode) ? mode : globalState.activeLayer;
}

function next(mode) {
  const layer = layerFor(mode);
  if (layer === 'hymn') nextHymnSlide();
  else if (layer === 'bible') nextBibleSlide();
  else if (layer === 'media') nextMediaItem();
  else nextParagraph();
}

function prev(mode) {
  const layer = layerFor(mode);
  if (layer === 'hymn') prevHymnSlide();
  else if (layer === 'bible') prevBibleSlide();
  else if (layer === 'media') prevMediaItem();
  else prevParagraph();
}

function toggleClear(mode) {
  const layer = layerFor(mode);
  if (layer === 'hymn') toggleHymn();
  else if (layer === 'bible') toggleBible();
  else if (layer === 'media') toggleMedia();
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

wss.on('connection', (ws, req) => {
  ws.canControl = auth.isAuthorized(req);
  ws.send(JSON.stringify({ type: 'init', payload: globalState }));

  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      const payload = data.payload || {};

      // Andamento do vídeo vem do overlay (que pode estar num PC sem PIN)
      if (data.type === 'media-progress') {
        onMediaProgress(payload);
        return;
      }
      // Fim do som que tocou no OBS (o painel volta para "Nada tocando")
      if (data.type === 'sound-ended') {
        soundFinished(Number(payload.id));
        return;
      }
      if (!ws.canControl) return;

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
        case 'cue-paragraph':
          cueParagraphOnServer(payload.index);
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
        case 'hymn-cue':
          cueHymnSlide(payload.index);
          break;
        case 'hymn-playlist':
          setHymnPlaylist(payload.items);
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
        case 'bible-cue':
          cueBibleSlide(payload.index);
          break;
        case 'update-bible-styles':
          updateBibleStyles(payload);
          break;
        case 'reset-bible-styles':
          updateBibleStyles(DEFAULT_BIBLE_STYLES);
          break;
        case 'media-folder':
          openMediaFolder(payload.folder);
          break;
        case 'media-show':
          showMediaItem(payload.index);
          break;
        case 'media-arm':
          armMediaItem(payload.index);
          break;
        case 'media-control':
          controlMedia(payload);
          break;
        case 'media-zoom':
          setMediaZoom(payload);
          break;
        case 'media-start':
          setMediaStart(payload);
          break;
        case 'media-order':
          setMediaOrder(payload.names);
          break;
        case 'update-media-styles':
          updateMediaStyles(payload);
          break;
        case 'reset-media-styles':
          updateMediaStyles(DEFAULT_MEDIA_STYLES);
          break;
        case 'lt-show':
          showLowerThird(payload);
          break;
        case 'lt-hide':
          hideLowerThird();
          break;
        case 'lt-toggle':
          toggleLowerThird();
          break;
        case 'update-lt-styles':
          updateLowerThirdStyles(payload);
          break;
        case 'reset-lt-styles':
          updateLowerThirdStyles(DEFAULT_LT_STYLES);
          break;
        case 'update-special-styles':
          updateSpecialStyles(payload);
          break;
        case 'reset-special-styles':
          updateSpecialStyles(DEFAULT_SPECIAL_STYLES);
          break;
        case 'service-reading':
          setServiceReading(payload.text);
          break;
        case 'reading-show':
          showReading(payload.text);
          break;
        case 'reading-hide':
          hideReading();
          break;
        case 'update-reading-styles':
          updateReadingStyles(payload);
          break;
        case 'reset-reading-styles':
          updateReadingStyles(DEFAULT_READING_STYLES);
          break;
        case 'sound-schedules':
          setSoundSchedules(payload.items);
          break;
        case 'sound-play':
          playSound(payload);
          break;
        case 'sound-output':
          setSoundOutput(payload.output);
          break;
        case 'sound-playlists':
          setSoundPlaylists(payload.items);
          break;
        case 'sound-next':
          soundFinished();
          break;
        case 'sound-stop':
          stopSoundRun();
          break;
        case 'prayer-set':
          setPrayer(payload);
          break;
        case 'prayer-show':
          showPrayer(true);
          break;
        case 'prayer-hide':
          showPrayer(false);
          break;
        case 'update-prayer-styles':
          updatePrayerStyles(payload);
          break;
        case 'reset-prayer-styles':
          updatePrayerStyles(DEFAULT_PRAYER_STYLES);
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
// Baixa todas as mensagens do site do Tabernáculo da Fé e troca as do app (o andamento vai pelo WebSocket)
app.post('/api/sermons/import-site', (req, res) => {
  if (tfSermons.isRunning()) return res.status(409).json({ error: 'A importação já está em andamento.' });
  res.status(202).json({ started: true });
  let last = 0;
  tfSermons.importFromSite({
    onProgress: (p) => {
      // Não precisa avisar o painel a cada mensagem: no máximo umas 4 vezes por segundo
      const now = Date.now();
      if (now - last > 250 || p.done === p.total) {
        last = now;
        broadcast('site-import', { status: 'running', ...p });
      }
    }
  }).then(result => {
    broadcast('site-import', { status: 'done', result });
    broadcast('library-changed', { sermons: result.imported, hymns: 0, backgrounds: 0 });
  }).catch(err => {
    broadcast('site-import', { status: 'error', message: err.message });
  });
});

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
    // Título ou número mudou: a lista do culto mostra o novo
    const listed = globalState.hymnPlaylist.find(h => h.id === id);
    if (listed) {
      const hymn = hymns.getHymn(id);
      setHymnPlaylist(globalState.hymnPlaylist.map(h => (h.id === id ? { ...h, number: hymn.number, title: hymn.title, collection: hymn.collection } : h)));
    }
    res.json({ success: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/hymns/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!hymns.deleteHymn(id)) return res.status(404).json({ error: 'Hino não encontrado' });
  if (globalState.hymn.id === id) setHymnState(null);
  if (globalState.hymnPlaylist.some(h => h.id === id)) setHymnPlaylist(globalState.hymnPlaylist.filter(h => h.id !== id));
  else broadcastContent();
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

// ---------- API de mídias ----------

app.get('/api/media/folders', (req, res) => {
  res.json({ today: media.todayFolder(), folders: media.listFolders() });
});

app.post('/api/media/folders', (req, res) => {
  try {
    res.json({ success: true, folder: media.createFolder(req.body.name) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/media/folders/:folder', (req, res) => {
  try {
    if (!media.removeFolder(req.params.folder)) return res.status(404).json({ error: 'Pasta não encontrada' });
    if (globalState.media.folder === req.params.folder) {
      hideMedia();
      openMediaFolder(null);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/media/items/:folder', (req, res) => {
  try {
    res.json(media.listItems(req.params.folder));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Envio em streaming: o corpo da requisição é o próprio arquivo
app.post('/api/media/upload', async (req, res) => {
  try {
    const saved = await media.saveUpload(req, req.query.folder || media.todayFolder(), req.query.name);
    refreshMediaItems(req.query.folder || media.todayFolder());
    res.json({ success: true, ...saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API de sons agendados ----------

app.get('/api/sounds', (req, res) => {
  res.json(sounds.listSounds());
});

app.post('/api/sounds/upload', async (req, res) => {
  try {
    const saved = await sounds.saveUpload(req, req.query.name);
    res.json({ success: true, ...saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Imagem que aparece no OBS enquanto o som toca
app.post('/api/sounds/:name/image', async (req, res) => {
  try {
    res.json({ success: true, ...(await sounds.saveImage(req, req.params.name, req.query.file)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/sounds/:name/image', (req, res) => {
  try {
    sounds.removeImage(req.params.name);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Apagar o som também tira os agendamentos dele
app.delete('/api/sounds/:name', (req, res) => {
  try {
    if (!sounds.removeSound(req.params.name)) return res.status(404).json({ error: 'Som não encontrado.' });
    const left = globalState.soundSchedules.filter(s => s.name !== req.params.name);
    if (left.length !== globalState.soundSchedules.length) setSoundSchedules(left);
    // Sai também das playlists
    const name = req.params.name;
    if (globalState.soundPlaylists.some(p => p.items.some(it => it.name === name))) {
      setSoundPlaylists(globalState.soundPlaylists.map(p => ({ ...p, items: p.items.filter(it => it.name !== name) })));
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Vídeo do YouTube pelo link (fica na pasta como um item, igual aos arquivos)
app.post('/api/media/youtube', async (req, res) => {
  try {
    const folder = req.body.folder || media.todayFolder();
    const saved = await media.addYoutube(folder, req.body.url);
    if (saved.start && globalState.media.folder === folder) {
      refreshMediaItems(folder);
      setMediaStart({ name: saved.name, start: saved.start });
    } else {
      if (saved.start) {
        const all = db.getSetting('mediaStarts', {});
        all[zoomKey(folder, saved.name)] = saved.start;
        db.setSetting('mediaStarts', all);
      }
      refreshMediaItems(folder);
    }
    res.json({ success: true, ...saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/media/items/:folder/:name', (req, res) => {
  try {
    if (!media.removeItem(req.params.folder, req.params.name)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    refreshMediaItems(req.params.folder);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API do nome do pregador ----------

const readPreachers = () => db.getSetting('preachers', []);

app.get('/api/preachers', (req, res) => {
  res.json(readPreachers());
});

app.post('/api/preachers', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Digite o nome do pregador.' });
  const list = readPreachers();
  const preacher = { id: Date.now().toString(36), name, subtitle: String(req.body.subtitle || '').trim() };
  list.push(preacher);
  db.setSetting('preachers', list);
  res.json({ success: true, preacher });
});

app.put('/api/preachers/:id', (req, res) => {
  const list = readPreachers();
  const preacher = list.find(p => p.id === req.params.id);
  if (!preacher) return res.status(404).json({ error: 'Pregador não encontrado' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Digite o nome do pregador.' });
  preacher.name = name;
  preacher.subtitle = String(req.body.subtitle || '').trim();
  db.setSetting('preachers', list);
  res.json({ success: true, preacher });
});

app.delete('/api/preachers/:id', (req, res) => {
  db.setSetting('preachers', readPreachers().filter(p => p.id !== req.params.id));
  res.json({ success: true });
});

// ---------- Banco online (biblioteca compartilhada) ----------

app.get('/api/cloud/status', (req, res) => {
  res.json(sync.status());
});

// A senha só passa por aqui para pedir o acesso ao Supabase; não é guardada (fica só o token)
app.post('/api/cloud/login', async (req, res) => {
  try {
    res.json(await sync.login(req.body.email, req.body.password));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "Pedir acesso": a igreja nova cria o login e espera a aprovação de um editor
app.post('/api/cloud/signup', async (req, res) => {
  try {
    res.json(await sync.signup(req.body.email, req.body.password, req.body.church));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Igrejas conectadas e pedidos de acesso (só editores)
app.get('/api/cloud/members', async (req, res) => {
  try {
    res.json(await sync.listMembers());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/cloud/members/:id', async (req, res) => {
  try {
    res.json(await sync.setMemberRole(req.params.id, req.body.role));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/cloud/logout', (req, res) => {
  res.json(sync.logout());
});

app.post('/api/cloud/sync', async (req, res) => {
  await sync.syncNow();
  res.json(sync.status());
});

app.post('/api/cloud/config', (req, res) => {
  res.json(sync.setConfig(req.body));
});

// ---------- PIN para outros aparelhos ----------

app.post('/api/pin/login', auth.login);

app.get('/api/security', (req, res) => {
  res.json({ hasPin: auth.hasPin(), local: auth.isLocal(req) });
});

app.post('/api/security/pin', (req, res) => {
  try {
    res.json({ success: true, hasPin: auth.setPin(req.body.pin) });
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

// Canal de testes: este PC também recebe as versões de teste (update-beta.json da dev)
const updateOptions = () => ({ beta: !!db.getSetting('betaUpdates', false) });

app.get('/api/update-channel', (req, res) => {
  res.json({ beta: updateOptions().beta, currentVersion: CURRENT_VERSION });
});

app.post('/api/update-channel', (req, res) => {
  db.setSetting('betaUpdates', !!(req.body && req.body.beta));
  res.json({ beta: updateOptions().beta });
});

app.get('/api/check-update', async (req, res) => {
  try {
    res.json(await updater.checkForUpdate(CURRENT_VERSION, updateOptions()));
  } catch (err) {
    console.error('Erro ao checar atualizações:', err);
    res.json({ updateAvailable: false, currentVersion: CURRENT_VERSION, error: err.message });
  }
});

// A URL do pacote nunca vem do navegador: o updater lê do update.json oficial
app.post('/api/trigger-update', async (req, res) => {
  try {
    const launch = await updater.prepareUpdate(CURRENT_VERSION, updateOptions());
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

  // Biblioteca compartilhada: sincroniza em segundo plano e avisa os painéis
  sync.start({
    onStatus: (status) => broadcast('sync-status', status),
    onChanged: (changed) => broadcast('library-changed', changed)
  });
});

module.exports = {
  PORT,
  next,
  prev,
  toggleClear
};

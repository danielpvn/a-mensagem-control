// Anúncio da leitura bíblica (aba Bíblia): a passagem vem do capítulo/versículo escolhido na própria
// aba (sem digitar). O anúncio também vira a leitura do culto, que vai embaixo do nome do pregador.
import { $, previewInPanel } from './ui.js';
import * as ws from './ws.js';

let announce = { visible: false };
let serviceReading = '';
let bible = null;
let styles = {};
let startKey = '';  // livro:capítulo:versículo de início (o "até" volta a zero quando muda)

const PRESETS = {
  dark: { bandColor: '#11151c', borderColor: '#c99a2e', textColor: '#ffffff' },
  gold: { bandColor: '#e2b043', borderColor: '#8a6116', textColor: '#1b1206' }
};

// Ao trocar o estilo, já vêm as cores e a fonte que combinam com ele (dá para mudar depois)
const LOOKS = {
  photo: { fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', borderColor: '#9cc7ff' },
  full: { fontFamily: "'Playfair Display', serif", textColor: '#ffffff', borderColor: '#f2c46b' },
  bible3d: { fontFamily: "'Crimson Pro', serif", textColor: '#ffffff', bandColor: '#11151c', borderColor: '#c99a2e' },
  card: { fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', bandColor: '#16213e', borderColor: '#e2b043' },
  light: { fontFamily: 'Montserrat, sans-serif', textColor: '#1f1f1f', bandColor: '#f7f3ea', borderColor: '#7a5a1e' },
  line: { fontFamily: "'Lora', serif", textColor: '#ffffff', bandColor: '#000000', borderColor: '#f2b632' }
};
const HAS_BACKGROUND = ['bible3d', 'card', 'light'];

// ---------- Passagem escolhida na aba Bíblia ----------

function startVerse() {
  if (!bible || !bible.book) return null;
  // O versículo preparado (clicado) vale mais que o que está no ar
  const index = (bible.cue ?? -1) !== -1 ? bible.cue : bible.slideIndex;
  if (index < 0) return null;
  const slide = bible.slides[index];
  return slide ? slide.verse : null;
}

function currentRef() {
  if (!bible || !bible.book) return '';
  const start = startVerse();
  if (!start) return `${bible.bookName} ${bible.chapter}`;
  const end = Number($('bible-announce-end').value) || 0;
  return `${bible.bookName} ${bible.chapter}:${start}${end > start ? `-${end}` : ''}`;
}

// Se a busca foi um trecho ("ef 4:11-13"), já preenche o "até o versículo"
function endFromSearch(start) {
  const match = $('bible-search').value.match(/(\d+)\s*[:.]\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
  if (!match || Number(match[1]) !== bible.chapter || Number(match[2]) !== start) return '';
  return Number(match[3]) > start ? match[3] : '';
}

function renderEndOptions() {
  const select = $('bible-announce-end');
  const start = startVerse();
  const key = bible && bible.book ? `${bible.book}:${bible.chapter}:${start}` : '';
  if (key === startKey) return;
  startKey = key;
  select.innerHTML = '<option value="">—</option>';
  select.disabled = !start;
  if (!start) return;
  const verses = [...new Set(bible.slides.map(s => s.verse))].filter(v => v > start);
  verses.forEach(v => {
    const option = document.createElement('option');
    option.value = v;
    option.textContent = v;
    select.appendChild(option);
  });
  select.value = endFromSearch(start);
}

function renderBar() {
  const has = !!(bible && bible.book);
  $('bible-announce').hidden = !has;
  if (!has) return;
  renderEndOptions();
  const ref = currentRef();
  $('bible-announce-ref').textContent = ref;
  const btn = $('btn-bible-announce');
  const live = announce.visible && serviceReading === ref;
  $('btn-bible-announce-label').textContent = live
    ? 'Esconder anúncio'
    : announce.visible ? 'Anunciar esta' : 'Anunciar leitura';
  btn.classList.toggle('is-live', live);
}

// ---------- Aparência ----------

const styleInputs = ['reading-font', 'reading-scale', 'reading-text-color', 'reading-band-color', 'reading-border-color'].map($);

function fillStyles(s) {
  styles = { ...styles, ...s };
  $('reading-autohide').value = String(styles.autoHide ?? 0);
  $('reading-anim').value = styles.animation === 'none' ? 'none' : 'normal';
  const look = styles.look || 'photo';
  $('reading-look').value = look;
  $('reading-label-field').hidden = look === 'bible3d';
  $('reading-presets').hidden = look !== 'bible3d';
  $('reading-band-color').parentElement.hidden = !HAS_BACKGROUND.includes(look);
  $('reading-border-name').textContent = look === 'bible3d' ? 'Borda' : 'Detalhes';
  if (document.activeElement !== $('reading-label')) $('reading-label').value = styles.label ?? 'LEITURA BÍBLICA';
  if (styleInputs.includes(document.activeElement)) return;
  $('reading-font').value = styles.fontFamily || 'Montserrat, sans-serif';
  $('reading-scale').value = styles.scale ?? 1;
  $('reading-scale-val').textContent = `${Math.round((styles.scale ?? 1) * 100)}%`;
  $('reading-text-color').value = styles.textColor || '#ffffff';
  $('reading-band-color').value = styles.bandColor || '#11151c';
  $('reading-border-color').value = styles.borderColor || '#9cc7ff';
}

function sendStyles() {
  $('reading-scale-val').textContent = `${Math.round(Number($('reading-scale').value) * 100)}%`;
  ws.send('update-reading-styles', {
    fontFamily: $('reading-font').value,
    scale: Number($('reading-scale').value),
    textColor: $('reading-text-color').value,
    bandColor: $('reading-band-color').value,
    borderColor: $('reading-border-color').value
  });
}

// Mostra a entrada e a saída só na prévia do painel (não vai para o OBS)
function previewAnimation() {
  previewInPanel({ type: 'preview-reading', text: currentRef() || serviceReading || 'Efésios 4:11' });
}

export function setupReading() {
  const onState = (state) => {
    announce = state.readingAnnounce || announce;
    serviceReading = state.serviceReading || '';
    bible = state.bible || bible;
    renderBar();
  };
  ws.on('init', (state) => {
    fillStyles(state.readingStyles || {});
    onState(state);
  });
  ws.on('update-content', onState);
  ws.on('update-reading-style', fillStyles);

  $('bible-announce-end').onchange = renderBar;
  $('btn-bible-announce').onclick = () => {
    const ref = currentRef();
    if (announce.visible && serviceReading === ref) ws.send('reading-hide');
    else if (ref) ws.send('reading-show', { text: ref });
  };

  $('reading-autohide').onchange = (e) => ws.send('update-reading-styles', { autoHide: Number(e.target.value) });
  $('reading-anim').onchange = (e) => {
    ws.send('update-reading-styles', { animation: e.target.value });
    setTimeout(previewAnimation, 300);
  };
  $('reading-look').onchange = (e) => {
    ws.send('update-reading-styles', { look: e.target.value, ...LOOKS[e.target.value] });
    setTimeout(previewAnimation, 300);
  };
  $('btn-reading-preview').onclick = previewAnimation;
  let labelTimer = null;
  $('reading-label').addEventListener('input', (e) => {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => ws.send('update-reading-styles', { label: e.target.value }), 300);
  });
  styleInputs.forEach(input => input.addEventListener('input', sendStyles));
  document.querySelectorAll('[data-reading-preset]').forEach(btn => {
    btn.onclick = () => ws.send('update-reading-styles', PRESETS[btn.dataset.readingPreset]);
  });
  $('btn-reading-reset').onclick = () => ws.send('reset-reading-styles');
}

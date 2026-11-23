// Anúncio da leitura bíblica (aba Bíblia): a passagem vem do capítulo/versículo escolhido na própria
// aba (sem digitar). O anúncio também vira a leitura do culto, que vai embaixo do nome do pregador.
import { $, previewInPanel, confirmDialog } from './ui.js';
import * as ws from './ws.js';
import { createBackgroundPicker } from './backgrounds.js';

let announce = { visible: false };
let serviceReading = '';
let bible = null;
let styles = {};
let startKey = '';  // livro:capítulo:versículo de início (o "até" volta a zero quando muda)
let pendingEnd = null; // favorito aberto: { key, end } para já marcar o "até o versículo"

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

// Estilos criados pelo operador (state.readingLooks): imagem dele + onde vai a passagem
let looks = [];
let lookTimer = null;
const isCustom = (look) => String(look || '').startsWith('custom:');
const currentLook = () => looks.find(l => `custom:${l.id}` === styles.look) || null;
const checked = (name) => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;
const setChecked = (name, value) => {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
};

function renderLookOptions() {
  const select = $('reading-look');
  select.querySelectorAll('optgroup[data-custom]').forEach(g => g.remove());
  if (looks.length) {
    const group = document.createElement('optgroup');
    group.label = 'Estilos criados aqui';
    group.dataset.custom = '1';
    looks.forEach(l => {
      const option = document.createElement('option');
      option.value = `custom:${l.id}`;
      option.textContent = l.name;
      group.appendChild(option);
    });
    select.appendChild(group);
  }
  select.value = styles.look || 'photo';
}

function fillCustomEditor() {
  const l = currentLook();
  $('reading-custom-field').hidden = !l;
  if (!l) return;
  const editing = $('reading-custom-field').contains(document.activeElement);
  if (!editing) {
    $('reading-custom-name').value = l.name;
    setChecked('reading-custom-format', l.format);
    setChecked('reading-custom-align', l.align);
    $('reading-custom-y').value = l.textY;
    $('reading-custom-w').value = l.textWidth;
    $('reading-custom-band').value = l.bandHeight ?? 30;
  }
  $('reading-custom-band-field').hidden = l.format === 'full';
  $('reading-custom-band-val').textContent = `${$('reading-custom-band').value}%`;
  $('reading-custom-y-val').textContent = `${$('reading-custom-y').value}%`;
  $('reading-custom-w-val').textContent = `${$('reading-custom-w').value}%`;
  $('reading-custom-hint').textContent = l.format === 'full'
    ? 'Tela cheia: uma imagem 1920x1080 feita no computador. Sem imagem, usa a cor de fundo.'
    : 'Faixa embaixo: uma imagem larga (ex: 1920x400; PNG com fundo transparente fica melhor). Sem imagem, usa a cor de fundo.';
  if (customPicker) customPicker.render();
}

// Muda o estilo criado que está escolhido (os controles deslizantes mandam com um pequeno atraso)
function changeLook(partial, wait = 0) {
  const l = currentLook();
  if (!l) return;
  Object.assign(l, partial);
  renderLookOptions();
  fillCustomEditor();
  clearTimeout(lookTimer);
  lookTimer = setTimeout(() => ws.send('reading-looks', { items: looks }), wait);
}

// A prévia "Como vai ficar" manda o que foi arrastado (passagem, faixa)
export function editCurrentLook(partial) {
  // Sai do campo do nome (se estiver nele) para os controles mostrarem o que foi arrastado
  if ($('reading-custom-field').contains(document.activeElement)) document.activeElement.blur();
  changeLook(partial);
}

// Imagem larga escolhida para a faixa: a altura da faixa segue a proporção dela
function bandHeightFor(url) {
  const img = new Image();
  img.onload = () => {
    const l = currentLook();
    if (!l || l.format === 'full' || l.image !== url || !img.naturalWidth) return;
    const pct = Math.round(img.naturalHeight / img.naturalWidth * 1920 / 1080 * 100);
    changeLook({ bandHeight: pct >= 70 ? 30 : Math.max(8, pct) });
  };
  img.src = url;
}

function createLook() {
  const id = `l${Date.now().toString(36)}`;
  const look = { id, name: `Estilo ${looks.length + 1}`, image: null, format: 'band', align: 'center', textY: 50, textWidth: 80 };
  ws.send('reading-looks', { items: [...looks, look] });
  ws.send('update-reading-styles', { look: `custom:${id}`, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', bandColor: '#11151c', borderColor: '#f2c46b' });
  setTimeout(() => { $('reading-custom-name').focus(); $('reading-custom-name').select(); }, 400);
}

let customPicker = null;

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
  if (pendingEnd && pendingEnd.key === key) {
    select.value = pendingEnd.end || '';
    pendingEnd = null;
  } else {
    select.value = endFromSearch(start);
  }
}

// Texto que o anúncio mostraria agora (para a prévia "Como vai ficar")
export function announceText() {
  return currentRef() || serviceReading || 'Efésios 4:11';
}

// Passagem escolhida agora (para os favoritos): { book, chapter, verse, end }
export function currentPassage() {
  if (!bible || !bible.book) return null;
  const verse = startVerse();
  const end = Number($('bible-announce-end').value) || null;
  return { book: bible.book, chapter: bible.chapter, verse, end: verse && end > verse ? end : null };
}

// Ao abrir um favorito, o "até o versículo" já vem marcado
export function presetEnd(fav) {
  pendingEnd = fav.verse ? { key: `${fav.book}:${fav.chapter}:${fav.verse}`, end: fav.end } : null;
  startKey = '';
  renderBar();
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
  renderLookOptions();
  fillCustomEditor();
  $('reading-label-field').hidden = look === 'bible3d';
  // Tela cheia: dá para trocar a imagem da Bíblia por uma feita no computador
  $('reading-image-field').hidden = look !== 'full';
  if (imagePicker) imagePicker.render();
  $('reading-presets').hidden = look !== 'bible3d';
  $('reading-band-color').parentElement.hidden = !HAS_BACKGROUND.includes(look) && !isCustom(look);
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

let imagePicker = null;

export function setupReading() {
  imagePicker = createBackgroundPicker($('reading-image-picker'), {
    getValue: () => styles.fullImage || null,
    onSelect: (url) => ws.send('update-reading-styles', { fullImage: url })
  });
  customPicker = createBackgroundPicker($('reading-custom-picker'), {
    getValue: () => (currentLook() || {}).image || null,
    onSelect: (url) => { changeLook({ image: url }); if (url) bandHeightFor(url); setTimeout(previewAnimation, 400); }
  });
  $('btn-reading-new-look').onclick = createLook;
  $('reading-custom-name').addEventListener('input', (e) => changeLook({ name: e.target.value }, 500));
  document.querySelectorAll('input[name="reading-custom-format"], input[name="reading-custom-align"]').forEach(radio => {
    radio.addEventListener('change', () => {
      // Escolher um lado tira a posição arrastada na prévia
      const align = checked('reading-custom-align');
      const l = currentLook();
      changeLook({ format: checked('reading-custom-format'), align, ...(l && l.align !== align ? { textX: null } : {}) });
      setTimeout(previewAnimation, 300);
    });
  });
  $('reading-custom-y').addEventListener('input', (e) => changeLook({ textY: Number(e.target.value) }, 120));
  $('reading-custom-w').addEventListener('input', (e) => changeLook({ textWidth: Number(e.target.value) }, 120));
  $('reading-custom-band').addEventListener('input', (e) => changeLook({ bandHeight: Number(e.target.value) }, 120));
  $('btn-reading-custom-delete').onclick = async () => {
    const l = currentLook();
    if (!l) return;
    const ok = await confirmDialog({ title: 'Apagar estilo', text: `Apagar o estilo "${l.name}"? O anúncio volta para "Faixa com a Bíblia e a luz".`, okLabel: 'Apagar', danger: true });
    if (ok) ws.send('reading-looks', { items: looks.filter(x => x.id !== l.id) });
  };

  const onState = (state) => {
    if (Array.isArray(state.readingLooks) && JSON.stringify(state.readingLooks) !== JSON.stringify(looks)) {
      // Não atrapalha quem está digitando o nome ou arrastando um controle do estilo
      if (!$('reading-custom-field').contains(document.activeElement)) {
        looks = state.readingLooks.map(l => ({ ...l }));
        renderLookOptions();
        fillCustomEditor();
      }
    }
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

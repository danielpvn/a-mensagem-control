// Anúncio da leitura bíblica (aba Culto): Bíblia aberta com a faixa da passagem no telão.
// O texto é o mesmo campo "Leitura do culto" que vai abaixo do nome do pregador.
import { $ } from './ui.js';
import * as ws from './ws.js';

let announce = { visible: false };
let styles = {};

const PRESETS = {
  dark: { bandColor: '#11151c', borderColor: '#c99a2e', textColor: '#ffffff' },
  gold: { bandColor: '#e2b043', borderColor: '#8a6116', textColor: '#1b1206' }
};

// Ao trocar o estilo, já vêm as cores e a fonte que combinam com ele (dá para mudar depois)
const LOOKS = {
  bible3d: { fontFamily: "'Crimson Pro', serif", textColor: '#ffffff', bandColor: '#11151c', borderColor: '#c99a2e' },
  card: { fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', bandColor: '#16213e', borderColor: '#e2b043' },
  light: { fontFamily: 'Montserrat, sans-serif', textColor: '#1f1f1f', bandColor: '#f7f3ea', borderColor: '#7a5a1e' },
  line: { fontFamily: "'Lora', serif", textColor: '#ffffff', bandColor: '#000000', borderColor: '#f2b632' }
};

const typedReading = () => $('service-reading').value.trim();

function renderButton() {
  const btn = $('btn-reading-toggle');
  btn.textContent = announce.visible ? 'Esconder anúncio da leitura' : 'Anunciar leitura';
  btn.classList.toggle('btn-danger', announce.visible);
  btn.classList.toggle('btn-primary', !announce.visible);
  btn.disabled = !announce.visible && !typedReading();
}

const styleInputs = ['reading-font', 'reading-scale', 'reading-text-color', 'reading-band-color', 'reading-border-color'].map($);

function fillStyles(s) {
  styles = { ...styles, ...s };
  $('reading-autohide').value = String(styles.autoHide ?? 0);
  const look = styles.look || 'bible3d';
  $('reading-look').value = look;
  $('reading-label-field').hidden = look === 'bible3d';
  $('reading-presets').hidden = look !== 'bible3d';
  $('reading-band-color').parentElement.hidden = look === 'line'; // só texto e linha não tem fundo
  $('reading-border-name').textContent = look === 'bible3d' ? 'Borda' : 'Detalhes';
  if (document.activeElement !== $('reading-label')) $('reading-label').value = styles.label ?? 'LEITURA BÍBLICA';
  if (styleInputs.includes(document.activeElement)) return;
  $('reading-font').value = styles.fontFamily || "'Crimson Pro', serif";
  $('reading-scale').value = styles.scale ?? 1;
  $('reading-scale-val').textContent = `${Math.round((styles.scale ?? 1) * 100)}%`;
  $('reading-text-color').value = styles.textColor || '#ffffff';
  $('reading-band-color').value = styles.bandColor || '#11151c';
  $('reading-border-color').value = styles.borderColor || '#c99a2e';
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

export function setupReading() {
  const onState = (state) => {
    announce = state.readingAnnounce || announce;
    renderButton();
  };
  ws.on('init', (state) => {
    fillStyles(state.readingStyles || {});
    onState(state);
  });
  ws.on('update-content', onState);
  ws.on('update-reading-style', fillStyles);

  $('service-reading').addEventListener('input', renderButton);
  $('btn-reading-toggle').onclick = () => {
    if (announce.visible) {
      ws.send('reading-hide');
      return;
    }
    // Manda o texto digitado agora (o campo só salva um instante depois de parar de digitar)
    ws.send('service-reading', { text: typedReading() });
    ws.send('reading-show');
  };
  $('reading-autohide').onchange = (e) => ws.send('update-reading-styles', { autoHide: Number(e.target.value) });

  $('reading-look').onchange = (e) => ws.send('update-reading-styles', { look: e.target.value, ...LOOKS[e.target.value] });
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

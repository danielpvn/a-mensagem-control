// Painel "Aparência": estilos do texto da Mensagem no OBS. O servidor salva no banco.
import { $ } from './ui.js';
import * as ws from './ws.js';

const input = {
  font: $('style-font'),
  size: $('style-size-slider'),
  titleSize: $('style-title-size-slider'),
  animation: $('style-animation'),
  textColor: $('style-text-color'),
  accentColor: $('style-accent-color'),
  bgColor: $('style-bg-color-picker'),
  bgOpacity: $('style-bg-opacity'),
  outlineColor: $('style-outline-color'),
  showTitle: $('style-show-title'),
  showNumber: $('style-show-paragraph-number'),
  telao: $('style-telao-mode'),
  outline: $('style-text-outline')
};

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseRgba(rgbaStr) {
  const match = String(rgbaStr).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return { hex: '#0a0f1e', opacity: 85 };
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  const opacity = match[4] ? Math.round(parseFloat(match[4]) * 100) : 100;
  const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return { hex, opacity };
}

function updateLabels() {
  $('size-slider-val').textContent = input.size.value;
  $('title-size-slider-val').textContent = input.titleSize.value;
  $('opacity-val').textContent = `${input.bgOpacity.value}%`;
  input.outlineColor.closest('.color-field').classList.toggle('disabled', !input.outline.checked);
}

function gatherStyles() {
  return {
    fontFamily: input.font.value,
    fontSize: `${input.size.value}rem`,
    titleSize: `${input.titleSize.value}rem`,
    textColor: input.textColor.value,
    accentColor: input.accentColor.value,
    bgColor: hexToRgba(input.bgColor.value, Number(input.bgOpacity.value) / 100),
    animationType: input.animation.value,
    showTitle: input.showTitle.checked,
    showParagraphNumber: input.showNumber.checked,
    telaoMode: input.telao.checked,
    textOutline: input.outline.checked,
    outlineColor: input.outlineColor.value
  };
}

// Preenche os controles com os estilos vindos do servidor (inclusive mudanças feitas em outro aparelho)
function fillInputs(styles) {
  if (!styles) return;
  input.font.value = styles.fontFamily || 'Outfit, sans-serif';
  input.size.value = parseFloat(styles.fontSize) || 2.6;
  input.titleSize.value = parseFloat(styles.titleSize) || 1.1;
  input.animation.value = styles.animationType || 'slide-up';
  input.textColor.value = styles.textColor || '#ffffff';
  input.accentColor.value = styles.accentColor || '#2563eb';
  input.outlineColor.value = styles.outlineColor || '#000000';
  const { hex, opacity } = parseRgba(styles.bgColor);
  input.bgColor.value = hex;
  input.bgOpacity.value = opacity;
  input.showTitle.checked = styles.showTitle !== false;
  input.showNumber.checked = styles.showParagraphNumber !== false;
  input.telao.checked = styles.telaoMode === true;
  input.outline.checked = styles.textOutline === true;
  updateLabels();
}

export function setupAppearance() {
  ws.on('init', (state) => fillInputs(state.styles));
  ws.on('update-style', (styles) => {
    // Não atrapalha quem está arrastando um controle neste painel
    if (!Object.values(input).includes(document.activeElement)) {
      fillInputs(styles);
    }
  });

  Object.values(input).forEach(control => {
    control.addEventListener('input', () => {
      updateLabels();
      ws.send('update-styles', gatherStyles());
    });
  });

  $('btn-reset-styles').onclick = () => {
    if (document.activeElement) document.activeElement.blur();
    ws.send('reset-styles');
  };
}

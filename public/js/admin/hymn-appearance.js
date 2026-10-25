// Aparência dos hinos no OBS. Mesmo esquema do painel da Mensagem: tudo vai ao vivo e fica salvo.
import { $ } from './ui.js';
import * as ws from './ws.js';

// Temas prontos para começar rápido (o operador pode ajustar depois)
const THEMES = [
  {
    name: 'Noite',
    swatch: ['#050814', '#ffffff'],
    styles: { layout: 'fullscreen', linesPerSlide: 4, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#93c5fd', bgColor: 'rgba(5, 8, 20, 0.9)', uppercase: false, textOutline: false }
  },
  {
    name: 'Preto clássico',
    swatch: ['#000000', '#fde68a'],
    styles: { layout: 'fullscreen', linesPerSlide: 4, fontFamily: "'Lora', serif", textColor: '#fef3c7', accentColor: '#fbbf24', bgColor: 'rgba(0, 0, 0, 1)', uppercase: false, textOutline: false }
  },
  {
    name: 'Transparente',
    swatch: ['#3f3f46', '#ffffff'],
    styles: { layout: 'fullscreen', linesPerSlide: 4, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#e2e8f0', bgColor: 'rgba(0, 0, 0, 0.35)', uppercase: true, textOutline: true, outlineColor: '#000000' }
  },
  {
    name: 'Faixa',
    swatch: ['#0a0f1e', '#ffffff'],
    styles: { layout: 'lower-third', linesPerSlide: 2, fontSize: '3rem', fontFamily: 'Outfit, sans-serif', textColor: '#ffffff', accentColor: '#60a5fa', bgColor: 'rgba(10, 15, 30, 0.85)', uppercase: false, textOutline: false }
  }
];

const input = {
  lines: $('hymn-lines'),
  font: $('hymn-font'),
  size: $('hymn-size'),
  titleSize: $('hymn-title-size'),
  animation: $('hymn-animation'),
  textColor: $('hymn-text-color'),
  accentColor: $('hymn-accent-color'),
  bgColor: $('hymn-bg-color'),
  bgOpacity: $('hymn-bg-opacity'),
  outlineColor: $('hymn-outline-color'),
  showTitle: $('hymn-show-title'),
  showNumber: $('hymn-show-number'),
  showLabel: $('hymn-show-label'),
  uppercase: $('hymn-uppercase'),
  outline: $('hymn-outline')
};
const layoutRadios = [...document.querySelectorAll('input[name="hymn-layout"]')];

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseRgba(rgbaStr) {
  const match = String(rgbaStr).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return { hex: '#050814', opacity: 90 };
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  const opacity = match[4] ? Math.round(parseFloat(match[4]) * 100) : 100;
  const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return { hex, opacity };
}

function updateLabels() {
  $('hymn-lines-val').textContent = input.lines.value;
  $('hymn-size-val').textContent = input.size.value;
  $('hymn-title-size-val').textContent = input.titleSize.value;
  input.showNumber.closest('.switch').classList.toggle('disabled', !input.showTitle.checked);
  $('hymn-opacity-val').textContent = `${input.bgOpacity.value}%`;
  input.outlineColor.closest('.color-field').classList.toggle('disabled', !input.outline.checked);
}

function gatherStyles() {
  return {
    layout: (layoutRadios.find(r => r.checked) || layoutRadios[0]).value,
    linesPerSlide: Number(input.lines.value),
    fontFamily: input.font.value,
    fontSize: `${input.size.value}rem`,
    titleSize: `${input.titleSize.value}rem`,
    animationType: input.animation.value,
    textColor: input.textColor.value,
    accentColor: input.accentColor.value,
    bgColor: hexToRgba(input.bgColor.value, Number(input.bgOpacity.value) / 100),
    outlineColor: input.outlineColor.value,
    showTitle: input.showTitle.checked,
    showNumber: input.showNumber.checked,
    showLabel: input.showLabel.checked,
    uppercase: input.uppercase.checked,
    textOutline: input.outline.checked
  };
}

function fillInputs(styles) {
  if (!styles) return;
  layoutRadios.forEach(r => { r.checked = r.value === (styles.layout || 'fullscreen'); });
  input.lines.value = styles.linesPerSlide || 4;
  input.font.value = styles.fontFamily || 'Montserrat, sans-serif';
  input.size.value = parseFloat(styles.fontSize) || 4.2;
  input.titleSize.value = parseFloat(styles.titleSize) || 1.25;
  input.animation.value = styles.animationType || 'fade';
  input.textColor.value = styles.textColor || '#ffffff';
  input.accentColor.value = styles.accentColor || '#93c5fd';
  input.outlineColor.value = styles.outlineColor || '#000000';
  const { hex, opacity } = parseRgba(styles.bgColor);
  input.bgColor.value = hex;
  input.bgOpacity.value = opacity;
  input.showTitle.checked = styles.showTitle !== false;
  input.showNumber.checked = styles.showNumber !== false;
  input.showLabel.checked = styles.showLabel !== false;
  input.uppercase.checked = styles.uppercase === true;
  input.outline.checked = styles.textOutline === true;
  updateLabels();
}

function renderThemes() {
  const grid = $('hymn-themes');
  THEMES.forEach(theme => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-chip';
    btn.title = `Aplicar o tema "${theme.name}"`;
    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.style.background = theme.swatch[0];
    swatch.style.color = theme.swatch[1];
    swatch.textContent = 'Aa';
    const name = document.createElement('span');
    name.textContent = theme.name;
    btn.append(swatch, name);
    btn.onclick = () => ws.send('update-hymn-styles', theme.styles);
    grid.appendChild(btn);
  });
}

export function setupHymnAppearance() {
  renderThemes();
  ws.on('init', (state) => fillInputs(state.hymnStyles));
  ws.on('update-hymn-style', (styles) => {
    // Não atrapalha quem está arrastando um controle neste painel
    if (!Object.values(input).includes(document.activeElement)) fillInputs(styles);
  });

  [...Object.values(input), ...layoutRadios].forEach(control => {
    control.addEventListener('input', () => {
      updateLabels();
      ws.send('update-hymn-styles', gatherStyles());
    });
  });

  $('btn-hymn-reset-styles').onclick = () => {
    if (document.activeElement) document.activeElement.blur();
    ws.send('reset-hymn-styles');
  };
}

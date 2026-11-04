// Painel "Aparência": estilos do texto da Mensagem no OBS. O servidor salva no banco.
import { $ } from './ui.js';
import * as ws from './ws.js';
import { timeLabel, savedTime, savedEffect, scopeRadios, checkedScope, setScope } from './transition.js';

const rgba = (r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${a})`;
// Tudo que um tema define, para um tema não herdar o resto do anterior.
// O tamanho fica em 2.6: com mais que isso a caixa passa de 3 linhas e cobre o pregador.
const base = { fontSize: '2.6rem', titleSize: '1.1rem', textOutline: false, outlineColor: '#000000', telaoMode: false };

// Temas prontos para começar rápido (o operador pode ajustar depois)
const THEMES = [
  { name: 'Azul noite', preview: '#0a0f1e', styles: { ...base, fontFamily: 'Outfit, sans-serif', textColor: '#ffffff', accentColor: '#2563eb', bgColor: rgba(10, 15, 30, 0.85) } },
  { name: 'Azul real', preview: '#14336f', styles: { ...base, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#93c5fd', bgColor: rgba(20, 51, 111, 0.92) } },
  { name: 'Preto clássico', preview: '#000000', styles: { ...base, fontFamily: "'Lora', serif", textColor: '#fef3c7', accentColor: '#fbbf24', bgColor: rgba(0, 0, 0, 0.9) } },
  { name: 'Vinho', preview: '#4a0e22', styles: { ...base, fontFamily: "'Playfair Display', serif", textColor: '#fff7ed', accentColor: '#fcd34d', bgColor: rgba(74, 14, 34, 0.92) } },
  { name: 'Verde', preview: '#0b3b2e', styles: { ...base, fontFamily: 'Outfit, sans-serif', textColor: '#ffffff', accentColor: '#6ee7b7', bgColor: rgba(11, 59, 46, 0.92) } },
  { name: 'Clara', preview: '#ffffff', styles: { ...base, fontFamily: "'Lora', serif", textColor: '#111827', accentColor: '#1d4ed8', bgColor: rgba(255, 255, 255, 0.95) } },
  { name: 'Pergaminho', preview: '#f5ecd7', styles: { ...base, fontFamily: "'Crimson Pro', serif", fontSize: '3rem', textColor: '#3b2a14', accentColor: '#92400e', bgColor: rgba(245, 236, 215, 0.97) } },
  { name: 'Translúcido', preview: '#52525b', styles: { ...base, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#e2e8f0', bgColor: rgba(0, 0, 0, 0.45) } },
  { name: 'Só as letras', preview: '#3f3f46', styles: { ...base, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#ffffff', bgColor: rgba(0, 0, 0, 0), textOutline: true } },
  { name: 'Telão', preview: '#000000', styles: { ...base, fontFamily: "'Crimson Pro', serif", fontSize: '3.4rem', textColor: '#ffffff', accentColor: '#ffeb07', bgColor: rgba(0, 0, 0, 1), telaoMode: true } }
];

const input = {
  font: $('style-font'),
  size: $('style-size-slider'),
  titleSize: $('style-title-size-slider'),
  animation: $('style-animation'),
  speed: $('style-speed'),
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
const scope = scopeRadios('style-scope');

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
  $('style-speed-val').textContent = timeLabel(input.speed.value);
  // Sem transição (tempo 0): o efeito e o "onde usar" não valem
  const noTransition = Number(input.speed.value) === 0;
  input.animation.closest('.field').hidden = noTransition;
  scope[0].closest('.field').hidden = noTransition;
  // Só mostra o que vale agora
  input.outlineColor.closest('.color-field').hidden = !input.outline.checked;
  // O tamanho do título vale para o título e para o número do parágrafo
  input.titleSize.closest('.field').hidden = !input.showTitle.checked && !input.showNumber.checked;
  // No modo telão o fundo é sempre preto
  input.bgColor.closest('.color-field').hidden = input.telao.checked;
  input.bgOpacity.closest('.field').hidden = input.telao.checked;
}

function renderThemes() {
  const grid = $('message-themes');
  THEMES.forEach(theme => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-chip';
    btn.title = `Aplicar o tema "${theme.name}"`;
    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.style.background = theme.preview;
    swatch.style.color = theme.styles.textColor;
    swatch.style.borderLeft = `3px solid ${theme.styles.accentColor}`;
    swatch.textContent = 'Aa';
    const name = document.createElement('span');
    name.textContent = theme.name;
    btn.append(swatch, name);
    btn.onclick = () => ws.send('update-styles', theme.styles);
    grid.appendChild(btn);
  });
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
    transitionTime: Number(input.speed.value),
    transitionScope: checkedScope(scope),
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
  input.animation.value = savedEffect(styles, 'slide-up');
  input.speed.value = savedTime(styles);
  setScope(scope, styles.transitionScope);
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
  renderThemes();
  ws.on('init', (state) => fillInputs(state.styles));
  ws.on('update-style', (styles) => {
    // Não atrapalha quem está arrastando um controle neste painel
    if (![...Object.values(input), ...scope].includes(document.activeElement)) {
      fillInputs(styles);
    }
  });

  [...Object.values(input), ...scope].forEach(control => {
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

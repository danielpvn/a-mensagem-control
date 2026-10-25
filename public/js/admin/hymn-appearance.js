// Aparência dos hinos no OBS. Mesmo esquema do painel da Mensagem: tudo vai ao vivo e fica salvo.
import { $ } from './ui.js';
import * as ws from './ws.js';
import { refreshBackgrounds, backgroundExists } from './backgrounds.js';
import { createBackgroundEditor, gradientCss } from './background-editor.js';

// Campos de fundo que todo tema define (para um tema não herdar o fundo do anterior)
const plain = { bgMode: 'color', bgImage: null, bgVignette: false, gradientAnimate: false, position: 'center' };

// Temas prontos para começar rápido (o operador pode ajustar depois)
const THEMES = [
  {
    name: 'Noite roxa',
    preview: gradientCss({ from: '#1a0b2e', to: '#5b2a86', angle: 135 }),
    styles: { ...plain, layout: 'fullscreen', linesPerSlide: 4, bgMode: 'gradient', gradientFrom: '#1a0b2e', gradientTo: '#5b2a86', gradientAngle: 135, gradientKind: 'linear', gradientOpacity: 1, bgVignette: true, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#e9d5ff', uppercase: false, textOutline: false }
  },
  {
    name: 'Azul real',
    preview: gradientCss({ from: '#141e30', to: '#2a5298', angle: 160 }),
    styles: { ...plain, layout: 'fullscreen', linesPerSlide: 4, bgMode: 'gradient', gradientFrom: '#141e30', gradientTo: '#2a5298', gradientAngle: 160, gradientKind: 'linear', gradientOpacity: 1, gradientAnimate: true, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#bfdbfe', uppercase: false, textOutline: false }
  },
  {
    name: 'Preto clássico',
    preview: '#000000',
    styles: { ...plain, layout: 'fullscreen', linesPerSlide: 4, fontFamily: "'Lora', serif", textColor: '#fef3c7', accentColor: '#fbbf24', bgColor: 'rgba(0, 0, 0, 1)', uppercase: false, textOutline: false }
  },
  {
    name: 'Transparente',
    preview: '#3f3f46',
    styles: { ...plain, layout: 'fullscreen', linesPerSlide: 4, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#e2e8f0', bgColor: 'rgba(0, 0, 0, 0.35)', uppercase: true, textOutline: true, outlineColor: '#000000' }
  },
  {
    name: 'Faixa',
    preview: gradientCss({ from: '#0a0f1e', to: '#1e3a5f', angle: 90 }),
    styles: { ...plain, layout: 'lower-third', linesPerSlide: 2, fontSize: '3rem', fontFamily: 'Outfit, sans-serif', textColor: '#ffffff', accentColor: '#60a5fa', bgMode: 'gradient', gradientFrom: '#0a0f1e', gradientTo: '#1e3a5f', gradientAngle: 90, gradientKind: 'linear', gradientOpacity: 0.92, uppercase: false, textOutline: false }
  },
  {
    name: 'Imagem da igreja',
    image: '/backgrounds/hinos_padrao.jpg',
    styles: { ...plain, layout: 'fullscreen', bgMode: 'image', bgImage: '/backgrounds/hinos_padrao.jpg', bgColor: 'rgba(0, 0, 0, 0.15)', linesPerSlide: 4, fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#e0e7ff', uppercase: false, textOutline: false }
  },
  {
    name: 'Rodapé com imagem',
    image: '/backgrounds/hinos_rodape_padrao.jpg',
    styles: { ...plain, layout: 'fullscreen', position: 'bottom', bgMode: 'image', bgImage: '/backgrounds/hinos_rodape_padrao.jpg', bgColor: 'rgba(0, 0, 0, 0)', linesPerSlide: 2, fontSize: '3.4rem', fontFamily: 'Montserrat, sans-serif', textColor: '#ffffff', accentColor: '#e0e7ff', uppercase: false, textOutline: false }
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
  outlineColor: $('hymn-outline-color'),
  showTitle: $('hymn-show-title'),
  showNumber: $('hymn-show-number'),
  showLabel: $('hymn-show-label'),
  uppercase: $('hymn-uppercase'),
  outline: $('hymn-outline')
};
const layoutRadios = [...document.querySelectorAll('input[name="hymn-layout"]')];
const positionRadios = [...document.querySelectorAll('input[name="hymn-position"]')];
const checkedValue = (list) => (list.find(r => r.checked) || list[0]).value;

let editor = null;

function updateLabels() {
  $('hymn-lines-val').textContent = input.lines.value;
  $('hymn-size-val').textContent = input.size.value;
  $('hymn-title-size-val').textContent = input.titleSize.value;
  input.showNumber.closest('.switch').classList.toggle('disabled', !input.showTitle.checked);
  input.outlineColor.closest('.color-field').classList.toggle('disabled', !input.outline.checked);
  // "Texto embaixo" só faz sentido na tela cheia
  $('hymn-position-group').classList.toggle('disabled', checkedValue(layoutRadios) !== 'fullscreen');
}

function gatherStyles() {
  return {
    layout: checkedValue(layoutRadios),
    position: checkedValue(positionRadios),
    linesPerSlide: Number(input.lines.value),
    fontFamily: input.font.value,
    fontSize: `${input.size.value}rem`,
    titleSize: `${input.titleSize.value}rem`,
    animationType: input.animation.value,
    textColor: input.textColor.value,
    accentColor: input.accentColor.value,
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
  positionRadios.forEach(r => { r.checked = r.value === (styles.position || 'center'); });
  input.lines.value = styles.linesPerSlide || 4;
  input.font.value = styles.fontFamily || 'Montserrat, sans-serif';
  input.size.value = parseFloat(styles.fontSize) || 4.2;
  input.titleSize.value = parseFloat(styles.titleSize) || 1.25;
  input.animation.value = styles.animationType || 'fade';
  input.textColor.value = styles.textColor || '#ffffff';
  input.accentColor.value = styles.accentColor || '#93c5fd';
  input.outlineColor.value = styles.outlineColor || '#000000';
  input.showTitle.checked = styles.showTitle !== false;
  input.showNumber.checked = styles.showNumber !== false;
  input.showLabel.checked = styles.showLabel !== false;
  input.uppercase.checked = styles.uppercase === true;
  input.outline.checked = styles.textOutline === true;
  updateLabels();
  editor.fill(styles);
}

function renderThemes() {
  const grid = $('hymn-themes');
  grid.innerHTML = '';
  THEMES.filter(t => !t.image || backgroundExists(t.image)).forEach(theme => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-chip';
    btn.title = `Aplicar o tema "${theme.name}"`;
    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.style.background = theme.image ? `url("${theme.image}") center / cover` : theme.preview;
    swatch.style.color = theme.styles.textColor;
    swatch.textContent = 'Aa';
    const name = document.createElement('span');
    name.textContent = theme.name;
    btn.append(swatch, name);
    btn.onclick = () => ws.send('update-hymn-styles', theme.styles);
    grid.appendChild(btn);
  });
}

export function setupHymnAppearance() {
  editor = createBackgroundEditor($('hymn-bg-editor'), {
    name: 'hymn-bg',
    defaultColor: { hex: '#050814', opacity: 90 },
    onChange: (partial) => ws.send('update-hymn-styles', partial)
  });
  refreshBackgrounds().then(renderThemes);

  const allControls = [...Object.values(input), ...layoutRadios, ...positionRadios, ...editor.controls];
  ws.on('init', (state) => fillInputs(state.hymnStyles));
  ws.on('update-hymn-style', (styles) => {
    // Não atrapalha quem está arrastando um controle neste painel
    if (!allControls.includes(document.activeElement)) fillInputs(styles);
  });

  [...Object.values(input), ...layoutRadios, ...positionRadios].forEach(control => {
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

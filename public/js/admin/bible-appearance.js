// Aparência da Bíblia no OBS/telão. Tudo vai ao vivo e fica salvo no banco.
import { $ } from './ui.js';
import * as ws from './ws.js';
import { createBackgroundPicker, refreshBackgrounds, backgroundExists } from './backgrounds.js';

// Temas baseados nos presets que a igreja já usava no programa antigo
const THEMES = [
  {
    name: 'Padrão',
    swatch: ['#000000', '#ffffff'],
    styles: { layout: 'fullscreen', position: 'center', bgColor: 'rgba(0, 0, 0, 1)', bgImage: null, textColor: '#ffffff', refColor: '#ffeb07', fontSize: '4.4rem', textAlign: 'center' }
  },
  {
    name: 'Azul',
    swatch: ['#005a8c', '#ffffff'],
    styles: { layout: 'fullscreen', position: 'center', bgColor: 'rgba(0, 90, 140, 1)', bgImage: null, textColor: '#ffffff', refColor: '#ffeb07', fontSize: '4.4rem', textAlign: 'center' }
  },
  {
    name: 'Com imagem',
    image: '/backgrounds/biblia_e_mensagens_padrao.jpg',
    swatch: ['#1d5f9a', '#ffffff'],
    styles: { layout: 'fullscreen', position: 'center', bgColor: 'rgba(0, 0, 0, 0.1)', bgImage: '/backgrounds/biblia_e_mensagens_padrao.jpg', textColor: '#ffffff', refColor: '#ffeb07', fontSize: '4.4rem', textAlign: 'center' }
  },
  {
    name: 'Rodapé com imagem',
    image: '/backgrounds/biblia_rodape_padrao.jpg',
    swatch: ['#0b2238', '#ffffff'],
    styles: { layout: 'fullscreen', position: 'bottom', bgColor: 'rgba(0, 0, 0, 0)', bgImage: '/backgrounds/biblia_rodape_padrao.jpg', textColor: '#ffffff', refColor: '#ffeb07', fontSize: '3.6rem', textAlign: 'center' }
  },
  {
    name: 'Faixa (transmissão)',
    swatch: ['#0a0f1e', '#ffffff'],
    styles: { layout: 'lower-third', position: 'center', bgColor: 'rgba(10, 15, 30, 0.88)', bgImage: null, textColor: '#ffffff', refColor: '#ffeb07', fontSize: '3rem', textAlign: 'center' }
  }
];

const input = {
  font: $('bible-font'),
  size: $('bible-size'),
  bold: $('bible-bold'),
  shadow: $('bible-shadow'),
  showRef: $('bible-show-ref'),
  showVersion: $('bible-show-version'),
  refSize: $('bible-ref-size'),
  textColor: $('bible-text-color'),
  refColor: $('bible-ref-color'),
  bgColor: $('bible-bg-color'),
  bgOpacity: $('bible-bg-opacity'),
  animation: $('bible-animation')
};
const radios = (name) => [...document.querySelectorAll(`input[name="${name}"]`)];
const groups = {
  layout: radios('bible-layout'),
  position: radios('bible-position'),
  textAlign: radios('bible-align'),
  refPosition: radios('bible-ref-position')
};
const checkedValue = (list) => (list.find(r => r.checked) || list[0]).value;
const setChecked = (list, value) => list.forEach(r => { r.checked = r.value === value; });

let current = {};
let picker = null;

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseRgba(rgbaStr) {
  const match = String(rgbaStr).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return { hex: '#000000', opacity: 100 };
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  const opacity = match[4] ? Math.round(parseFloat(match[4]) * 100) : 100;
  return { hex: '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1), opacity };
}

function updateLabels() {
  $('bible-size-val').textContent = input.size.value;
  $('bible-ref-size-val').textContent = input.refSize.value;
  $('bible-opacity-val').textContent = `${input.bgOpacity.value}%`;
  // "Texto embaixo" só faz sentido na tela cheia
  $('bible-position-group').classList.toggle('disabled', checkedValue(groups.layout) !== 'fullscreen');
}

function gatherStyles() {
  return {
    layout: checkedValue(groups.layout),
    position: checkedValue(groups.position),
    fontFamily: input.font.value,
    fontSize: `${input.size.value}rem`,
    bold: input.bold.checked,
    textShadow: input.shadow.checked,
    textAlign: checkedValue(groups.textAlign),
    showRef: input.showRef.checked,
    showVersion: input.showVersion.checked,
    refPosition: checkedValue(groups.refPosition),
    refSize: `${input.refSize.value}rem`,
    textColor: input.textColor.value,
    refColor: input.refColor.value,
    bgColor: hexToRgba(input.bgColor.value, Number(input.bgOpacity.value) / 100),
    animationType: input.animation.value
  };
}

function fillInputs(styles) {
  if (!styles) return;
  current = { ...current, ...styles };
  setChecked(groups.layout, styles.layout || 'fullscreen');
  setChecked(groups.position, styles.position || 'center');
  setChecked(groups.textAlign, styles.textAlign || 'center');
  setChecked(groups.refPosition, styles.refPosition || 'bottom');
  input.font.value = styles.fontFamily || "'Crimson Pro', serif";
  input.size.value = parseFloat(styles.fontSize) || 4.4;
  input.bold.checked = styles.bold !== false;
  input.shadow.checked = styles.textShadow !== false;
  input.showRef.checked = styles.showRef !== false;
  input.showVersion.checked = styles.showVersion === true;
  input.refSize.value = parseFloat(styles.refSize) || 1.8;
  input.textColor.value = styles.textColor || '#ffffff';
  input.refColor.value = styles.refColor || '#ffeb07';
  const { hex, opacity } = parseRgba(styles.bgColor);
  input.bgColor.value = hex;
  input.bgOpacity.value = opacity;
  input.animation.value = styles.animationType || 'fade';
  updateLabels();
  if (picker) picker.render();
}

function send(partial) {
  current = { ...current, ...partial };
  ws.send('update-bible-styles', partial);
}

// Escolher imagem com o fundo opaco esconderia a imagem: deixa a cor quase transparente
function selectImage(url) {
  const partial = { bgImage: url };
  if (url && Number(input.bgOpacity.value) >= 90) {
    input.bgOpacity.value = 15;
    partial.bgColor = hexToRgba(input.bgColor.value, 0.15);
    updateLabels();
  }
  send(partial);
  picker.render();
}

function renderThemes() {
  const grid = $('bible-themes');
  grid.innerHTML = '';
  THEMES.filter(t => !t.image || backgroundExists(t.image)).forEach(theme => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-chip';
    btn.title = `Aplicar o tema "${theme.name}"`;
    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.style.background = theme.image ? `url("${theme.image}") center / cover` : theme.swatch[0];
    swatch.style.color = theme.swatch[1];
    swatch.textContent = 'Aa';
    const name = document.createElement('span');
    name.textContent = theme.name;
    btn.append(swatch, name);
    btn.onclick = () => send(theme.styles);
    grid.appendChild(btn);
  });
}

export function setupBibleAppearance() {
  picker = createBackgroundPicker($('bible-bg-picker'), { getValue: () => current.bgImage || null, onSelect: selectImage });
  refreshBackgrounds().then(renderThemes);

  ws.on('init', (state) => fillInputs(state.bibleStyles));
  ws.on('update-bible-style', (styles) => {
    if (![...Object.values(input), ...Object.values(groups).flat()].includes(document.activeElement)) fillInputs(styles);
    else current = { ...current, ...styles };
  });

  [...Object.values(input), ...Object.values(groups).flat()].forEach(control => {
    control.addEventListener('input', () => {
      updateLabels();
      send(gatherStyles());
    });
  });

  $('btn-bible-reset-styles').onclick = () => {
    if (document.activeElement) document.activeElement.blur();
    ws.send('reset-bible-styles');
  };
}

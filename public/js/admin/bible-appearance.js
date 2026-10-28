// Aparência da Bíblia no OBS/telão. Tudo vai ao vivo e fica salvo no banco.
import { $ } from './ui.js';
import * as ws from './ws.js';
import { refreshBackgrounds, backgroundExists } from './backgrounds.js';
import { createBackgroundEditor, gradientCss } from './background-editor.js';

// Campos de fundo que todo tema define (para um tema não herdar o fundo do anterior)
const plain = { bgMode: 'color', bgImage: null, bgVignette: false, gradientAnimate: false };

// Temas: degradês novos + os presets que a igreja já usava no programa antigo
const THEMES = [
  {
    name: 'Azul profundo',
    preview: gradientCss({ from: '#0f2027', to: '#2c5364', angle: 135 }),
    styles: { ...plain, layout: 'fullscreen', position: 'center', bgMode: 'gradient', gradientFrom: '#0f2027', gradientTo: '#2c5364', gradientAngle: 135, gradientKind: 'linear', gradientOpacity: 1, bgVignette: true, textColor: '#ffffff', refColor: '#ffeb07', fontSize: '4.4rem' }
  },
  {
    name: 'Luz no centro',
    preview: gradientCss({ from: '#1f5f9a', to: '#050b16', kind: 'radial' }),
    styles: { ...plain, layout: 'fullscreen', position: 'center', bgMode: 'gradient', gradientFrom: '#1f5f9a', gradientTo: '#050b16', gradientKind: 'radial', gradientOpacity: 1, gradientAnimate: true, textColor: '#ffffff', refColor: '#ffeb07', fontSize: '4.4rem' }
  },
  {
    name: 'Vinho',
    preview: gradientCss({ from: '#2b0a12', to: '#7b1e3a', angle: 150 }),
    styles: { ...plain, layout: 'fullscreen', position: 'center', bgMode: 'gradient', gradientFrom: '#2b0a12', gradientTo: '#7b1e3a', gradientAngle: 150, gradientKind: 'linear', gradientOpacity: 1, bgVignette: true, textColor: '#fff7ed', refColor: '#fcd34d', fontSize: '4.4rem' }
  },
  {
    name: 'Padrão (preto)',
    preview: '#000000',
    styles: { ...plain, layout: 'fullscreen', position: 'center', bgColor: 'rgba(0, 0, 0, 1)', textColor: '#ffffff', refColor: '#ffeb07', fontSize: '4.4rem' }
  },
  {
    name: 'Com imagem',
    image: '/backgrounds/biblia_e_mensagens_padrao.jpg',
    styles: { ...plain, layout: 'fullscreen', position: 'center', bgMode: 'image', bgImage: '/backgrounds/biblia_e_mensagens_padrao.jpg', bgColor: 'rgba(0, 0, 0, 0.1)', textColor: '#ffffff', refColor: '#ffeb07', fontSize: '4.4rem' }
  },
  {
    name: 'Rodapé com imagem',
    image: '/backgrounds/biblia_rodape_padrao.jpg',
    styles: { ...plain, layout: 'fullscreen', position: 'bottom', bgMode: 'image', bgImage: '/backgrounds/biblia_rodape_padrao.jpg', bgColor: 'rgba(0, 0, 0, 0)', textColor: '#ffffff', refColor: '#ffeb07', fontSize: '3.6rem' }
  },
  {
    name: 'Faixa (transmissão)',
    preview: gradientCss({ from: '#0a0f1e', to: '#1e3a5f', angle: 90 }),
    styles: { ...plain, layout: 'lower-third', position: 'center', bgMode: 'gradient', gradientFrom: '#0a0f1e', gradientTo: '#1e3a5f', gradientAngle: 90, gradientKind: 'linear', gradientOpacity: 0.92, textColor: '#ffffff', refColor: '#ffeb07', fontSize: '3rem' }
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
  animation: $('bible-animation'),
  speed: $('bible-speed'),
  bandTransp: $('bible-band-transp')
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

let editor = null;

function updateLabels() {
  $('bible-size-val').textContent = input.size.value;
  $('bible-ref-size-val').textContent = input.refSize.value;
  $('bible-speed-val').textContent = `${Number(input.speed.value).toFixed(1)} s`;
  // "Texto embaixo" só faz sentido na tela cheia
  $('bible-position-group').classList.toggle('disabled', checkedValue(groups.layout) !== 'fullscreen');
  // Transparência só vale para a faixa embaixo
  $('bible-band-field').hidden = checkedValue(groups.layout) !== 'lower-third';
  $('bible-band-transp-val').textContent = `${input.bandTransp.value}%`;
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
    animationType: input.animation.value,
    transitionTime: Number(input.speed.value),
    bandTransparency: Number(input.bandTransp.value)
  };
}

function fillInputs(styles) {
  if (!styles) return;
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
  input.animation.value = styles.animationType || 'fade';
  input.speed.value = styles.transitionTime ?? 0.4;
  input.bandTransp.value = styles.bandTransparency ?? 0;
  updateLabels();
  editor.fill(styles);
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
    swatch.style.background = theme.image ? `url("${theme.image}") center / cover` : theme.preview;
    swatch.style.color = theme.styles.textColor;
    swatch.textContent = 'Aa';
    const name = document.createElement('span');
    name.textContent = theme.name;
    btn.append(swatch, name);
    btn.onclick = () => ws.send('update-bible-styles', theme.styles);
    grid.appendChild(btn);
  });
}

export function setupBibleAppearance() {
  editor = createBackgroundEditor($('bible-bg-editor'), {
    name: 'bible-bg',
    defaultColor: { hex: '#000000', opacity: 100 },
    onChange: (partial) => ws.send('update-bible-styles', partial)
  });
  refreshBackgrounds().then(renderThemes);

  const allControls = [...Object.values(input), ...Object.values(groups).flat(), ...editor.controls];
  ws.on('init', (state) => fillInputs(state.bibleStyles));
  ws.on('update-bible-style', (styles) => {
    // Não atrapalha quem está arrastando um controle neste painel
    if (!allControls.includes(document.activeElement)) fillInputs(styles);
  });

  [...Object.values(input), ...Object.values(groups).flat()].forEach(control => {
    control.addEventListener('input', () => {
      updateLabels();
      ws.send('update-bible-styles', gatherStyles());
    });
  });

  $('btn-bible-reset-styles').onclick = () => {
    if (document.activeElement) document.activeElement.blur();
    ws.send('reset-bible-styles');
  };
}

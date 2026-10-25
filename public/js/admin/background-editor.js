// Editor de fundo das camadas de tela (Bíblia e Hinos): Cor, Degradê ou Imagem, e vinheta.
// Monta os controles dentro de `container` e avisa as mudanças por onChange(partial).
import { createBackgroundPicker } from './backgrounds.js';

// Degradês prontos, escolhidos para ler bem com letra branca na transmissão e no telão
export const GRADIENTS = [
  { name: 'Azul profundo', from: '#0f2027', to: '#2c5364', angle: 135 },
  { name: 'Azul real', from: '#141e30', to: '#2a5298', angle: 160 },
  { name: 'Noite roxa', from: '#1a0b2e', to: '#5b2a86', angle: 135 },
  { name: 'Vinho', from: '#2b0a12', to: '#7b1e3a', angle: 150 },
  { name: 'Âmbar', from: '#2a1300', to: '#9a5b13', angle: 135 },
  { name: 'Esmeralda', from: '#02251f', to: '#0f6b58', angle: 140 },
  { name: 'Grafite', from: '#0b0b0d', to: '#33363f', angle: 160 },
  { name: 'Luz no centro', from: '#1f5f9a', to: '#050b16', angle: 0, kind: 'radial' }
];

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseRgba(rgbaStr, fallback) {
  const match = String(rgbaStr).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return fallback;
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  const opacity = match[4] ? Math.round(parseFloat(match[4]) * 100) : 100;
  return { hex: '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1), opacity };
}

export const gradientCss = (g, alpha = 1) => (g.kind === 'radial'
  ? `radial-gradient(circle at 50% 38%, ${hexToRgba(g.from, alpha)}, ${hexToRgba(g.to, alpha)} 75%)`
  : `linear-gradient(${g.angle}deg, ${hexToRgba(g.from, alpha)}, ${hexToRgba(g.to, alpha)})`);

export function createBackgroundEditor(container, { name, defaultColor = { hex: '#000000', opacity: 100 }, onChange }) {
  container.classList.add('bg-editor');
  container.innerHTML = `
    <div class="segmented segmented-3" role="radiogroup" aria-label="Tipo de fundo">
      <label><input type="radio" name="${name}-mode" value="color"><span>Cor</span></label>
      <label><input type="radio" name="${name}-mode" value="gradient"><span>Degradê</span></label>
      <label><input type="radio" name="${name}-mode" value="image"><span>Imagem</span></label>
    </div>

    <div class="bg-section" data-show="gradient">
      <div class="gradient-presets"></div>
      <div class="color-grid color-grid-2">
        <label class="color-field"><input type="color" data-k="from"><span>Cor 1</span></label>
        <label class="color-field"><input type="color" data-k="to"><span>Cor 2</span></label>
      </div>
      <div class="field" data-k-wrap="angle">
        <div class="field-row"><label>Direção</label><output data-out="angle"></output></div>
        <input type="range" min="0" max="360" step="5" data-k="angle">
      </div>
      <label class="switch"><input type="checkbox" data-k="radial"><span class="switch-ui"></span>Circular (luz no centro)</label>
      <label class="switch"><input type="checkbox" data-k="animate"><span class="switch-ui"></span>Movimento suave</label>
      <div class="field">
        <div class="field-row"><label>Opacidade</label><output data-out="gopacity"></output></div>
        <input type="range" min="0" max="100" data-k="gopacity">
      </div>
    </div>

    <div class="bg-section" data-show="image">
      <div class="bg-picker"></div>
    </div>

    <div class="bg-section" data-show="color image">
      <div class="color-row">
        <label class="color-field"><input type="color" data-k="color"><span data-color-label>Cor</span></label>
        <div class="field grow">
          <div class="field-row"><label data-opacity-label>Opacidade</label><output data-out="opacity"></output></div>
          <input type="range" min="0" max="100" data-k="opacity">
        </div>
      </div>
    </div>

    <label class="switch"><input type="checkbox" data-k="vignette"><span class="switch-ui"></span>Vinheta (bordas mais escuras)</label>
  `;

  const q = (k) => container.querySelector(`[data-k="${k}"]`);
  const modes = [...container.querySelectorAll(`input[name="${name}-mode"]`)];
  const controls = ['from', 'to', 'angle', 'radial', 'animate', 'gopacity', 'color', 'opacity', 'vignette'].map(q);
  let image = null;

  const mode = () => (modes.find(r => r.checked) || modes[0]).value;

  function updateView() {
    const m = mode();
    container.querySelectorAll('.bg-section').forEach(sec => { sec.hidden = !sec.dataset.show.split(' ').includes(m); });
    container.querySelector('[data-color-label]').textContent = m === 'image' ? 'Cor por cima' : 'Cor';
    container.querySelector('[data-opacity-label]').textContent = m === 'image' ? 'Escurecer a imagem' : 'Opacidade';
    container.querySelector('[data-out="angle"]').textContent = `${q('angle').value}°`;
    container.querySelector('[data-out="gopacity"]').textContent = `${q('gopacity').value}%`;
    container.querySelector('[data-out="opacity"]').textContent = `${q('opacity').value}%`;
    container.querySelector('[data-k-wrap="angle"]').classList.toggle('disabled', q('radial').checked);
  }

  function gather() {
    return {
      bgMode: mode(),
      bgColor: hexToRgba(q('color').value, Number(q('opacity').value) / 100),
      bgImage: image,
      gradientFrom: q('from').value,
      gradientTo: q('to').value,
      gradientAngle: Number(q('angle').value),
      gradientKind: q('radial').checked ? 'radial' : 'linear',
      gradientAnimate: q('animate').checked,
      gradientOpacity: Number(q('gopacity').value) / 100,
      bgVignette: q('vignette').checked
    };
  }

  const emit = () => {
    updateView();
    onChange(gather());
  };

  // Degradês prontos
  const presets = container.querySelector('.gradient-presets');
  GRADIENTS.forEach(g => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gradient-chip';
    btn.title = g.name;
    btn.style.background = gradientCss(g);
    btn.onclick = () => {
      q('from').value = g.from;
      q('to').value = g.to;
      q('angle').value = g.angle;
      q('radial').checked = g.kind === 'radial';
      emit();
      presets.querySelectorAll('.gradient-chip').forEach(c => c.classList.toggle('active', c === btn));
    };
    presets.appendChild(btn);
  });

  // Imagens
  const picker = createBackgroundPicker(container.querySelector('.bg-picker'), {
    getValue: () => image,
    onSelect: (url) => {
      image = url;
      // Fundo opaco por cima esconderia a imagem: deixa só um leve escurecido
      if (url && Number(q('opacity').value) >= 90) q('opacity').value = 15;
      emit();
      picker.render();
    }
  });

  modes.forEach(r => r.addEventListener('input', emit));
  controls.forEach(c => c.addEventListener('input', emit));

  return {
    controls: [...modes, ...controls],
    // Preenche os controles com os estilos vindos do servidor
    fill(s) {
      const m = s.bgMode || (s.bgImage ? 'image' : 'color');
      modes.forEach(r => { r.checked = r.value === m; });
      const { hex, opacity } = parseRgba(s.bgColor, defaultColor);
      q('color').value = hex;
      q('opacity').value = opacity;
      q('from').value = s.gradientFrom || GRADIENTS[0].from;
      q('to').value = s.gradientTo || GRADIENTS[0].to;
      q('angle').value = s.gradientAngle ?? GRADIENTS[0].angle;
      q('radial').checked = s.gradientKind === 'radial';
      q('animate').checked = !!s.gradientAnimate;
      q('gopacity').value = Math.round((s.gradientOpacity ?? 1) * 100);
      q('vignette').checked = !!s.bgVignette;
      image = s.bgImage || null;
      picker.render();
      updateView();
    }
  };
}

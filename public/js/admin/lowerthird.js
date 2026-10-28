// Nome do pregador (lower third), na aba Culto: lista de pregadores, mostrar/esconder e aparência.
// A faixa é a mesma do louvor especial (special.js), cada um com o seu visual.
import { $, toast, confirmDialog, previewInPanel } from './ui.js';
import * as ws from './ws.js';

let preachers = [];
let selectedId = null;
let editingId = null;
let lt = { visible: false, name: '', subtitle: '', kind: 'preacher' };
const preacherOnAir = () => lt.visible && lt.kind !== 'special';

try { selectedId = localStorage.getItem('amc.preacher'); } catch (e) { /* sem armazenamento */ }

const selected = () => preachers.find(p => p.id === selectedId) || null;

// ---------- Lista ----------

async function loadPreachers() {
  try {
    preachers = await (await fetch('/api/preachers')).json();
  } catch (err) {
    preachers = [];
  }
  if (!selected() && preachers.length) selectPreacher(preachers[0].id);
  renderList();
}

function selectPreacher(id) {
  selectedId = id;
  try { localStorage.setItem('amc.preacher', id); } catch (e) { /* sem armazenamento */ }
  renderList();
}

function renderList() {
  const list = $('lt-list');
  list.innerHTML = '';
  if (preachers.length === 0) {
    list.innerHTML = '<div class="empty">Cadastre o pregador com <strong>+ Pregador</strong>.</div>';
  }
  preachers.forEach(p => {
    const row = document.createElement('div');
    row.className = 'lt-row';
    row.classList.toggle('active', p.id === selectedId);
    row.classList.toggle('on-air', preacherOnAir() && lt.name === p.name);
    row.onclick = () => selectPreacher(p.id);

    const text = document.createElement('div');
    text.className = 'lt-row-text';
    const name = document.createElement('strong');
    name.textContent = p.name;
    text.appendChild(name);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn-x small';
    edit.title = 'Editar';
    edit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    edit.onclick = (e) => { e.stopPropagation(); openForm(p); };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x small';
    remove.title = 'Apagar';
    remove.textContent = '×';
    remove.onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog({ title: 'Apagar pregador?', text: `"${p.name}" sai da lista.`, okLabel: 'Apagar', danger: true });
      if (!ok) return;
      await fetch(`/api/preachers/${p.id}`, { method: 'DELETE' });
      if (selectedId === p.id) selectedId = null;
      loadPreachers();
    };

    row.append(text, edit, remove);
    list.appendChild(row);
  });
  renderButton();
}

function renderButton() {
  const btn = $('btn-lt-toggle');
  const p = selected();
  const onAir = preacherOnAir();
  btn.disabled = !onAir && !p;
  btn.classList.toggle('btn-danger', onAir);
  btn.classList.toggle('btn-primary', !onAir);
  btn.innerHTML = onAir ? 'Esconder nome <kbd>N</kbd>' : 'Mostrar nome <kbd>N</kbd>';

  // Lembrete no topo enquanto o nome (ou o louvor especial) está na tela
  const chip = $('lt-chip');
  chip.hidden = !lt.visible;
  $('lt-chip-label').textContent = lt.visible ? `${lt.kind === 'special' ? 'Louvor no ar' : 'Nome no ar'} · ${lt.name}` : '';
}

function openForm(preacher) {
  editingId = preacher ? preacher.id : null;
  const form = $('lt-form');
  $('lt-form-name').value = preacher ? preacher.name : '';
  form.hidden = false;
  $('lt-form-name').focus();
}

function setupForm() {
  const form = $('lt-form');
  $('btn-lt-add').onclick = () => openForm(null);
  $('btn-lt-cancel').onclick = () => { form.hidden = true; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { name: $('lt-form-name').value, subtitle: '' };
    const res = await fetch(editingId ? `/api/preachers/${editingId}` : '/api/preachers', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Não foi possível salvar.', 'error');
      return;
    }
    form.hidden = true;
    selectPreacher(data.preacher.id);
    loadPreachers();
  };
}

// Mostra o pregador escolhido ou esconde o nome (botão e tecla N). Só o nome, sem nada embaixo.
export function toggleLowerThird() {
  // Com o louvor especial no ar, o N troca pelo nome do pregador
  if (preacherOnAir()) {
    ws.send('lt-hide');
    return;
  }
  const p = selected();
  if (p) ws.send('lt-show', { name: p.name, subtitle: '', kind: 'preacher' });
  else toast('Cadastre e escolha o pregador na aba Culto.', 'error');
}

// ---------- Aparência (serve para o pregador e para o louvor especial) ----------

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
  return { hex: '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1), opacity: match[4] ? Math.round(parseFloat(match[4]) * 100) : 100 };
}

// Liga os controles de aparência de uma faixa. `prefix` = começo dos ids no admin.html
// ("lt" para o pregador, "sp" para o louvor especial); `type` = nome nas mensagens do
// WebSocket ("lt" -> update-lt-styles / update-lt-style / reset-lt-styles).
export function setupLtStyleControls({ prefix, type, stateKey, preview, defaults = {} }) {
  const id = (name) => $(`${prefix}-${name}`);
  const lookRadios = [...document.querySelectorAll(`input[name="${prefix}-look"]`)];
  const speedRadios = [...document.querySelectorAll(`input[name="${prefix}-speed"]`)];
  const inputs = ['autohide', 'position', 'animation', 'font', 'scale', 'name-color', 'subtitle-color', 'accent-color', 'bg-color', 'bg-opacity'].map(id);

  const fill = (s) => {
    if (!s || inputs.includes(document.activeElement)) return;
    id('autohide').value = String(s.autoHide ?? 8);
    id('position').value = s.position || 'bottom-left';
    id('animation').value = s.animation || 'slide';
    id('font').value = s.fontFamily || 'Montserrat, sans-serif';
    id('scale').value = s.scale ?? 1;
    id('scale-val').textContent = `${Math.round((s.scale ?? 1) * 100)}%`;
    id('name-color').value = s.nameColor || '#ffffff';
    id('subtitle-color').value = s.subtitleColor || '#cbd5e1';
    id('accent-color').value = s.accentColor || defaults.accentColor || '#3b82f6';
    const { hex, opacity } = parseRgba(s.bgColor);
    id('bg-color').value = hex;
    id('bg-opacity').value = opacity;
    id('opacity-val').textContent = `${opacity}%`;
    lookRadios.forEach(r => { r.checked = r.value === (s.look || 'modern'); });
    speedRadios.forEach(r => { r.checked = Number(r.value) === Number(s.speed || 1); });
  };

  const send = () => {
    id('scale-val').textContent = `${Math.round(Number(id('scale').value) * 100)}%`;
    id('opacity-val').textContent = `${id('bg-opacity').value}%`;
    ws.send(`update-${type}-styles`, {
      autoHide: Number(id('autohide').value),
      position: id('position').value,
      animation: id('animation').value,
      fontFamily: id('font').value,
      scale: Number(id('scale').value),
      nameColor: id('name-color').value,
      subtitleColor: id('subtitle-color').value,
      accentColor: id('accent-color').value,
      bgColor: hexToRgba(id('bg-color').value, Number(id('bg-opacity').value) / 100),
      look: (lookRadios.find(r => r.checked) || lookRadios[0]).value,
      speed: Number((speedRadios.find(r => r.checked) || speedRadios[1]).value)
    });
  };

  ws.on('init', (state) => fill(state[stateKey]));
  ws.on(`update-${type}-style`, fill);
  [...inputs, ...lookRadios, ...speedRadios].forEach(input => input.addEventListener('input', send));
  // "Ver o efeito" e trocar efeito/velocidade/estilo mostram como fica só na prévia do painel
  $(`btn-${prefix}-preview`).onclick = preview;
  [id('animation'), ...speedRadios, ...lookRadios].forEach(input => input.addEventListener('change', () => setTimeout(preview, 250)));
  $(`btn-${prefix}-reset`).onclick = () => ws.send(`reset-${type}-styles`);
}

export function setupLowerThird() {
  const onState = (state) => {
    lt = state.lowerThird || lt;
    renderList();
  };
  ws.on('init', onState);
  ws.on('update-content', onState);

  setupLtStyleControls({
    prefix: 'lt',
    type: 'lt',
    stateKey: 'lowerThirdStyles',
    preview: () => {
      const p = selected();
      previewInPanel({ type: 'preview-lt', name: p ? p.name : 'Pr. Nome do Pregador', subtitle: '', kind: 'preacher' });
    }
  });
  $('btn-lt-toggle').onclick = toggleLowerThird;
  $('lt-chip').onclick = () => ws.send('lt-hide');

  setupForm();
  loadPreachers();
}

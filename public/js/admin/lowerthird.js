// Nome do pregador (lower third), na aba Culto: lista de pregadores, leitura do culto
// (vai embaixo do nome), mostrar/esconder e aparência.
import { $, toast, confirmDialog, previewInPanel } from './ui.js';
import * as ws from './ws.js';

let preachers = [];
let selectedId = null;
let editingId = null;
let lt = { visible: false, name: '', subtitle: '' };
let reading = '';      // leitura do culto, guardada no servidor
let readingTimer = null;

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
    row.classList.toggle('on-air', lt.visible && lt.name === p.name);
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
  btn.disabled = !lt.visible && !p;
  btn.classList.toggle('btn-danger', lt.visible);
  btn.classList.toggle('btn-primary', !lt.visible);
  btn.innerHTML = lt.visible ? 'Esconder nome <kbd>N</kbd>' : 'Mostrar nome <kbd>N</kbd>';

  // Lembrete no topo enquanto o nome está na tela
  const chip = $('lt-chip');
  chip.hidden = !lt.visible;
  $('lt-chip-label').textContent = lt.visible ? `Nome no ar · ${lt.name}` : '';
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

// Mostra o pregador escolhido ou esconde o nome (botão e tecla N)
export function toggleLowerThird() {
  if (lt.visible) {
    ws.send('lt-hide');
    return;
  }
  const p = selected();
  if (p) ws.send('lt-show', { name: p.name, subtitle: currentReading() });
  else toast('Cadastre e escolha o pregador na aba Culto.', 'error');
}

// O que está digitado agora (pode ainda não ter chegado ao servidor)
const currentReading = () => $('service-reading').value.trim();

function setupReading() {
  const input = $('service-reading');
  input.addEventListener('input', () => {
    clearTimeout(readingTimer);
    readingTimer = setTimeout(() => ws.send('service-reading', { text: input.value }), 400);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
}

// ---------- Aparência ----------

const lookRadios = [...document.querySelectorAll('input[name="lt-look"]')];
const speedRadios = [...document.querySelectorAll('input[name="lt-speed"]')];

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

const styleInputs = ['lt-autohide', 'lt-position', 'lt-animation', 'lt-font', 'lt-scale', 'lt-name-color', 'lt-subtitle-color', 'lt-accent-color', 'lt-bg-color', 'lt-bg-opacity'].map($);

function fillStyles(s) {
  if (!s || styleInputs.includes(document.activeElement)) return;
  $('lt-autohide').value = String(s.autoHide ?? 8);
  $('lt-position').value = s.position || 'bottom-left';
  $('lt-animation').value = s.animation || 'slide';
  $('lt-font').value = s.fontFamily || 'Montserrat, sans-serif';
  $('lt-scale').value = s.scale ?? 1;
  $('lt-scale-val').textContent = `${Math.round((s.scale ?? 1) * 100)}%`;
  $('lt-name-color').value = s.nameColor || '#ffffff';
  $('lt-subtitle-color').value = s.subtitleColor || '#cbd5e1';
  $('lt-accent-color').value = s.accentColor || '#3b82f6';
  const { hex, opacity } = parseRgba(s.bgColor);
  $('lt-bg-color').value = hex;
  $('lt-bg-opacity').value = opacity;
  $('lt-opacity-val').textContent = `${opacity}%`;
  lookRadios.forEach(r => { r.checked = r.value === (s.look || 'modern'); });
  speedRadios.forEach(r => { r.checked = Number(r.value) === Number(s.speed || 1); });
}

function sendStyles() {
  $('lt-scale-val').textContent = `${Math.round(Number($('lt-scale').value) * 100)}%`;
  $('lt-opacity-val').textContent = `${$('lt-bg-opacity').value}%`;
  ws.send('update-lt-styles', {
    autoHide: Number($('lt-autohide').value),
    position: $('lt-position').value,
    animation: $('lt-animation').value,
    fontFamily: $('lt-font').value,
    scale: Number($('lt-scale').value),
    nameColor: $('lt-name-color').value,
    subtitleColor: $('lt-subtitle-color').value,
    accentColor: $('lt-accent-color').value,
    bgColor: hexToRgba($('lt-bg-color').value, Number($('lt-bg-opacity').value) / 100),
    look: (lookRadios.find(r => r.checked) || lookRadios[0]).value,
    speed: Number((speedRadios.find(r => r.checked) || speedRadios[1]).value)
  });
}

export function setupLowerThird() {
  const onState = (state) => {
    lt = state.lowerThird || lt;
    // A leitura pode ter sido trocada em outro aparelho
    if (state.serviceReading !== undefined && state.serviceReading !== reading) {
      reading = state.serviceReading;
      if (document.activeElement !== $('service-reading')) $('service-reading').value = reading;
    }
    renderList();
  };
  ws.on('init', (state) => { onState(state); fillStyles(state.lowerThirdStyles); });
  ws.on('update-content', onState);
  ws.on('update-lt-style', fillStyles);

  [...styleInputs, ...lookRadios, ...speedRadios].forEach(input => input.addEventListener('input', sendStyles));

  // Mostra o efeito escolhido só na prévia do painel (não vai para o OBS)
  const previewEffect = () => {
    const p = selected();
    previewInPanel({ type: 'preview-lt', name: p ? p.name : 'Pr. Nome do Pregador', subtitle: currentReading() });
  };
  $('btn-lt-preview').onclick = previewEffect;
  // Ao trocar o efeito ou a velocidade, já mostra como fica (o estilo novo chega no overlay antes)
  [$('lt-animation'), ...speedRadios, ...lookRadios].forEach(input => input.addEventListener('change', () => setTimeout(previewEffect, 250)));
  $('btn-lt-reset').onclick = () => ws.send('reset-lt-styles');
  $('btn-lt-toggle').onclick = toggleLowerThird;
  $('lt-chip').onclick = () => ws.send('lt-hide');

  setupForm();
  setupReading();
  loadPreachers();
}

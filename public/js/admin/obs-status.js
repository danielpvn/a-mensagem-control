// OBS em outro computador: chip "OBS" no topo (conectado ou não), links com o nome e o IP
// deste PC em Configurações, liberar o Firewall e o aviso do som quando o OBS está em outro PC.
import { $, toast, copyText, selectTab } from './ui.js';
import * as ws from './ws.js';

let clients = [];
let mediaAudio = 'obs';
let soundOutput = 'app';

const remoteOnly = () => clients.length > 0 && !clients.some(c => c.local);
const label = (c) => (c.local ? 'este computador' : c.name ? `${c.name} (${c.ip})` : c.ip);

function render() {
  const chip = $('obs-chip');
  const on = clients.length > 0;
  chip.classList.toggle('is-on', on);
  chip.title = on
    ? `OBS conectado: ${clients.map(label).join(', ')}`
    : 'OBS não conectado: o link do overlay não está aberto em nenhum OBS. Clique para ver o link.';

  const now = $('obs-now');
  now.innerHTML = on
    ? clients.map(c => `<span class="ok">✓ OBS conectado em ${escapeHtml(label(c))}</span>`).join('')
    : '<span class="off">Nenhum OBS conectado agora.</span><span class="muted">Abra o OBS com a fonte Navegador no link abaixo. Se estiver aberto e não aparecer aqui, confira o link e o Firewall.</span>';

  // O som "neste computador" não chega no OBS de outro PC
  const warn = (kind, output) => {
    const el = document.querySelector(`[data-obs-warn="${kind}"]`);
    if (el) el.hidden = !(remoteOnly() && output === 'app');
  };
  warn('media', mediaAudio);
  warn('sound', soundOutput);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

async function loadLinks() {
  try {
    const info = await (await fetch('/api/info')).json();
    $('obs-url-name').value = `http://${info.hostname}:${info.port}/obs`;
    const box = $('obs-ip-urls');
    box.innerHTML = '';
    if (!info.lanUrls.length) box.innerHTML = '<div class="empty">Este computador não está conectado a uma rede.</div>';
    info.lanUrls.forEach(base => {
      const url = `${base}/obs`;
      const row = document.createElement('div');
      row.className = 'copy-field';
      const field = document.createElement('input');
      field.type = 'text';
      field.readOnly = true;
      field.value = url;
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary btn-sm';
      btn.textContent = 'Copiar';
      btn.onclick = () => copyText(url);
      row.append(field, btn);
      box.appendChild(row);
    });
  } catch (err) {
    console.error('Erro ao carregar os links do OBS:', err);
  }
}

// Só no próprio computador do programa (o celular não libera o Firewall do PC)
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

function renderFirewall(status) {
  const box = $('obs-firewall');
  box.hidden = !status || !status.supported;
  if (box.hidden) return;
  box.classList.toggle('is-ok', !!status.allowed);
  $('obs-firewall-text').textContent = status.allowed
    ? '✓ Firewall do Windows liberado para o OBS de outro computador.'
    : 'O Firewall do Windows pode estar bloqueando o OBS de outro computador.';
  $('btn-obs-firewall').hidden = !!status.allowed || !IS_LOCAL;
}

async function loadFirewall() {
  try {
    renderFirewall(await (await fetch('/api/firewall')).json());
  } catch { /* sem resposta: deixa escondido */ }
}

async function allowFirewall() {
  const btn = $('btn-obs-firewall');
  btn.disabled = true;
  btn.textContent = 'Confirme na janela do Windows...';
  try {
    const status = await (await fetch('/api/firewall', { method: 'POST' })).json();
    renderFirewall(status);
    toast(status.allowed ? 'Firewall liberado.' : 'O Firewall não foi liberado (a permissão foi negada?).', status.allowed ? 'success' : 'error');
  } catch {
    toast('Não consegui liberar o Firewall.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Liberar no Firewall';
  }
}

export function setupObsStatus() {
  ws.on('obs-status', (status) => { clients = (status && status.clients) || []; render(); });
  ws.on('init', (state) => {
    mediaAudio = (state.mediaStyles && state.mediaStyles.audioOutput) || 'obs';
    soundOutput = state.soundOutput || 'app';
    render();
  });
  ws.on('update-content', (state) => {
    if (state.soundOutput && state.soundOutput !== soundOutput) { soundOutput = state.soundOutput; render(); }
  });
  ws.on('update-media-style', (s) => {
    if (s && s.audioOutput && s.audioOutput !== mediaAudio) { mediaAudio = s.audioOutput; render(); }
  });
  // Escolher no rádio também esconde o aviso na hora
  document.querySelectorAll('input[name="sound-output"]').forEach(r => r.addEventListener('change', () => { soundOutput = r.value; render(); }));
  document.querySelectorAll('input[name="media-audio"]').forEach(r => r.addEventListener('change', () => { mediaAudio = r.value; render(); }));

  document.querySelector('[data-obs-warn="media"] button').onclick = () => ws.send('update-media-styles', { audioOutput: 'obs' });
  document.querySelector('[data-obs-warn="sound"] button').onclick = () => ws.send('sound-output', { output: 'obs' });
  $('obs-chip').onclick = () => {
    selectTab('config');
    $('obs-now').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  $('btn-obs-firewall').onclick = allowFirewall;
  loadLinks();
  loadFirewall();
  render();
}

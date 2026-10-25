// Banco online: status, login da igreja e sincronizar agora (Configurações), e a bolinha no topo.
import { $, toast } from './ui.js';
import * as ws from './ws.js';

const LABELS = {
  off: ['Desligado', 'badge-off'],
  idle: ['Conectado', 'badge-soft'],
  syncing: ['Sincronizando', 'badge-soft'],
  ok: ['Sincronizado', 'badge-ok'],
  error: ['Com problema', 'badge-armed']
};

function timeAgo(iso) {
  if (!iso) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function render(s) {
  if (!s) return;
  const state = s.loggedIn ? s.state : 'off';
  const [label, cls] = LABELS[state] || LABELS.off;
  $('cloud-badge').textContent = label;
  $('cloud-badge').className = `badge ${cls}`;

  let text;
  if (!s.configured) text = 'O endereço do banco online ainda não foi configurado (veja "Avançado").';
  else if (!s.loggedIn) text = 'Entre com o login da igreja para receber a biblioteca de mensagens, hinos e fundos.';
  else {
    const role = s.role === 'editor' ? 'editor (publica para todas as igrejas)' : 'leitor (recebe a biblioteca)';
    text = `${s.email}${s.church ? ` · ${s.church}` : ''} · ${role}. ${s.message || ''}${s.lastSync ? ` Última vez ${timeAgo(s.lastSync)}.` : ''}`;
  }
  $('cloud-status-text').textContent = text;

  const pending = s.pending || {};
  const count = (pending.sermons || 0) + (pending.hymns || 0) + (pending.deletions || 0);
  $('cloud-pending').textContent = !s.loggedIn || !count ? ''
    : s.role === 'editor'
      ? `${count} alteração(ões) esperando para enviar.`
      : `${count} item(ns) cadastrados só neste computador (só editores publicam).`;

  $('cloud-login-form').hidden = !s.configured || s.loggedIn;
  $('cloud-actions').hidden = !s.loggedIn;
  if (document.activeElement !== $('cloud-url')) $('cloud-url').value = s.url || '';

  // Bolinha no topo: verde sincronizado, azul sincronizando, amarela com problema
  const dot = $('cloud-dot');
  dot.hidden = !s.loggedIn;
  dot.className = `cloud-dot is-${state}`;
  dot.title = `Banco online: ${label.toLowerCase()}${s.lastSync ? ` (${timeAgo(s.lastSync)})` : ''}`;
}

async function refresh() {
  try {
    render(await (await fetch('/api/cloud/status')).json());
  } catch (err) {
    // painel sem acesso à API (PIN): ignora
  }
}

export function setupCloud() {
  ws.on('sync-status', render);

  $('cloud-login-form').onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const res = await fetch('/api/cloud/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('cloud-email').value, password: $('cloud-password').value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      $('cloud-password').value = '';
      toast('Conectado ao banco online. Baixando a biblioteca...', 'success');
      render(data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  };

  $('btn-cloud-sync').onclick = async () => {
    render(await (await fetch('/api/cloud/sync', { method: 'POST' })).json());
  };

  $('btn-cloud-logout').onclick = async () => {
    render(await (await fetch('/api/cloud/logout', { method: 'POST' })).json());
    toast('Desconectado do banco online. A biblioteca continua neste computador.', 'success');
  };

  $('cloud-config-form').onsubmit = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/cloud/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: $('cloud-url').value, anonKey: $('cloud-key').value })
    });
    render(await res.json());
    $('cloud-key').value = '';
    toast('Configuração salva. Entre de novo com o login da igreja.', 'success');
  };

  $('cloud-dot').onclick = () => document.querySelector('.tab[data-tab="config"]').click();
  refresh();
  setInterval(refresh, 60000); // atualiza o "há X min"
}

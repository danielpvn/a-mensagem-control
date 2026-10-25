// Banco online: status, login/pedido de acesso da igreja, sincronizar agora e (para editores)
// aprovar os pedidos de acesso das outras igrejas. Também a bolinha de nuvem no topo.
import { $, toast, confirmDialog } from './ui.js';
import * as ws from './ws.js';

const LABELS = {
  off: ['Desligado', 'badge-off'],
  idle: ['Conectado', 'badge-soft'],
  syncing: ['Sincronizando', 'badge-soft'],
  ok: ['Sincronizado', 'badge-ok'],
  error: ['Com problema', 'badge-armed'],
  pending: ['Aguardando aprovação', 'badge-armed'],
  blocked: ['Sem acesso', 'badge-off']
};

const ROLE_NAMES = {
  editor: 'editor (publica para todas as igrejas)',
  reader: 'leitor (recebe a biblioteca)',
  pending: 'aguardando aprovação',
  blocked: 'sem acesso'
};

let lastRequests = 0;
let showingSignup = false;
let currentRole = null;

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
    const role = ROLE_NAMES[s.role] || s.role;
    text = `${s.email}${s.church ? ` · ${s.church}` : ''} · ${role}. ${s.message || ''}${s.lastSync && s.state === 'ok' ? ` Última vez ${timeAgo(s.lastSync)}.` : ''}`;
  }
  $('cloud-status-text').textContent = text;

  const pending = s.pending || {};
  const count = (pending.sermons || 0) + (pending.hymns || 0) + (pending.deletions || 0);
  $('cloud-pending').textContent = !s.loggedIn || !count || s.role === 'pending' ? ''
    : s.role === 'editor'
      ? `${count} alteração(ões) esperando para enviar.`
      : `${count} item(ns) cadastrados só neste computador (só editores publicam).`;

  $('cloud-login-form').hidden = !s.configured || s.loggedIn || showingSignup;
  $('cloud-signup-form').hidden = !s.configured || s.loggedIn || !showingSignup;
  $('cloud-actions').hidden = !s.loggedIn;
  $('cloud-members').hidden = s.role !== 'editor' || !s.loggedIn;
  if (document.activeElement !== $('cloud-url')) $('cloud-url').value = s.url || '';

  // Bolinha no topo: verde sincronizado, azul sincronizando, amarela com problema ou aguardando
  const dot = $('cloud-dot');
  dot.hidden = !s.loggedIn;
  dot.className = `cloud-dot is-${state}`;
  dot.dataset.count = s.requests ? String(s.requests) : '';
  dot.title = s.requests
    ? `${s.requests} pedido(s) de acesso esperando aprovação`
    : `Banco online: ${label.toLowerCase()}${s.lastSync ? ` (${timeAgo(s.lastSync)})` : ''}`;

  // Editor: avisa quando chega pedido novo e atualiza a lista
  if (s.role === 'editor' && (s.requests || 0) > lastRequests) {
    toast(`${s.requests} igreja(s) pedindo acesso à biblioteca. Veja em Configurações.`);
    loadMembers();
  }
  if (s.role === 'editor' && currentRole !== 'editor') loadMembers();
  lastRequests = s.requests || 0;
  currentRole = s.role;
}

async function refresh() {
  try {
    render(await (await fetch('/api/cloud/status')).json());
  } catch (err) {
    // painel sem acesso à API (PIN): ignora
  }
}

// ---------- Igrejas e pedidos (editores) ----------

async function loadMembers() {
  const box = $('cloud-members-list');
  try {
    const res = await fetch('/api/cloud/members');
    const members = await res.json();
    if (!res.ok) throw new Error(members.error);
    renderMembers(members);
  } catch (err) {
    box.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = `Não foi possível carregar: ${err.message}`;
    box.appendChild(p);
  }
}

async function setRole(member, role) {
  if (role === 'blocked') {
    const ok = await confirmDialog({
      title: member.role === 'pending' ? 'Recusar o pedido?' : 'Tirar o acesso?',
      text: `${member.church || member.email} não vai mais receber a biblioteca. Dá para aprovar de novo depois.`,
      okLabel: member.role === 'pending' ? 'Recusar' : 'Tirar acesso',
      danger: true
    });
    if (!ok) return;
  }
  const res = await fetch(`/api/cloud/members/${member.user_id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role })
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.error || 'Não foi possível mudar.', 'error');
    return;
  }
  toast(role === 'blocked' ? 'Acesso retirado.' : `${member.church || member.email}: ${ROLE_NAMES[role]}.`, 'success');
  renderMembers(data);
  refresh();
}

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn btn-sm ${cls}`;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function renderMembers(members) {
  const box = $('cloud-members-list');
  box.innerHTML = '';
  // Pedidos novos primeiro, depois as igrejas aprovadas, por último as sem acesso
  const order = { pending: 0, editor: 1, reader: 1, blocked: 2 };
  members.sort((a, b) => order[a.role] - order[b.role]);

  members.forEach(m => {
    const row = document.createElement('div');
    row.className = `member-row is-${m.role}`;

    const info = document.createElement('div');
    info.className = 'member-info';
    const name = document.createElement('strong');
    name.textContent = m.church || '(igreja sem nome)';
    const sub = document.createElement('span');
    sub.textContent = `${m.email || ''}${m.isMe ? ' · você' : ''} · ${m.role === 'pending' ? `pediu em ${new Date(m.created_at).toLocaleDateString('pt-BR')}` : ROLE_NAMES[m.role]}`;
    info.append(name, sub);

    const actions = document.createElement('div');
    actions.className = 'member-actions';
    if (!m.isMe) {
      if (m.role === 'pending') {
        actions.append(
          button('Aprovar', 'btn-primary', () => setRole(m, 'reader')),
          button('Como editor', 'btn-secondary', () => setRole(m, 'editor')),
          button('Recusar', 'btn-ghost-danger', () => setRole(m, 'blocked'))
        );
      } else if (m.role === 'blocked') {
        actions.append(button('Dar acesso', 'btn-secondary', () => setRole(m, 'reader')));
      } else {
        actions.append(
          m.role === 'reader'
            ? button('Tornar editor', 'btn-secondary', () => setRole(m, 'editor'))
            : button('Tornar leitor', 'btn-secondary', () => setRole(m, 'reader')),
          button('Tirar acesso', 'btn-ghost-danger', () => setRole(m, 'blocked'))
        );
      }
    }
    row.append(info, actions);
    box.appendChild(row);
  });
  if (members.length === 0) box.innerHTML = '<p class="muted small">Nenhuma igreja ainda.</p>';
}

// ---------- Formulários ----------

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

export function setupCloud() {
  ws.on('sync-status', render);

  $('cloud-login-form').onsubmit = async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      const data = await postJson('/api/cloud/login', { email: $('cloud-email').value, password: $('cloud-password').value });
      $('cloud-password').value = '';
      toast(data.role === 'pending' ? 'Entrou. O pedido de acesso ainda espera aprovação.' : 'Conectado ao banco online. Baixando a biblioteca...', 'success');
      render(data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  };

  $('cloud-signup-form').onsubmit = async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      const data = await postJson('/api/cloud/signup', {
        church: $('cloud-signup-church').value,
        email: $('cloud-signup-email').value,
        password: $('cloud-signup-password').value
      });
      $('cloud-signup-password').value = '';
      if (data.needsConfirmation) {
        toast('Pedido criado. Abra o e-mail que chegou, confirme e depois clique em Entrar.', 'success');
        showingSignup = false;
      } else {
        toast('Pedido de acesso enviado! Assim que for aprovado, a biblioteca começa a chegar.', 'success');
      }
      render(data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  };

  $('btn-cloud-show-signup').onclick = () => { showingSignup = true; refresh(); };
  $('btn-cloud-show-login').onclick = () => { showingSignup = false; refresh(); };
  $('btn-cloud-members-refresh').onclick = loadMembers;

  $('btn-cloud-sync').onclick = async () => {
    render(await (await fetch('/api/cloud/sync', { method: 'POST' })).json());
  };

  $('btn-cloud-logout').onclick = async () => {
    showingSignup = false;
    render(await (await fetch('/api/cloud/logout', { method: 'POST' })).json());
    toast('Desconectado do banco online. A biblioteca continua neste computador.', 'success');
  };

  $('cloud-config-form').onsubmit = async (e) => {
    e.preventDefault();
    render(await postJson('/api/cloud/config', { url: $('cloud-url').value, anonKey: $('cloud-key').value }));
    $('cloud-key').value = '';
    toast('Configuração salva. Entre de novo com o login da igreja.', 'success');
  };

  $('cloud-dot').onclick = () => document.querySelector('.tab[data-tab="config"]').click();
  refresh();
  setInterval(refresh, 60000); // atualiza o "há X min"
}

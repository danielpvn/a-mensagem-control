// Aba Configurações: link do OBS, acesso por outro aparelho e atualizações.
import { $, toast, copyText, confirmDialog } from './ui.js';
import * as ws from './ws.js';

async function loadInfo() {
  try {
    const info = await (await fetch('/api/info')).json();
    const version = `v${info.version}`;
    $('app-version').textContent = version;
    $('about-version').textContent = version;
    $('obs-url').value = `http://localhost:${info.port}/overlay.html`;

    const box = $('lan-urls');
    box.innerHTML = '';
    if (info.lanUrls.length === 0) {
      box.innerHTML = '<div class="empty">Este computador não está conectado a uma rede.</div>';
    }
    info.lanUrls.forEach(base => {
      const url = `${base}/admin.html`;
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
    console.error('Erro ao carregar informações:', err);
  }
}

async function startUpdate(version) {
  const ok = await confirmDialog({
    title: `Atualizar para a versão ${version}?`,
    text: 'O programa vai baixar a nova versão, fechar e abrir sozinho. Não faça isso durante o culto.',
    okLabel: 'Atualizar agora'
  });
  if (!ok) return;

  $('update-progress').hidden = false;
  try {
    const res = await fetch('/api/trigger-update', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Erro desconhecido');
    }
  } catch (err) {
    $('update-progress').hidden = true;
    toast(`Falha ao atualizar: ${err.message}`, 'error');
  }
}

async function checkUpdates(manual = false) {
  const status = $('update-status');
  if (manual) status.textContent = 'Verificando...';
  try {
    const data = await (await fetch('/api/check-update')).json();
    if (data.updateAvailable) {
      $('update-version-text').textContent = `v${data.onlineVersion}${data.isBeta ? ' (teste)' : ''}`;
      $('update-notes').textContent = data.notes || '';
      $('update-banner').hidden = false;
      $('btn-start-update').onclick = () => startUpdate(data.onlineVersion);
      status.textContent = `Versão v${data.onlineVersion}${data.isBeta ? ' de teste' : ''} disponível.`;
    } else if (data.error) {
      status.textContent = manual ? 'Sem conexão com a internet para verificar.' : '';
    } else {
      status.textContent = manual ? 'Você já está na versão mais recente.' : '';
    }
  } catch (err) {
    if (manual) status.textContent = 'Não foi possível verificar agora.';
  }
}

async function loadSecurity() {
  try {
    const data = await (await fetch('/api/security')).json();
    $('pin-status').textContent = data.hasPin
      ? 'PIN ativo: celulares e outros computadores precisam do PIN para controlar.'
      : 'Sem PIN: qualquer aparelho no mesmo Wi-Fi pode controlar o app. Recomendado criar um PIN.';
    $('btn-pin-remove').hidden = !data.hasPin;
  } catch (err) {
    $('pin-status').textContent = 'Não foi possível verificar.';
  }
}

async function savePin(pin) {
  const res = await fetch('/api/security/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.hasPin;
}

function setupSecurity() {
  $('pin-set-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await savePin($('pin-new').value);
      $('pin-new').value = '';
      toast('PIN salvo.', 'success');
      loadSecurity();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  $('btn-pin-remove').onclick = async () => {
    const ok = await confirmDialog({ title: 'Remover o PIN?', text: 'Qualquer aparelho no mesmo Wi-Fi poderá controlar o app.', okLabel: 'Remover', danger: true });
    if (!ok) return;
    await savePin('');
    toast('PIN removido.', 'success');
    loadSecurity();
  };
  loadSecurity();
}

// Canal de testes: liga/desliga e já procura a versão do canal escolhido
async function setupBetaChannel() {
  const box = $('beta-updates');
  try {
    box.checked = !!(await (await fetch('/api/update-channel')).json()).beta;
  } catch (err) {
    // sem servidor: fica desligado
  }
  box.onchange = async () => {
    await fetch('/api/update-channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beta: box.checked })
    });
    toast(box.checked ? 'Este computador vai receber as versões de teste.' : 'Este computador volta a receber só as versões oficiais.', 'success');
    $('update-banner').hidden = true;
    checkUpdates(true);
  };
}

// Mensagens do site do Tabernáculo da Fé: baixa todas e troca as do app
function setupSiteImport() {
  const btn = $('btn-site-import');
  const box = $('site-import-progress');
  const render = (p) => {
    box.hidden = false;
    btn.disabled = p.status === 'running';
    if (p.status === 'running') {
      $('site-import-bar').style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`;
      $('site-import-text').textContent = p.total ? `Baixando ${p.done} de ${p.total}: ${p.title || ''}` : 'Buscando a lista de mensagens...';
    } else if (p.status === 'done') {
      $('site-import-bar').style.width = '100%';
      const r = p.result;
      $('site-import-text').textContent = `Pronto: ${r.imported} mensagens no app${r.removed ? `, ${r.removed} ${r.removed === 1 ? 'antiga retirada' : 'antigas retiradas'}` : ''}${r.failed.length ? `. Não vieram: ${r.failed.slice(0, 3).join(', ')}${r.failed.length > 3 ? '...' : ''}` : ''}.`;
    } else if (p.status === 'error') {
      $('site-import-text').textContent = p.message;
    }
  };
  ws.on('site-import', render);
  btn.onclick = async () => {
    const ok = await confirmDialog({
      title: 'Trocar as mensagens pelas do site?',
      text: 'Todas as mensagens do app serão substituídas pelas do site do Tabernáculo da Fé. Neste computador de editor, a troca vale também para o banco online das igrejas.',
      okLabel: 'Baixar e trocar'
    });
    if (!ok) return;
    render({ status: 'running', done: 0, total: 0 });
    const res = await fetch('/api/sermons/import-site', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      render({ status: 'error', message: data.error || 'Não foi possível começar.' });
    }
  };
}

export function setupConfig() {
  setupSiteImport();
  setupSecurity();
  setupBetaChannel();
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.onclick = () => copyText($(btn.dataset.copy).value);
  });
  $('btn-check-update').onclick = () => checkUpdates(true);
  loadInfo();
  checkUpdates();
}

// Aba Configurações: link do OBS, acesso por outro aparelho e atualizações.
import { $, toast, copyText, confirmDialog } from './ui.js';

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
      $('update-version-text').textContent = `v${data.onlineVersion}`;
      $('update-notes').textContent = data.notes || '';
      $('update-banner').hidden = false;
      $('btn-start-update').onclick = () => startUpdate(data.onlineVersion);
      status.textContent = `Versão v${data.onlineVersion} disponível.`;
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

export function setupConfig() {
  setupSecurity();
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.onclick = () => copyText($(btn.dataset.copy).value);
  });
  $('btn-check-update').onclick = () => checkUpdates(true);
  loadInfo();
  checkUpdates();
}

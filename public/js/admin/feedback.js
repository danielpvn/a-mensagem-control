// Caixinha de sugestões e problemas: o botão do topo abre o envio (texto + fotos/vídeos) e,
// no PC do dono do app, Configurações mostra o que chegou. Tudo passa pelo servidor local,
// que fala com o banco online (só o dono lê; ver supabase/schema.sql).
import { $, toast, confirmDialog, setupModalClose } from './ui.js';

const MAX_FILES = 6;
const MAX_BYTES = 50 * 1024 * 1024;
let files = [];
let sending = false;
let inbox = [];

const kindRadios = () => [...document.querySelectorAll('input[name="feedback-kind"]')];
const kind = () => (kindRadios().find(r => r.checked) || kindRadios()[0]).value;
const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ---------- Enviar ----------

function updateKind() {
  const problem = kind() === 'problema';
  $('feedback-message-label').textContent = problem ? 'O que aconteceu? (em que aba, o que você fez e o que apareceu)' : 'Qual é a sua ideia?';
  $('feedback-message').placeholder = problem
    ? 'Ex: na aba Mídia, quando coloco um vídeo para tocar, ele trava no começo...'
    : 'Ex: seria bom poder escolher a cor das pastas...';
}

function renderFiles() {
  const list = $('feedback-file-list');
  list.innerHTML = '';
  files.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'feedback-file';
    const thumb = document.createElement(item.file.type.startsWith('video/') ? 'video' : 'img');
    thumb.className = 'feedback-thumb';
    thumb.src = item.preview;
    if (thumb.tagName === 'VIDEO') thumb.muted = true;
    const info = document.createElement('div');
    info.className = 'feedback-file-info';
    const name = document.createElement('strong');
    name.textContent = item.file.name;
    const meta = document.createElement('span');
    meta.className = 'muted small';
    meta.textContent = item.progress != null ? `Enviando... ${item.progress}%` : sizeText(item.file.size);
    info.append(name, meta);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x small';
    remove.innerHTML = '&times;';
    remove.title = 'Tirar este arquivo';
    remove.disabled = sending;
    remove.onclick = () => {
      URL.revokeObjectURL(item.preview);
      files.splice(i, 1);
      renderFiles();
    };
    row.append(thumb, info, remove);
    list.appendChild(row);
  });
}

function addFiles(list) {
  for (const file of list) {
    if (!/^(image|video)\//.test(file.type)) {
      toast(`"${file.name}" não é foto nem vídeo.`, 'error');
      continue;
    }
    if (file.size > MAX_BYTES) {
      toast(`"${file.name}" tem ${sizeText(file.size)}: o limite é 50 MB por arquivo. Grave um vídeo mais curto.`, 'error');
      continue;
    }
    if (files.length >= MAX_FILES) {
      toast(`Dá para mandar até ${MAX_FILES} arquivos.`, 'error');
      break;
    }
    files.push({ file, preview: URL.createObjectURL(file), progress: null });
  }
  renderFiles();
}

function upload(item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/feedback/upload?name=${encodeURIComponent(item.file.name)}`);
    xhr.setRequestHeader('Content-Type', item.file.type);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      item.progress = Math.round((e.loaded / e.total) * 100);
      renderFiles();
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) { /* resposta vazia */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Não foi possível enviar o arquivo.'));
    };
    xhr.onerror = () => reject(new Error('Sem conexão com o programa.'));
    xhr.send(item.file);
  });
}

function closeModal() {
  if (sending) return;
  $('feedback-modal').hidden = true;
}

function openModal() {
  $('feedback-modal').hidden = false;
  updateKind();
  renderFiles();
  setTimeout(() => $('feedback-message').focus(), 50);
}

async function send(e) {
  e.preventDefault();
  if (sending) return;
  const message = $('feedback-message').value.trim();
  if (message.length < 3) {
    toast('Escreva o que aconteceu ou a sua ideia.', 'error');
    return;
  }
  sending = true;
  $('feedback-send').disabled = true;
  $('feedback-send').textContent = 'Enviando...';
  try {
    const attachments = [];
    for (const item of files) attachments.push(await upload(item));
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind(), message, contact: $('feedback-contact').value, attachments })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Não foi possível enviar.');
    files.forEach(item => URL.revokeObjectURL(item.preview));
    files = [];
    $('feedback-form').reset();
    sending = false;
    closeModal();
    toast('Enviado! Obrigado por ajudar a melhorar o app.', 'success');
    if (!$('feedback-inbox').hidden) loadInbox();
  } catch (err) {
    files.forEach(item => { item.progress = null; });
    renderFiles();
    toast(err.message, 'error');
  } finally {
    sending = false;
    $('feedback-send').disabled = false;
    $('feedback-send').textContent = 'Enviar';
  }
}

// ---------- Caixa de entrada (só o dono do app) ----------

const KIND_LABEL = { sugestao: 'Sugestão', problema: 'Problema' };
const STATUS_LABEL = { novo: 'Novo', visto: 'Visto', resolvido: 'Resolvido' };

function updateBadge() {
  const count = inbox.filter(f => f.status === 'novo').length;
  const badge = $('feedback-new-badge');
  badge.hidden = count === 0;
  badge.textContent = count;
}

async function setStatus(item, status) {
  await fetch(`/api/feedback/${item.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  item.status = status;
  renderInbox();
}

async function removeItem(item) {
  const ok = await confirmDialog({ title: 'Apagar esta mensagem?', text: 'A mensagem e os anexos dela saem do banco online. Não dá para desfazer.', okLabel: 'Apagar', danger: true });
  if (!ok) return;
  await fetch(`/api/feedback/${item.id}`, { method: 'DELETE' });
  inbox = inbox.filter(f => f.id !== item.id);
  renderInbox();
}

function renderInbox() {
  updateBadge();
  const list = $('feedback-inbox-list');
  list.innerHTML = '';
  const filter = (document.querySelector('input[name="feedback-filter"]:checked') || {}).value || 'open';
  const shown = inbox.filter(f => filter === 'all' || f.status !== 'resolvido');
  if (shown.length === 0) {
    list.innerHTML = `<div class="empty">${inbox.length ? 'Nada em aberto.' : 'Nenhuma mensagem ainda.'}</div>`;
    return;
  }
  shown.forEach(item => {
    const card = document.createElement('article');
    card.className = `feedback-item is-${item.status}`;
    const head = document.createElement('div');
    head.className = 'feedback-item-head';
    const badge = document.createElement('span');
    badge.className = `feedback-kind kind-${item.kind}`;
    badge.textContent = KIND_LABEL[item.kind] || item.kind;
    const who = document.createElement('span');
    who.className = 'muted small';
    const date = new Date(item.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    who.textContent = [item.church || 'Igreja sem login', item.contact, `v${item.app_version || '?'}`, date].filter(Boolean).join(' · ');
    const status = document.createElement('span');
    status.className = `feedback-status status-${item.status}`;
    status.textContent = STATUS_LABEL[item.status] || item.status;
    head.append(badge, who, status);

    const text = document.createElement('p');
    text.className = 'feedback-text';
    text.textContent = item.message;
    card.append(head, text);

    if (item.attachments && item.attachments.length) {
      const media = document.createElement('div');
      media.className = 'feedback-media';
      item.attachments.forEach(a => {
        if (!a.url) return;
        const link = document.createElement('a');
        link.href = a.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = `${a.name || 'Anexo'} (abre no navegador)`;
        const el = document.createElement(String(a.type).startsWith('video/') ? 'video' : 'img');
        el.src = a.url;
        if (el.tagName === 'VIDEO') { el.muted = true; el.preload = 'metadata'; }
        link.appendChild(el);
        media.appendChild(link);
      });
      card.appendChild(media);
    }

    const actions = document.createElement('div');
    actions.className = 'feedback-actions';
    const add = (label, cls, fn) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn btn-sm ${cls}`;
      btn.textContent = label;
      btn.onclick = fn;
      actions.appendChild(btn);
    };
    if (item.status === 'novo') add('Marcar como visto', 'btn-secondary', () => setStatus(item, 'visto'));
    if (item.status !== 'resolvido') add('Resolvido', 'btn-secondary', () => setStatus(item, 'resolvido'));
    else add('Reabrir', 'btn-secondary', () => setStatus(item, 'visto'));
    add('Apagar', 'btn-ghost-danger', () => removeItem(item));
    card.appendChild(actions);
    list.appendChild(card);
  });
}

async function loadInbox() {
  try {
    const res = await fetch('/api/feedback');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Não foi possível carregar.');
    inbox = await res.json();
    renderInbox();
  } catch (err) {
    $('feedback-inbox-list').innerHTML = `<div class="empty">${err.message}</div>`;
  }
}

// Só o dono do app vê a caixa de entrada (o banco online responde quem é)
export async function checkFeedbackOwner() {
  try {
    const { owner } = await (await fetch('/api/feedback/owner')).json();
    $('feedback-inbox').hidden = !owner;
    if (owner) loadInbox();
    else $('feedback-new-badge').hidden = true;
  } catch (err) {
    $('feedback-inbox').hidden = true;
  }
}

export function setupFeedback() {
  $('btn-feedback').onclick = openModal;
  setupModalClose($('feedback-modal'), closeModal);
  kindRadios().forEach(r => r.addEventListener('change', updateKind));
  $('feedback-files').onchange = (e) => {
    addFiles([...e.target.files]);
    e.target.value = '';
  };
  const drop = $('feedback-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    addFiles([...e.dataTransfer.files]);
  });
  $('feedback-form').onsubmit = send;
  $('btn-feedback-refresh').onclick = loadInbox;
  document.querySelectorAll('input[name="feedback-filter"]').forEach(r => r.addEventListener('change', renderInbox));
  checkFeedbackOwner();
  // Dono: confere o que chegou de vez em quando (a bolinha do botão mostra os novos)
  setInterval(() => { if (!$('feedback-inbox').hidden) loadInbox(); }, 5 * 60 * 1000);
}

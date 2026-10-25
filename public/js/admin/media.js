// Aba Mídia: pastas por culto, envio de fotos e vídeos, controles de vídeo e aparência da mídia.
import { $, toast, confirmDialog } from './ui.js';
import * as ws from './ws.js';

let state = null;
let folders = [];
let today = '';
let renderedKey = '';
let progress = { token: -1, currentTime: 0, duration: 0 };
let uploading = 0;

const el = {
  folder: $('media-folder'),
  grid: $('media-grid'),
  uploads: $('media-uploads'),
  title: $('media-current-title'),
  meta: $('media-current-meta'),
  video: $('media-video-controls'),
  playLabel: $('media-play-label'),
  muteLabel: $('media-mute-label'),
  loop: $('media-loop'),
  volume: $('media-volume'),
  btnPrev: $('btn-media-prev'),
  btnNext: $('btn-media-next'),
  btnToggle: $('btn-media-toggle'),
  btnToggleLabel: $('btn-media-toggle-label'),
  nextLabel: $('media-next-label'),
  nextText: $('media-next-text')
};

const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// "2026-10-25" -> "Hoje · sábado, 25/10"
function folderLabel(name) {
  const match = name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return name;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '');
  const label = `${weekday}, ${match[3]}/${match[2]}`;
  return name === today ? `Hoje · ${label}` : label;
}

const currentFolder = () => (state && state.media.folder) || today;

// ---------- Pastas ----------

async function loadFolders() {
  try {
    const data = await (await fetch('/api/media/folders')).json();
    today = data.today;
    folders = data.folders;
  } catch (err) {
    return;
  }
  const names = new Set(folders.map(f => f.name));
  el.folder.innerHTML = '';
  // A pasta de hoje aparece mesmo antes de existir (é criada no primeiro envio)
  if (!names.has(today)) folders.unshift({ name: today, count: 0 });
  folders.forEach(f => {
    const option = document.createElement('option');
    option.value = f.name;
    option.textContent = `${folderLabel(f.name)} (${f.count})`;
    el.folder.appendChild(option);
  });
  el.folder.value = currentFolder();
  if (state && !state.media.folder) ws.send('media-folder', { folder: today });
}

function setupFolders() {
  el.folder.onchange = () => ws.send('media-folder', { folder: el.folder.value });

  const form = $('media-new-folder-form');
  $('btn-media-new-folder').onclick = () => {
    form.hidden = !form.hidden;
    if (!form.hidden) $('media-new-folder-name').focus();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = $('media-new-folder-name').value.trim();
    if (!name) return;
    const res = await fetch('/api/media/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Não foi possível criar a pasta.', 'error');
      return;
    }
    form.hidden = true;
    form.reset();
    ws.send('media-folder', { folder: data.folder });
    await loadFolders();
    el.folder.value = data.folder;
  };

  $('btn-media-delete-folder').onclick = async () => {
    const folder = currentFolder();
    const info = folders.find(f => f.name === folder);
    const ok = await confirmDialog({
      title: 'Apagar esta pasta?',
      text: `"${folderLabel(folder)}" e ${info ? info.count : 0} arquivo(s) dentro dela serão apagados deste computador.`,
      okLabel: 'Apagar pasta',
      danger: true
    });
    if (!ok) return;
    await fetch(`/api/media/folders/${encodeURIComponent(folder)}`, { method: 'DELETE' });
    toast('Pasta apagada.', 'success');
    ws.send('media-folder', { folder: today });
    loadFolders();
  };
}

// ---------- Envio ----------

function uploadFile(file, folder) {
  return new Promise((resolve) => {
    const row = document.createElement('div');
    row.className = 'upload-row';
    const name = document.createElement('span');
    name.textContent = file.name;
    const bar = document.createElement('div');
    bar.className = 'progress-track';
    const fill = document.createElement('div');
    fill.className = 'progress-bar';
    bar.appendChild(fill);
    row.append(name, bar);
    el.uploads.appendChild(row);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/media/upload?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) fill.style.width = `${(e.loaded / e.total) * 100}%`;
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) { /* resposta inválida */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        row.remove();
      } else {
        row.classList.add('failed');
        name.textContent = `${file.name}: ${data.error || 'falhou'}`;
        setTimeout(() => row.remove(), 6000);
      }
      resolve();
    };
    xhr.onerror = () => {
      row.classList.add('failed');
      name.textContent = `${file.name}: sem conexão`;
      setTimeout(() => row.remove(), 6000);
      resolve();
    };
    xhr.send(file);
  });
}

async function uploadFiles(files) {
  const list = [...files].filter(f => /^(image|video)\//.test(f.type) || /\.(mov|m4v)$/i.test(f.name));
  if (list.length === 0) {
    toast('Escolha fotos ou vídeos.', 'error');
    return;
  }
  const folder = currentFolder();
  uploading++;
  // Um por vez: no celular com Wi-Fi fraco, vários juntos travam
  for (const file of list) await uploadFile(file, folder);
  uploading--;
  if (!uploading) toast(`${list.length} arquivo(s) enviado(s).`, 'success');
  loadFolders();
}

function setupUpload() {
  const input = $('media-files');
  input.onchange = () => {
    uploadFiles(input.files);
    input.value = '';
  };
  const area = $('media-library');
  const drop = $('media-drop');
  area.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragging'); });
  area.addEventListener('dragleave', (e) => { if (!area.contains(e.relatedTarget)) drop.classList.remove('dragging'); });
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    uploadFiles(e.dataTransfer.files);
  });
}

// ---------- Grade de mídias ----------

function renderGrid() {
  const m = state.media;
  const key = `${m.folder}|${m.items.map(i => i.name).join('|')}`;
  if (key !== renderedKey) {
    renderedKey = key;
    el.grid.innerHTML = '';
    if (m.items.length === 0) {
      el.grid.innerHTML = '<div class="empty">Nenhuma mídia nesta pasta ainda.<br>Envie as fotos e vídeos que o pastor mandou.</div>';
    }
    m.items.forEach((item, index) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'media-tile';
      tile.dataset.index = index;
      tile.title = item.name;
      tile.onclick = () => ws.send('media-show', { index });

      const thumb = document.createElement('span');
      thumb.className = 'media-thumb';
      if (item.type === 'video') {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'metadata';
        video.src = `${item.url}#t=0.5`;
        video.addEventListener('loadedmetadata', () => {
          badge.textContent = `Vídeo · ${formatTime(video.duration)}`;
        });
        thumb.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = item.url;
        img.alt = '';
        thumb.appendChild(img);
      }
      const badge = document.createElement('span');
      badge.className = 'media-badge';
      badge.textContent = item.type === 'video' ? 'Vídeo' : 'Imagem';
      thumb.appendChild(badge);

      const name = document.createElement('span');
      name.className = 'media-name';
      name.textContent = item.name;

      const remove = document.createElement('span');
      remove.className = 'bg-remove';
      remove.textContent = '×';
      remove.title = 'Apagar este arquivo';
      remove.onclick = async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({ title: 'Apagar arquivo?', text: `"${item.name}" será apagado deste computador.`, okLabel: 'Apagar', danger: true });
        if (!ok) return;
        await fetch(`/api/media/items/${encodeURIComponent(m.folder)}/${encodeURIComponent(item.name)}`, { method: 'DELETE' });
        loadFolders();
      };

      tile.append(thumb, name, remove);
      el.grid.appendChild(tile);
    });
  }

  el.grid.querySelectorAll('.media-tile').forEach(tile => {
    const isCurrent = Number(tile.dataset.index) === m.index;
    tile.classList.toggle('live', isCurrent && !m.isCleared);
    tile.classList.toggle('armed', isCurrent && m.isCleared && m.armed);
    tile.classList.toggle('held', isCurrent && m.isCleared && !m.armed);
  });
}

// ---------- Controles ----------

function renderControls() {
  const m = state.media;
  const item = m.items[m.index];
  const has = m.items.length > 0;
  const isLive = !!item && !m.isCleared;

  el.title.textContent = item ? item.name : 'Nada selecionado';
  el.meta.textContent = item
    ? `${item.type === 'video' ? 'Vídeo' : 'Imagem'} · ${m.index + 1} de ${m.items.length}${isLive ? ' · no ar' : ''}`
    : 'Clique numa mídia para colocar no ar.';

  const p = m.playback;
  el.video.hidden = !(item && item.type === 'video');
  el.playLabel.textContent = p.playing ? 'Pausar' : 'Tocar';
  $('media-play-icon').innerHTML = p.playing
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="6 3 20 12 6 21 6 3"/>';
  el.muteLabel.textContent = p.muted ? 'Sem som' : 'Som ligado';
  $('btn-media-mute').classList.toggle('is-muted', !!p.muted);
  el.loop.checked = !!p.loop;
  if (document.activeElement !== el.volume) {
    el.volume.value = Math.round((p.volume ?? 1) * 100);
    $('media-volume-val').textContent = `${el.volume.value}%`;
  }
  if (progress.token !== p.token) {
    progress = { token: p.token, currentTime: 0, duration: 0 };
    renderProgress();
  }

  el.btnPrev.disabled = !has || m.index <= 0;
  el.btnNext.disabled = !has || (!m.armed && m.index !== -1 && m.index >= m.items.length - 1);
  el.btnToggle.disabled = !has || m.index === -1;
  el.btnToggleLabel.textContent = isLive ? 'Ocultar' : 'Exibir';
  el.btnToggle.classList.toggle('is-live', isLive);

  const next = m.armed || m.index === -1 ? m.items[Math.max(0, m.index)] : m.items[m.index + 1];
  el.nextLabel.textContent = next ? `Próximo · ${next.type === 'video' ? 'vídeo' : 'imagem'}` : 'Próximo';
  el.nextText.textContent = next ? next.name : (has ? 'Fim da pasta.' : '—');
}

function renderProgress() {
  $('media-time').textContent = formatTime(progress.currentTime);
  $('media-duration').textContent = formatTime(progress.duration);
  $('media-progress-bar').style.width = progress.duration ? `${(progress.currentTime / progress.duration) * 100}%` : '0%';
}

function setupVideoControls() {
  const control = (action, value) => ws.send('media-control', { action, value });
  $('btn-media-play').onclick = () => control(state.media.playback.playing ? 'pause' : 'play');
  $('btn-media-restart').onclick = () => control('restart');
  $('btn-media-mute').onclick = () => control('mute', !state.media.playback.muted);
  el.loop.onchange = () => control('loop', el.loop.checked);
  el.volume.oninput = () => {
    $('media-volume-val').textContent = `${el.volume.value}%`;
    control('volume', Number(el.volume.value) / 100);
  };
  ws.on('media-progress', (p) => {
    if (!state || p.token !== state.media.playback.token) return;
    progress = p;
    renderProgress();
  });
}

// ---------- Aparência da mídia ----------

const fitRadios = [...document.querySelectorAll('input[name="media-fit"]')];
const focusRadios = [...document.querySelectorAll('input[name="media-focus"]')];
const checkedValue = (list) => (list.find(r => r.checked) || list[0]).value;

// Mostra só o que vale para o ajuste escolhido
function updateFitOptions() {
  const fit = checkedValue(fitRadios);
  $('media-focus-field').hidden = fit !== 'cover';
  $('media-bg-field').classList.toggle('disabled', fit !== 'contain');
}

function fillMediaStyles(s) {
  if (!s) return;
  $('media-transition').value = s.transition || 'crossfade';
  $('media-duration-range').value = s.duration ?? 0.6;
  $('media-duration-val').textContent = `${Number(s.duration ?? 0.6).toFixed(1)} s`;
  fitRadios.forEach(r => { r.checked = r.value === (s.fit || 'blur'); });
  focusRadios.forEach(r => { r.checked = r.value === (s.focus || 'center'); });
  updateFitOptions();
  $('media-bg').value = s.bgColor || '#000000';
  $('media-end').value = s.endAction || 'clear';
}

function setupMediaStyles() {
  const send = () => {
    $('media-duration-val').textContent = `${Number($('media-duration-range').value).toFixed(1)} s`;
    ws.send('update-media-styles', {
      transition: $('media-transition').value,
      duration: Number($('media-duration-range').value),
      fit: checkedValue(fitRadios),
      focus: checkedValue(focusRadios),
      bgColor: $('media-bg').value,
      endAction: $('media-end').value
    });
  };
  ['media-transition', 'media-duration-range', 'media-bg', 'media-end'].forEach(id => $(id).addEventListener('input', send));
  [...fitRadios, ...focusRadios].forEach(r => r.addEventListener('input', () => {
    updateFitOptions();
    send();
  }));
  $('btn-media-reset').onclick = () => ws.send('reset-media-styles');
  ws.on('init', (s) => fillMediaStyles(s.mediaStyles));
  ws.on('update-media-style', fillMediaStyles);
}

// ---------- Estado ----------

function onServerState(newState) {
  const hadFolder = state && state.media.folder;
  state = newState;
  if (!state.media.folder && today) ws.send('media-folder', { folder: today });
  if (state.media.folder && state.media.folder !== hadFolder) el.folder.value = state.media.folder;
  renderGrid();
  renderControls();
}

export const mediaControls = {
  next: () => ws.send('next', { mode: 'media' }),
  prev: () => ws.send('prev', { mode: 'media' }),
  toggle: () => ws.send('toggle-clear', { mode: 'media' }),
  focusSearch: () => {}
};

export function setupMedia() {
  ws.on('init', onServerState);
  ws.on('update-content', onServerState);
  el.btnPrev.onclick = mediaControls.prev;
  el.btnNext.onclick = mediaControls.next;
  el.btnToggle.onclick = mediaControls.toggle;
  setupFolders();
  setupUpload();
  setupVideoControls();
  setupMediaStyles();
  loadFolders();
}

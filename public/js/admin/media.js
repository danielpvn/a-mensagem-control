// Aba Mídia: pastas por culto, envio de fotos e vídeos, links do YouTube, ordem das mídias,
// prévia com zoom e ponto de início, controles do vídeo no ar e onde o som sai.
import { $, toast, confirmDialog } from './ui.js';
import * as ws from './ws.js';
import { makeSortable, moveItem } from './sortable.js';
import { playerFor, youtubeErrorText } from '../shared/players.js';

let state = null;
let folders = [];
let today = '';
let renderedKey = '';
let progress = { token: -1, currentTime: 0, duration: 0 };
let uploading = 0;
let selectedName = null;   // mídia escolhida para ver na prévia (ainda não está no ar)
let lastLive = null;       // para a seleção acompanhar quando o passador troca a mídia no ar
let previewStyle = {};     // ajuste (fit/focus) igual ao do OBS
let zoom = { scale: 1, x: 50, y: 50 };
let interacting = false;   // enquanto arrasta/gira a rodinha, o servidor não sobrescreve a prévia
let previewPlayer = null;  // tocador da prévia (vídeo ou YouTube)

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
  seek: $('media-seek'),
  btnPrev: $('btn-media-prev'),
  btnNext: $('btn-media-next'),
  btnToggle: $('btn-media-toggle'),
  btnToggleLabel: $('btn-media-toggle-label'),
  nextLabel: $('media-next-label'),
  nextText: $('media-next-text'),
  preview: $('media-preview'),
  btnShow: $('btn-media-show'),
  cue: $('media-cue'),
  cueSeek: $('cue-seek')
};

const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};

const isPlayable = (item) => !!item && (item.type === 'video' || item.type === 'youtube');
const displayName = (item) => item.title || item.name;
const kindName = (item) => (item.type === 'youtube' ? 'YouTube' : item.type === 'video' ? 'Vídeo' : 'Imagem');
const startOf = (name) => (state && state.media.starts && state.media.starts[name]) || 0;
const audioOutput = () => previewStyle.audioOutput || 'obs';

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

// ---------- Envio e YouTube ----------

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
  // Só reage a arquivos vindos do computador (arrastar as mídias da lista é para mudar a ordem)
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  area.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    drop.classList.add('dragging');
  });
  area.addEventListener('dragleave', (e) => { if (!area.contains(e.relatedTarget)) drop.classList.remove('dragging'); });
  area.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    drop.classList.remove('dragging');
    uploadFiles(e.dataTransfer.files);
  });

  const ytForm = $('media-yt-form');
  ytForm.onsubmit = async (e) => {
    e.preventDefault();
    const url = $('media-yt-url').value.trim();
    if (!url) return;
    const button = ytForm.querySelector('button');
    button.disabled = true;
    try {
      const res = await fetch('/api/media/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: currentFolder(), url })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      $('media-yt-url').value = '';
      toast(`"${data.title}" adicionado.`, 'success');
      loadFolders();
    } catch (err) {
      toast(err.message || 'Não foi possível adicionar o vídeo.', 'error');
    } finally {
      button.disabled = false;
    }
  };
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
      tile.title = `${displayName(item)}\nArraste para mudar a ordem.`;
      tile.draggable = true;
      // Um clique: vê na prévia. Dois cliques (ou Enter): vai para o telão.
      tile.onclick = () => selectItem(item.name);
      tile.ondblclick = () => showItem(item.name);
      tile.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        showItem(item.name);
      };

      const thumb = document.createElement('span');
      thumb.className = 'media-thumb';
      const badge = document.createElement('span');
      badge.className = 'media-badge';
      badge.textContent = kindName(item);
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
        img.src = item.type === 'youtube' ? item.thumb : item.url;
        img.alt = '';
        img.draggable = false;
        thumb.appendChild(img);
      }
      if (item.type === 'youtube') badge.classList.add('is-youtube');
      thumb.appendChild(badge);

      const name = document.createElement('span');
      name.className = 'media-name';
      name.textContent = displayName(item);

      const remove = document.createElement('span');
      remove.className = 'bg-remove';
      remove.textContent = '×';
      remove.title = 'Apagar da pasta';
      remove.onclick = async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({ title: 'Apagar?', text: `"${displayName(item)}" será apagado desta pasta.`, okLabel: 'Apagar', danger: true });
        if (!ok) return;
        await fetch(`/api/media/items/${encodeURIComponent(m.folder)}/${encodeURIComponent(item.name)}`, { method: 'DELETE' });
        loadFolders();
      };

      tile.append(thumb, name, remove);
      el.grid.appendChild(tile);
    });
  }

  el.grid.querySelectorAll('.media-tile').forEach(tile => {
    const index = Number(tile.dataset.index);
    const isCurrent = index === m.index;
    tile.classList.toggle('live', isCurrent && !m.isCleared);
    tile.classList.toggle('armed', isCurrent && m.isCleared && m.armed);
    tile.classList.toggle('held', isCurrent && m.isCleared && !m.armed);
    tile.classList.toggle('selected', m.items[index]?.name === selectedName);
    tile.classList.toggle('has-start', startOf(m.items[index]?.name) > 0);
  });
}

// ---------- Controles do vídeo no ar ----------

function renderControls() {
  const m = state.media;
  const item = m.items[m.index];
  const has = m.items.length > 0;
  const isLive = !!item && !m.isCleared;

  const selIndex = selectedIndex();
  const sel = m.items[selIndex];
  const selLive = isLive && selIndex === m.index;
  el.title.textContent = sel ? displayName(sel) : 'Nada selecionado';
  const start = sel ? startOf(sel.name) : 0;
  el.meta.textContent = sel
    ? `${kindName(sel)} · ${selIndex + 1} de ${m.items.length} · ${selLive ? 'no ar' : 'não está no ar'}${start ? ` · começa em ${formatTime(start)}` : ''}`
    : 'Clique numa mídia para ver aqui antes de exibir.';
  el.btnShow.disabled = !sel || selLive;

  // Achar o ponto de início: só para o vídeo escolhido que ainda não está no ar
  el.cue.hidden = !isPlayable(sel) || selLive;
  $('cue-start').textContent = formatTime(start);
  $('btn-cue-reset').disabled = !start;

  const p = m.playback;
  el.video.hidden = !(isLive && isPlayable(item));
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
    progress = { token: p.token, currentTime: p.start || 0, duration: 0 };
    renderProgress();
  }
  $('media-sound-note').innerHTML = audioOutput() === 'app'
    ? 'O som está saindo <strong>neste computador</strong> (troque em Aparência → Som dos vídeos).'
    : 'O som sai pelo OBS: marque <strong>"Controlar áudio via OBS"</strong> na fonte Navegador.';

  el.btnPrev.disabled = !has || m.index <= 0;
  el.btnNext.disabled = !has || (!m.armed && m.index !== -1 && m.index >= m.items.length - 1);
  el.btnToggle.disabled = !has || m.index === -1;
  el.btnToggleLabel.textContent = isLive ? 'Ocultar' : 'Exibir';
  el.btnToggle.classList.toggle('is-live', isLive);

  const next = m.armed || m.index === -1 ? m.items[Math.max(0, m.index)] : m.items[m.index + 1];
  el.nextLabel.textContent = next ? `Próximo · ${kindName(next).toLowerCase()}` : 'Próximo';
  el.nextText.textContent = next ? displayName(next) : (has ? 'Fim da pasta.' : '—');
}

let seeking = false; // operador arrastando a barra do vídeo no ar
function renderProgress() {
  $('media-duration').textContent = formatTime(progress.duration);
  el.seek.max = Math.max(0, progress.duration || 0);
  if (!seeking) {
    $('media-time').textContent = formatTime(progress.currentTime);
    el.seek.value = progress.currentTime || 0;
  }
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
  // Pular para outra parte do vídeo no ar: mostra o tempo enquanto arrasta, pula ao soltar
  el.seek.addEventListener('input', () => {
    seeking = true;
    $('media-time').textContent = formatTime(Number(el.seek.value));
  });
  el.seek.addEventListener('change', () => {
    control('seek', Number(el.seek.value));
    progress.currentTime = Number(el.seek.value);
    setTimeout(() => { seeking = false; }, 700);
  });
  ws.on('media-progress', (p) => {
    if (!state || p.token !== state.media.playback.token) return;
    if (p.error) {
      toast(p.error, 'error');
      return;
    }
    progress = p;
    renderProgress();
    followLive(p);
    localAudio.follow(p);
  });
}

// ---------- Seleção, prévia, ponto de início e zoom ----------

const selectedIndex = () => (state ? state.media.items.findIndex(i => i.name === selectedName) : -1);

function selectItem(name) {
  if (name === selectedName) return;
  selectedName = name;
  zoom = savedZoom(name);
  renderGrid();
  renderControls();
  renderPreview();
}

function showItem(name) {
  const index = state.media.items.findIndex(i => i.name === name);
  if (index === -1) return;
  if (selectedName !== name) selectItem(name);
  if (previewPlayer) previewPlayer.pause();
  ws.send('media-show', { index });
}

const showSelected = () => { if (selectedName) showItem(selectedName); };

// Zoom guardado no servidor: o do item no ar (pode ter mudado no celular) ou o preparado
function savedZoom(name) {
  const m = state.media;
  const live = m.items[m.index];
  if (live && live.name === name && !m.isCleared && m.zoom) return { ...m.zoom };
  return { ...(m.zooms[name] || { scale: 1, x: 50, y: 50 }) };
}

// Mesmas contas do servidor/overlay: o ponto (x, y) fica no centro da tela
function clampZoom(z) {
  const scale = Math.min(6, Math.max(1, z.scale));
  const limit = 50 - 50 / scale;
  const clamp = (v) => Math.min(50 + limit, Math.max(50 - limit, v));
  return { scale, x: clamp(z.x), y: clamp(z.y) };
}

const zoomTransform = (z) => (z.scale <= 1 ? 'none' : `scale(${z.scale}) translate(${50 - z.x}%, ${50 - z.y}%)`);

const selectedIsLive = () => {
  const m = state.media;
  const live = m.items[m.index];
  return !!live && !m.isCleared && live.name === selectedName;
};

let previewKey = '';
function renderPreview() {
  const m = state.media;
  const item = m.items[selectedIndex()];
  const fit = previewStyle.fit || 'blur';
  el.preview.classList.toggle('fit-cover', fit === 'cover');
  el.preview.classList.toggle('fit-blur', fit === 'blur');
  el.preview.style.background = fit === 'contain' ? (previewStyle.bgColor || '#000') : '#000';
  el.preview.style.setProperty('--media-focus', { top: 'center top', center: 'center center', bottom: 'center bottom' }[previewStyle.focus] || 'center center');

  const key = item ? `${m.folder}/${item.name}` : '';
  if (key !== previewKey) {
    previewKey = key;
    if (previewPlayer) previewPlayer.destroy();
    previewPlayer = null;
    el.preview.innerHTML = '';
    $('cue-sound').checked = false;
    if (!item) {
      el.preview.innerHTML = '<div class="empty">Selecione uma mídia na lista.</div>';
    } else {
      const backdrop = document.createElement('div');
      backdrop.className = 'media-backdrop';
      let media;
      if (item.type === 'image') {
        media = document.createElement('img');
        media.src = item.url;
        media.alt = '';
        media.draggable = false;
        backdrop.style.backgroundImage = `url("${item.url}")`;
      } else {
        // Vídeo parado no ponto de início, para o operador ver por onde ele vai entrar
        previewPlayer = playerFor(item, { start: startOf(item.name), muted: true, autoplay: false });
        media = previewPlayer.el;
        if (item.type === 'youtube') {
          backdrop.style.backgroundImage = `url("${item.thumb}")`;
          previewPlayer.onError((code) => toast(youtubeErrorText(code), 'error'));
        } else {
          media.addEventListener('loadeddata', () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = 96;
              canvas.height = 54;
              canvas.getContext('2d').drawImage(media, 0, 0, canvas.width, canvas.height);
              backdrop.style.backgroundImage = `url("${canvas.toDataURL('image/jpeg', 0.7)}")`;
            } catch (err) {
              // sem fundo desfocado
            }
          }, { once: true });
        }
        previewPlayer.ready.then(() => {
          if (selectedIsLive() && previewPlayer) previewPlayer.play();
        });
      }
      const tag = document.createElement('span');
      tag.className = 'preview-tag';
      el.preview.append(backdrop, media, tag);
    }
  }

  const media = el.preview.querySelector('img, video, .yt-wrap');
  if (media) media.style.transform = zoomTransform(zoom);
  const tag = el.preview.querySelector('.preview-tag');
  if (tag) {
    const live = !!item && !m.isCleared && m.items[m.index] === item;
    tag.textContent = live ? 'NO AR' : 'PRÉVIA';
    tag.classList.toggle('is-live', live);
  }
  // Só aparece quando tem zoom (para voltar à mídia inteira)
  $('btn-zoom-reset').hidden = !item || zoom.scale <= 1;
}

// Com o vídeo escolhido no ar, a prévia acompanha o telão (sem som)
function followLive(p) {
  if (!previewPlayer || !selectedIsLive()) return;
  previewPlayer.setMuted(true);
  if (Math.abs(previewPlayer.time() - p.currentTime) > 1.2) previewPlayer.seek(p.currentTime);
  if (p.paused && !previewPlayer.paused()) previewPlayer.pause();
  if (!p.paused && previewPlayer.paused()) previewPlayer.play();
}

// Barra da prévia (achar o ponto de início): atualiza o tempo enquanto o vídeo da prévia anda
let cueDragging = false;
function tickCue() {
  if (el.cue.hidden || !previewPlayer) return;
  const duration = previewPlayer.duration();
  el.cueSeek.max = Math.max(0, duration);
  $('cue-duration').textContent = formatTime(duration);
  if (!cueDragging) {
    el.cueSeek.value = previewPlayer.time();
    $('cue-time').textContent = formatTime(previewPlayer.time());
  }
  $('cue-play-icon').innerHTML = previewPlayer.paused()
    ? '<polygon points="6 3 20 12 6 21 6 3"/>'
    : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
}

function setupCue() {
  setInterval(tickCue, 250);
  $('btn-cue-play').onclick = () => {
    if (!previewPlayer) return;
    if (previewPlayer.paused()) previewPlayer.play();
    else previewPlayer.pause();
    setTimeout(tickCue, 80);
  };
  el.cueSeek.addEventListener('input', () => {
    cueDragging = true;
    $('cue-time').textContent = formatTime(Number(el.cueSeek.value));
    if (previewPlayer) previewPlayer.seek(Number(el.cueSeek.value));
  });
  el.cueSeek.addEventListener('change', () => { cueDragging = false; });
  // Ouvir a prévia: só neste computador e só quando o operador pede
  $('cue-sound').onchange = () => { if (previewPlayer) previewPlayer.setMuted(!$('cue-sound').checked); };
  $('btn-cue-mark').onclick = () => {
    if (!previewPlayer || !selectedName) return;
    const time = previewPlayer.time();
    ws.send('media-start', { name: selectedName, start: time });
    toast(`Vai começar em ${formatTime(time)}.`, 'success');
  };
  $('btn-cue-reset').onclick = () => {
    if (!selectedName) return;
    ws.send('media-start', { name: selectedName, start: 0 });
    if (previewPlayer) previewPlayer.seek(0);
  };
}

// Envia o zoom ao servidor sem inundar a rede enquanto arrasta
let sendTimer = null;
let lastSent = 0;
function sendZoom() {
  if (!selectedName) return;
  const name = selectedName;
  const send = () => {
    sendTimer = null;
    lastSent = Date.now();
    ws.send('media-zoom', { name, zoom });
  };
  clearTimeout(sendTimer);
  const wait = 120 - (Date.now() - lastSent);
  if (wait <= 0) send();
  else sendTimer = setTimeout(send, wait);
}

function setZoom(next) {
  zoom = clampZoom(next);
  renderPreview();
  sendZoom();
}

// Aproxima mantendo parado o ponto (vx, vy) da tela, em %
function zoomAt(scale, vx = 50, vy = 50) {
  const s2 = Math.min(6, Math.max(1, scale));
  const k = 1 / zoom.scale - 1 / s2;
  setZoom({ scale: s2, x: zoom.x + (vx - 50) * k, y: zoom.y + (vy - 50) * k });
}

let endTimer = null;
function markInteracting() {
  interacting = true;
  clearTimeout(endTimer);
  endTimer = setTimeout(() => { interacting = false; }, 600);
}

function setupPreview() {
  const box = el.preview;
  const pointIn = (e) => {
    const r = box.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };

  box.addEventListener('wheel', (e) => {
    if (!selectedName) return;
    e.preventDefault();
    markInteracting();
    const p = pointIn(e);
    zoomAt(zoom.scale * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });

  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    if (!selectedName || e.button !== 0) return;
    drag = { start: pointIn(e), zoom: { ...zoom } };
    box.setPointerCapture(e.pointerId);
    box.classList.add('dragging');
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || drag.zoom.scale <= 1) return;
    markInteracting();
    const p = pointIn(e);
    setZoom({ scale: drag.zoom.scale, x: drag.zoom.x - (p.x - drag.start.x) / drag.zoom.scale, y: drag.zoom.y - (p.y - drag.start.y) / drag.zoom.scale });
  });
  const endDrag = () => { drag = null; box.classList.remove('dragging'); };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);
  box.addEventListener('dblclick', showSelected);

  $('btn-zoom-reset').onclick = () => setZoom({ scale: 1, x: 50, y: 50 });
  el.btnShow.onclick = showSelected;
}

// ---------- Som saindo neste computador ----------
// Quando o operador escolhe "Neste computador", o OBS toca o vídeo mudo e o painel do app
// (só a janela do programa, não o celular) toca o mesmo vídeo escondido, com som, acompanhando o telão.

const isAudioHost = /Electron/i.test(navigator.userAgent);

const localAudio = (() => {
  let current = null; // { key, token, seekId, start, loop, player }
  const host = document.createElement('div');
  host.className = 'local-audio-host';
  document.body.appendChild(host);

  function stop() {
    if (current) current.player.destroy();
    current = null;
    host.innerHTML = '';
  }

  function apply(playback, restart) {
    const player = current.player;
    current.start = playback.start || 0;
    current.loop = !!playback.loop;
    player.setMuted(!!playback.muted);
    player.setVolume(playback.volume ?? 1);
    if (restart) player.seek(current.start);
    const seekId = playback.seek ? playback.seek.id : 0;
    if (seekId !== current.seekId) {
      current.seekId = seekId;
      if (!restart) player.seek(playback.seek.time);
    }
    if (playback.playing) player.play();
    else player.pause();
  }

  return {
    sync() {
      const m = state.media;
      const item = m.items[m.index];
      const wanted = isAudioHost && audioOutput() === 'app' && !!item && !m.isCleared && isPlayable(item);
      if (!wanted) {
        stop();
        return;
      }
      const p = m.playback;
      const key = `${item.type}:${item.url}`;
      if (current && current.key === key) {
        const restart = current.token !== p.token;
        current.token = p.token;
        apply(p, restart);
        return;
      }
      stop();
      const player = playerFor(item, { start: p.start || 0, muted: false });
      current = { key, token: p.token, seekId: p.seek ? p.seek.id : 0, start: p.start || 0, loop: !!p.loop, player };
      host.appendChild(player.el);
      player.onEnded(() => {
        if (current && current.player === player && current.loop) {
          player.seek(current.start);
          player.play();
        }
      });
      player.ready.then(() => { if (current && current.player === player) apply(state.media.playback, false); });
    },
    // O telão manda o tempo do vídeo: se o som se afastar da imagem, acerta
    follow(p) {
      if (!current || p.ended) return;
      if (Math.abs(current.player.time() - p.currentTime) > 0.4) current.player.seek(p.currentTime + 0.1);
    }
  };
})();

// ---------- Aparência da mídia ----------

const fitRadios = [...document.querySelectorAll('input[name="media-fit"]')];
const focusRadios = [...document.querySelectorAll('input[name="media-focus"]')];
const audioRadios = [...document.querySelectorAll('input[name="media-audio"]')];
const checkedValue = (list) => (list.find(r => r.checked) || list[0]).value;

// Mostra só o que vale para o ajuste escolhido
function updateFitOptions() {
  const fit = checkedValue(fitRadios);
  $('media-focus-field').hidden = fit !== 'cover';
  $('media-bg-field').classList.toggle('disabled', fit !== 'contain');
  $('media-audio-help').innerHTML = checkedValue(audioRadios) === 'app'
    ? 'O som dos vídeos sai <strong>neste computador</strong> (ligue a saída dele na mesa de som). O OBS mostra o vídeo sem som.'
    : 'O som sai no computador onde o <strong>link do OBS</strong> está aberto. Marque "Controlar áudio via OBS" na fonte Navegador.';
}

function fillMediaStyles(s) {
  if (!s) return;
  previewStyle = { ...previewStyle, ...s };
  if (state) {
    renderPreview();
    renderControls();
    localAudio.sync();
  }
  $('media-transition').value = previewStyle.transition || 'crossfade';
  $('media-duration-range').value = previewStyle.duration ?? 0.6;
  $('media-duration-val').textContent = `${Number(previewStyle.duration ?? 0.6).toFixed(1)} s`;
  fitRadios.forEach(r => { r.checked = r.value === (previewStyle.fit || 'blur'); });
  focusRadios.forEach(r => { r.checked = r.value === (previewStyle.focus || 'center'); });
  audioRadios.forEach(r => { r.checked = r.value === audioOutput(); });
  updateFitOptions();
  $('media-bg').value = previewStyle.bgColor || '#000000';
  $('media-end').value = previewStyle.endAction || 'clear';
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
      endAction: $('media-end').value,
      audioOutput: checkedValue(audioRadios)
    });
  };
  ['media-transition', 'media-duration-range', 'media-bg', 'media-end'].forEach(id => $(id).addEventListener('input', send));
  [...fitRadios, ...focusRadios, ...audioRadios].forEach(r => r.addEventListener('input', () => {
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
  const m = state.media;
  if (!m.folder && today) ws.send('media-folder', { folder: today });
  if (m.folder && m.folder !== hadFolder) el.folder.value = m.folder;

  // A seleção acompanha a mídia que foi ao ar (passador, celular, Próximo)
  const live = m.items[m.index];
  const liveKey = live && !m.isCleared ? `${m.folder}/${live.name}` : null;
  if (liveKey !== lastLive) {
    lastLive = liveKey;
    if (liveKey) selectedName = live.name;
  }
  if (!m.items.some(i => i.name === selectedName)) selectedName = live ? live.name : (m.items[0] && m.items[0].name) || null;
  if (!interacting && selectedName) zoom = savedZoom(selectedName);

  renderGrid();
  renderControls();
  renderPreview();
  localAudio.sync();

  // A prévia do vídeo escolhido: no ar, toca junto com o telão (sem som);
  // fora do ar, fica parada no ponto de início
  const nowLive = selectedIsLive();
  if (previewPlayer) {
    if (nowLive !== previewWasLive) {
      $('cue-sound').checked = false;
      previewPlayer.setMuted(true);
      previewPlayer.seek(startOf(selectedName));
    }
    if (nowLive && m.playback.playing) previewPlayer.play();
    else if (nowLive || nowLive !== previewWasLive) previewPlayer.pause();
  }
  previewWasLive = nowLive;
}
let previewWasLive = false;

export const mediaControls = {
  next: () => ws.send('next', { mode: 'media' }),
  prev: () => ws.send('prev', { mode: 'media' }),
  toggle: () => ws.send('toggle-clear', { mode: 'media' }),
  // Enter: coloca no ar a mídia que está na prévia
  focusSearch: showSelected
};

export function setupMedia() {
  ws.on('init', onServerState);
  ws.on('update-content', onServerState);
  el.btnPrev.onclick = mediaControls.prev;
  el.btnNext.onclick = mediaControls.next;
  el.btnToggle.onclick = mediaControls.toggle;
  makeSortable(el.grid, '.media-tile', (from, to) => {
    ws.send('media-order', { names: moveItem(state.media.items.map(i => i.name), from, to) });
  }, { axis: 'x' });
  setupFolders();
  setupUpload();
  setupVideoControls();
  setupMediaStyles();
  setupPreview();
  setupCue();
  loadFolders();
}

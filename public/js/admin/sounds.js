// Aba Agendamentos: sons e vídeos que entram sozinhos (o sino antes do culto, um vídeo de aviso...) e playlists.
// O servidor marca a hora e manda "sound-play"; o som sai na janela do programa (Electron) neste
// computador ("app") ou no overlay do OBS ("obs"). Imagem do som e vídeo sempre aparecem no OBS.
// No celular ou no navegador só aparece o aviso.
import { $, toast, confirmDialog } from './ui.js';
import * as ws from './ws.js';
import { makeSortable, moveItem } from './sortable.js';

const CAN_PLAY = /Electron/.test(navigator.userAgent);
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

let soundFiles = [];
let schedules = [];
let playlists = [];
let editingId = null;
let audio = null;       // o que está tocando agora na janela do programa: { id, el }
let playing = null;     // state.soundNow (o que está tocando, venha de onde vier)
let output = 'app';     // onde o som sai: 'app' (este computador) ou 'obs'
let plEditing = null;   // playlist aberta no editor: { id, name, items, transition, transitionTime }

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sizeText = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const soundTitle = (name) => name.replace(/\.[^.]+$/, '');
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const fileOf = (name) => soundFiles.find(f => f.name === name);
const playlistOf = (id) => playlists.find(p => p.id === id);
// Arquivos que um item de playlist usa (o rodízio usa vários)
const itemNames = (it) => (it.rotation ? [...it.rotation.files, it.rotation.special.name].filter(Boolean) : [it.name]);
const itemTitle = (it) => (it.rotation ? `Rodízio (${it.rotation.files.length})` : soundTitle(it.name));
const WEEK_NAMES = { w1: '1º domingo do mês', w2: '2º domingo do mês', w3: '3º domingo do mês', w4: '4º domingo do mês', last: 'último domingo do mês' };
const TRANSITION_NAMES = { fade: 'Esmaecer', black: 'Passar pelo preto', slide: 'Deslizar', zoom: 'Aproximar', none: 'Corte seco' };
// O que o agendamento toca (arquivo ou playlist)
const scheduleTitle = (s) => {
  if (s.label) return s.label;
  if (s.playlist) return playlistOf(s.playlist) ? playlistOf(s.playlist).name : 'Playlist apagada';
  return soundTitle(s.name || '');
};

// ---------- Próximo toque ----------

function runsOn(s, date) {
  if (s.mode === 'once') return s.date === dayKey(date);
  if (s.mode === 'weekly') return s.days.includes(date.getDay());
  return true;
}

function nextFire(s, from = new Date()) {
  if (!s.enabled) return null;
  const [h, m] = s.time.split(':').map(Number);
  for (let i = 0; i <= 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m, 0, 0);
    if (d > from && runsOn(s, d)) return d;
  }
  if (s.mode === 'once' && s.date) {
    const [y, mo, da] = s.date.split('-').map(Number);
    const d = new Date(y, mo - 1, da, h, m);
    return d > from ? d : null;
  }
  return null;
}

function whenText(date) {
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (dayKey(date) === today) return `hoje às ${time}`;
  if (dayKey(date) === tomorrow) return `amanhã às ${time}`;
  return `${DAY_NAMES[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)} às ${time}`;
}

function repeatText(s) {
  if (s.mode === 'daily') return 'Todos os dias';
  if (s.mode === 'once') {
    if (!s.date) return 'Uma vez';
    const [y, m, d] = s.date.split('-');
    return `Só em ${d}/${m}/${y}`;
  }
  if (s.days.length === 7) return 'Todos os dias';
  if (s.days.length === 1) {
    const d = s.days[0];
    return d === 0 ? 'Todo domingo' : d === 6 ? 'Todo sábado' : `Toda ${DAY_NAMES[d]}-feira`;
  }
  return s.days.map(d => DAY_SHORT[d]).join(', ');
}

// ---------- Sons enviados ----------

async function loadSounds() {
  try {
    soundFiles = await (await fetch('/api/sounds')).json();
  } catch (err) {
    soundFiles = [];
  }
  renderSoundSelect();
  renderSchedules();
  renderPlaylists();
  renderEditor();
}

const playIcon = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const stopIcon = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';

function renderSounds() {
  const list = $('sound-list');
  list.innerHTML = '';
  list.closest('.sounds-library').classList.toggle('pl-editing', !!plEditing);
  if (soundFiles.length === 0) {
    list.innerHTML = '<div class="empty">Envie o som do sino, um hino ou um vídeo de aviso.</div>';
    return;
  }
  soundFiles.forEach(file => {
    const row = document.createElement('div');
    row.className = 'sound-row';
    const isPlaying = playing && playing.name === file.name;
    row.classList.toggle('playing', !!isPlaying);
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'icon-btn';
    play.title = isPlaying ? 'Parar' : (file.kind === 'video' ? 'Passar agora (aparece no OBS)' : 'Tocar agora');
    play.innerHTML = isPlaying ? stopIcon : playIcon;
    play.onclick = () => (isPlaying ? ws.send('sound-stop') : ws.send('sound-play', { name: file.name, volume: 1 }));
    const name = document.createElement('div');
    name.className = 'sound-name';
    const strong = document.createElement('strong');
    strong.textContent = soundTitle(file.name);
    const meta = document.createElement('span');
    const uses = schedules.filter(s => s.name === file.name).length;
    const inLists = playlists.filter(p => p.items.some(it => itemNames(it).includes(file.name))).length;
    meta.textContent = [
      file.kind === 'video' ? 'Vídeo' : 'Som',
      sizeText(file.size),
      uses ? `${uses} agendamento${uses > 1 ? 's' : ''}` : '',
      inLists ? `em ${inLists} playlist${inLists > 1 ? 's' : ''}` : ''
    ].filter(Boolean).join(' · ');
    name.append(strong, meta);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'icon-btn pl-plus';
    add.title = 'Colocar na playlist que está aberta';
    add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 5h2v14h-2z"/><path d="M5 11h14v2H5z"/></svg>';
    add.onclick = () => addToPlaylist(file.name);
    const remove = document.createElement('button');
    const thumb = file.kind === 'video' ? videoThumb(file) : imageThumb(file);
    remove.type = 'button';
    remove.className = 'btn-x';
    remove.title = 'Apagar este arquivo';
    remove.textContent = '×';
    remove.onclick = async () => {
      const extra = [uses ? `os ${uses} agendamento(s) dele` : '', inLists ? `ele sai de ${inLists} playlist(s)` : ''].filter(Boolean).join(' e ');
      const ok = await confirmDialog({
        title: 'Apagar este arquivo?',
        text: `"${soundTitle(file.name)}" será apagado${extra ? ` (${extra})` : ''}.`,
        okLabel: 'Apagar',
        danger: true
      });
      if (!ok) return;
      await fetch(`/api/sounds/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
      loadSounds();
    };
    row.append(play, thumb, name, add, remove);
    list.appendChild(row);
  });
}

// Vídeo: mostra um quadro dele (não tem imagem própria: ele mesmo aparece no OBS)
function videoThumb(file) {
  const box = document.createElement('div');
  box.className = 'sound-thumb video';
  const frame = document.createElement('div');
  frame.className = 'sound-thumb-pick';
  frame.title = 'Vídeo: aparece no OBS enquanto toca';
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = `${file.url}#t=1`;
  const tag = document.createElement('span');
  tag.className = 'sound-kind';
  tag.textContent = 'VÍDEO';
  frame.append(video, tag);
  box.appendChild(frame);
  return box;
}

// ---------- Imagem do som (aparece no OBS enquanto ele toca) ----------

const imageIcon = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';

function imageThumb(file) {
  const box = document.createElement('div');
  box.className = 'sound-thumb';
  box.classList.toggle('has-image', !!file.image);
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'sound-thumb-pick';
  pick.title = file.image ? 'Trocar a imagem que aparece no OBS enquanto este som toca' : 'Escolher uma imagem para aparecer no OBS enquanto este som toca';
  if (file.image) {
    const img = document.createElement('img');
    img.src = file.image;
    img.alt = '';
    pick.appendChild(img);
  } else {
    pick.innerHTML = imageIcon;
  }
  pick.onclick = () => chooseImage(file.name);
  box.appendChild(pick);
  if (file.image) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'sound-thumb-clear';
    clear.title = 'Tirar a imagem';
    clear.textContent = '×';
    clear.onclick = async () => {
      await fetch(`/api/sounds/${encodeURIComponent(file.name)}/image`, { method: 'DELETE' });
      toast('Imagem tirada.', 'success');
      loadSounds();
    };
    box.appendChild(clear);
  }
  return box;
}

function chooseImage(soundName) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const res = await fetch(`/api/sounds/${encodeURIComponent(soundName)}/image?file=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'falhou');
      toast(`Imagem colocada em "${soundTitle(soundName)}": aparece no OBS enquanto ele toca.`, 'success');
    } catch (err) {
      toast(`Não consegui enviar a imagem: ${err.message}`, 'error');
    }
    loadSounds();
  };
  input.click();
}

function renderSoundSelect() {
  const select = $('sch-sound');
  const current = select.value;
  select.innerHTML = '';
  if (soundFiles.length === 0 && playlists.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Envie um som ou vídeo primeiro';
    select.appendChild(option);
  }
  const group = (label, items) => {
    if (!items.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    items.forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      og.appendChild(option);
    });
    select.appendChild(og);
  };
  group('Playlists', playlists.map(p => [`pl:${p.id}`, `${p.name} (${p.items.length} ${p.items.length === 1 ? 'item' : 'itens'})`]));
  group('Sons', soundFiles.filter(f => f.kind !== 'video').map(f => [`file:${f.name}`, soundTitle(f.name)]));
  group('Vídeos', soundFiles.filter(f => f.kind === 'video').map(f => [`file:${f.name}`, soundTitle(f.name)]));
  if ([...select.options].some(o => o.value === current)) select.value = current;
  $('btn-sch-save').disabled = !select.value;

  const add = $('pl-add-select');
  const keep = add.value;
  add.innerHTML = '';
  soundFiles.forEach(f => {
    const option = document.createElement('option');
    option.value = f.name;
    option.textContent = `${f.kind === 'video' ? 'Vídeo' : 'Som'}: ${soundTitle(f.name)}`;
    add.appendChild(option);
  });
  if (soundFiles.some(f => f.name === keep)) add.value = keep;
  $('btn-pl-add').disabled = soundFiles.length === 0;
}

function uploadSound(file) {
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
    $('sound-uploads').appendChild(row);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sounds/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) fill.style.width = `${(e.loaded / e.total) * 100}%`; };
    const finish = (error) => {
      if (!error) row.remove();
      else {
        row.classList.add('failed');
        name.textContent = `${file.name}: ${error}`;
        setTimeout(() => row.remove(), 6000);
      }
      resolve(!error);
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) { /* resposta inválida */ }
      finish(xhr.status >= 200 && xhr.status < 300 ? null : (data.error || 'falhou'));
    };
    xhr.onerror = () => finish('sem conexão');
    xhr.send(file);
  });
}

async function uploadSounds(files) {
  const list = [...files].filter(f => /\.(mp3|wav|ogg|m4a|aac|flac|mp4|webm|mov|m4v)$/i.test(f.name));
  if (list.length === 0) {
    toast('Escolha sons (.mp3, .wav...) ou vídeos (.mp4, .webm, .mov).', 'error');
    return;
  }
  let ok = 0;
  for (const file of list) if (await uploadSound(file)) ok++;
  if (ok) toast(`${ok} arquivo(s) enviado(s).`, 'success');
  loadSounds();
}

// ---------- Agendamentos ----------

const dayBoxes = () => [...$('sch-days').querySelectorAll('input')];

function renderFormMode() {
  const mode = $('sch-mode').value;
  $('sch-days-field').hidden = mode !== 'weekly';
  $('sch-date-field').hidden = mode !== 'once';
  if (mode === 'once' && !$('sch-date').value) $('sch-date').value = dayKey(new Date());
  $('sch-volume-val').textContent = `${$('sch-volume').value}%`;
}

// ---------- Horário (horas e minutos com setas, rodinha e teclado) ----------

function setTime(value) {
  const [h, m] = String(value || '19:00').split(':').map(Number);
  const hh = pad(((h % 24) + 24) % 24);
  const mm = pad(((m % 60) + 60) % 60);
  $('sch-time').value = `${hh}:${mm}`;
  $('sch-hour').value = hh;
  $('sch-minute').value = mm;
}

function stepTime(part, step) {
  const [h, m] = $('sch-time').value.split(':').map(Number);
  if (part === 'h') setTime(`${h + step}:${m}`);
  // Os minutos andam de 5 em 5 e param no múltiplo de 5 mais perto
  else setTime(`${h}:${step > 0 ? Math.floor(m / 5) * 5 + 5 : Math.ceil(m / 5) * 5 - 5}`);
}

function setupTimePicker() {
  $('sch-time-pick').querySelectorAll('.time-step').forEach(btn => {
    btn.onclick = () => stepTime(btn.dataset.part, Number(btn.dataset.step));
  });
  [['sch-hour', 'h', 1, 23], ['sch-minute', 'm', 5, 59]].forEach(([id, part, step, max]) => {
    const input = $(id);
    input.onfocus = () => input.select();
    input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 2); };
    const commit = () => {
      const n = Math.min(max, Number(input.value || 0));
      const [h, m] = $('sch-time').value.split(':');
      setTime(part === 'h' ? `${n}:${m}` : `${h}:${n}`);
    };
    input.onblur = commit;
    input.onkeydown = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        commit();
        stepTime(part, e.key === 'ArrowUp' ? step : -step);
        input.select();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        if (part === 'h') $('sch-minute').focus();
      }
    };
    input.addEventListener('wheel', (e) => {
      e.preventDefault();
      stepTime(part, e.deltaY < 0 ? step : -step);
    }, { passive: false });
  });
  setTime($('sch-time').value);
}

function resetForm() {
  editingId = null;
  $('schedule-form').classList.remove('editing');
  $('schedule-form-title').textContent = 'Novo agendamento';
  $('btn-sch-save').textContent = 'Adicionar agendamento';
  $('btn-sch-cancel').hidden = true;
  $('sch-label').value = '';
  $('sch-volume').value = 100;
  renderFormMode();
}

function editSchedule(s) {
  editingId = s.id;
  $('schedule-form').classList.add('editing');
  $('schedule-form-title').textContent = 'Editar agendamento';
  $('btn-sch-save').textContent = 'Salvar alterações';
  $('btn-sch-cancel').hidden = false;
  $('sch-sound').value = s.playlist ? `pl:${s.playlist}` : `file:${s.name}`;
  setTime(s.time);
  $('sch-label').value = s.label;
  $('sch-mode').value = s.mode;
  $('sch-date').value = s.date || '';
  dayBoxes().forEach(b => { b.checked = s.days.includes(Number(b.value)); });
  $('sch-volume').value = Math.round(s.volume * 100);
  renderFormMode();
  $('schedule-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveSchedules(list) {
  schedules = list;
  ws.send('sound-schedules', { items: list });
  renderSchedules();
}

function renderSchedules() {
  const list = $('schedule-list');
  list.innerHTML = '';
  $('schedule-count').textContent = schedules.length ? `${schedules.length} no total` : '';
  if (schedules.length === 0) {
    list.innerHTML = '<div class="empty">Nenhum agendamento ainda. Ex.: sino todo domingo às 18:30 e de novo às 19:00.</div>';
  }
  const sorted = [...schedules].sort((a, b) => a.time.localeCompare(b.time));
  sorted.forEach(s => {
    const row = document.createElement('div');
    row.className = 'schedule-row';
    row.classList.toggle('off', !s.enabled);

    const toggle = document.createElement('label');
    toggle.className = 'switch';
    toggle.title = s.enabled ? 'Ligado (clique para desligar)' : 'Desligado (clique para ligar)';
    toggle.innerHTML = `<input type="checkbox" ${s.enabled ? 'checked' : ''}><span class="switch-ui"></span>`;
    toggle.querySelector('input').onchange = (e) => {
      saveSchedules(schedules.map(x => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)));
    };

    const time = document.createElement('div');
    time.className = 'schedule-time';
    time.textContent = s.time;

    const info = document.createElement('div');
    info.className = 'schedule-info';
    const title = document.createElement('strong');
    title.textContent = scheduleTitle(s);
    const detail = document.createElement('span');
    let what;
    if (s.playlist) {
      const pl = playlistOf(s.playlist);
      what = pl ? `Playlist "${pl.name}" (${pl.items.length} ${pl.items.length === 1 ? 'item' : 'itens'})` : 'playlist apagada';
    } else {
      const file = fileOf(s.name);
      what = file ? `${file.kind === 'video' ? 'Vídeo' : 'Som'} "${soundTitle(s.name)}"` : 'arquivo apagado';
    }
    detail.textContent = `${repeatText(s)} · ${what} · volume ${Math.round(s.volume * 100)}%`;
    const next = document.createElement('span');
    const when = nextFire(s);
    next.className = when ? 'next' : '';
    next.textContent = when ? `Próximo: ${whenText(when)}` : (s.enabled ? 'Sem próximo toque' : 'Desligado');
    info.append(title, detail, next);

    const actions = document.createElement('div');
    actions.className = 'schedule-actions';
    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'icon-btn';
    test.title = 'Tocar agora para testar';
    test.innerHTML = playIcon;
    test.onclick = () => ws.send('sound-play', { name: s.name, playlist: s.playlist, volume: s.volume, label: s.label || undefined });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn-x small';
    edit.title = 'Editar';
    edit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    edit.onclick = () => editSchedule(s);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x';
    remove.title = 'Apagar agendamento';
    remove.textContent = '×';
    remove.onclick = async () => {
      const ok = await confirmDialog({ title: 'Apagar agendamento?', text: `${s.time} · ${scheduleTitle(s)}`, okLabel: 'Apagar', danger: true });
      if (!ok) return;
      if (editingId === s.id) resetForm();
      saveSchedules(schedules.filter(x => x.id !== s.id));
    };
    actions.append(test, edit, remove);

    row.append(toggle, time, info, actions);
    list.appendChild(row);
  });
  renderUpcoming();
  renderSounds();
  renderPlaylists();
}

function renderUpcoming() {
  const list = $('upcoming-list');
  list.innerHTML = '';
  const upcoming = schedules
    .map(s => ({ s, when: nextFire(s) }))
    .filter(x => x.when)
    .sort((a, b) => a.when - b.when)
    .slice(0, 8);
  if (upcoming.length === 0) {
    list.innerHTML = '<div class="empty">Nada marcado.</div>';
    return;
  }
  upcoming.forEach(({ s, when }) => {
    const row = document.createElement('div');
    row.className = 'upcoming-row';
    const name = document.createElement('strong');
    name.textContent = scheduleTitle(s);
    const date = document.createElement('span');
    date.textContent = whenText(when);
    row.append(name, date);
    list.appendChild(row);
  });
}

function setupForm() {
  $('sch-mode').onchange = renderFormMode;
  $('sch-volume').oninput = renderFormMode;
  $('sch-sound').onchange = () => { $('btn-sch-save').disabled = !$('sch-sound').value; };
  $('btn-sch-cancel').onclick = resetForm;
  $('schedule-form').onsubmit = (e) => {
    e.preventDefault();
    const what = $('sch-sound').value;
    if (!what) {
      toast('Envie um som ou vídeo primeiro.', 'error');
      return;
    }
    const mode = $('sch-mode').value;
    const days = dayBoxes().filter(b => b.checked).map(b => Number(b.value));
    if (mode === 'weekly' && days.length === 0) {
      toast('Escolha pelo menos um dia da semana.', 'error');
      return;
    }
    if (mode === 'once' && !$('sch-date').value) {
      toast('Escolha o dia.', 'error');
      return;
    }
    const item = {
      id: editingId || newId(),
      name: what.startsWith('file:') ? what.slice(5) : null,
      playlist: what.startsWith('pl:') ? what.slice(3) : null,
      label: $('sch-label').value.trim(),
      time: $('sch-time').value,
      mode,
      date: mode === 'once' ? $('sch-date').value : null,
      days: mode === 'weekly' ? days : [],
      volume: Number($('sch-volume').value) / 100,
      enabled: true
    };
    const exists = schedules.some(s => s.id === item.id);
    saveSchedules(exists ? schedules.map(s => (s.id === item.id ? item : s)) : [...schedules, item]);
    toast(exists ? 'Agendamento salvo.' : `Agendado: ${item.time} · ${repeatText(item)}.`, 'success');
    resetForm();
  };
}

// ---------- Playlists ----------

function renderPlaylists() {
  const list = $('pl-list');
  list.innerHTML = '';
  if (playlists.length === 0) {
    list.innerHTML = '<div class="empty">Nenhuma playlist ainda. Clique em "+ Nova playlist".</div>';
    return;
  }
  playlists.forEach(p => {
    const row = document.createElement('div');
    row.className = 'schedule-row pl-row';
    const badge = document.createElement('div');
    badge.className = 'pl-badge';
    badge.innerHTML = `${p.items.length}<small>${p.items.length === 1 ? 'item' : 'itens'}</small>`;
    const info = document.createElement('div');
    info.className = 'schedule-info';
    const title = document.createElement('strong');
    title.textContent = p.name;
    const detail = document.createElement('span');
    detail.textContent = p.items.map(itemTitle).join(' → ') || 'Vazia';
    const meta = document.createElement('span');
    const own = schedules.filter(s => s.playlist === p.id);
    const uses = own.length;
    meta.textContent = `Transição: ${TRANSITION_NAMES[p.transition] || p.transition}${p.transition !== 'none' ? ` (${String(p.transitionTime).replace('.', ',')} s)` : ''}`;
    // Quando ela começa sozinha
    const starts = document.createElement('span');
    const next = own.map(s => nextFire(s)).filter(Boolean).sort((a, b) => a - b)[0];
    starts.className = next ? 'next' : '';
    starts.textContent = uses
      ? `Começa: ${own.map(s => `${s.time} (${repeatText(s).toLowerCase()})`).join(', ')}${next ? ` · próxima ${whenText(next)}` : ''}`
      : 'Sem horário marcado';
    info.append(title, detail, meta, starts);

    const actions = document.createElement('div');
    actions.className = 'schedule-actions';
    const when = document.createElement('button');
    when.type = 'button';
    when.className = 'btn btn-secondary btn-sm';
    when.title = 'Marcar a hora em que a playlist começa sozinha';
    when.textContent = 'Agendar';
    when.onclick = () => schedulePlaylist(p.id);
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'icon-btn';
    play.title = 'Tocar agora';
    play.innerHTML = playIcon;
    play.disabled = p.items.length === 0;
    play.onclick = () => ws.send('sound-play', { playlist: p.id, volume: 1 });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn-x small';
    edit.title = 'Editar';
    edit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    edit.onclick = () => openEditor(p);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x';
    remove.title = 'Apagar playlist';
    remove.textContent = '×';
    remove.onclick = async () => {
      const ok = await confirmDialog({
        title: 'Apagar playlist?',
        text: `"${p.name}"${uses ? ` e os ${uses} agendamento(s) dela` : ''} serão apagados. Os arquivos continuam.`,
        okLabel: 'Apagar',
        danger: true
      });
      if (!ok) return;
      if (plEditing && plEditing.id === p.id) closeEditor();
      savePlaylists(playlists.filter(x => x.id !== p.id));
    };
    actions.append(when, play, edit, remove);
    row.append(badge, info, actions);
    list.appendChild(row);
  });
}

function savePlaylists(list) {
  playlists = list;
  ws.send('sound-playlists', { items: list });
  renderPlaylists();
  renderSoundSelect();
  renderSounds();
}

function openEditor(p) {
  plEditing = p ? JSON.parse(JSON.stringify(p)) : { id: newId(), name: '', items: [], transition: 'fade', transitionTime: 1, isNew: true };
  $('pl-name').value = plEditing.name;
  $('pl-transition').value = plEditing.transition;
  $('pl-time').value = plEditing.transitionTime;
  $('pl-editor').hidden = false;
  $('btn-pl-new').hidden = true;
  $('btn-pl-save').textContent = plEditing.isNew ? 'Criar playlist' : 'Salvar playlist';
  renderEditor();
  renderSounds();
  $('pl-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!plEditing.name) $('pl-name').focus();
}

function closeEditor() {
  plEditing = null;
  $('pl-editor').hidden = true;
  $('btn-pl-new').hidden = false;
  renderSounds();
}

function renderEditor() {
  if (!plEditing) return;
  $('pl-time-field').hidden = $('pl-transition').value === 'none';
  $('pl-time-val').textContent = `${Number($('pl-time').value).toFixed(1).replace('.', ',')} s`;
  const box = $('pl-items');
  box.innerHTML = '';
  $('pl-count').textContent = plEditing.items.length ? `${plEditing.items.length} ${plEditing.items.length === 1 ? 'item' : 'itens'}` : '';
  if (plEditing.items.length === 0) {
    box.innerHTML = '<div class="empty">Coloque os sons e vídeos na ordem em que devem tocar.</div>';
    return;
  }
  plEditing.items.forEach((it, i) => {
    const file = it.rotation ? null : fileOf(it.name);
    const row = document.createElement('div');
    row.className = 'pl-item';
    // Arrasta pela linha, mas não quando mexe no volume ou no rodízio
    row.onpointerdown = (e) => { row.draggable = !e.target.closest('input, button, select, .rot-box'); };
    const num = document.createElement('span');
    num.className = 'pl-num';
    num.textContent = i + 1;
    const kind = document.createElement('span');
    kind.className = 'pl-kind';
    kind.textContent = it.rotation ? 'Rodízio' : !file ? '?' : file.kind === 'video' ? 'Vídeo' : file.image ? 'Som + imagem' : 'Som';
    const name = document.createElement('span');
    name.className = 'pl-name';
    name.classList.toggle('missing', !it.rotation && !file);
    name.textContent = it.rotation ? rotationSummary(it.rotation) : file ? soundTitle(it.name) : `${soundTitle(it.name)} (apagado)`;
    const vol = document.createElement('label');
    vol.className = 'pl-vol';
    vol.title = 'Volume deste item';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = 0;
    range.max = 100;
    range.step = 5;
    range.value = Math.round(it.volume * 100);
    const out = document.createElement('span');
    out.textContent = `${range.value}%`;
    range.oninput = () => { it.volume = Number(range.value) / 100; out.textContent = `${range.value}%`; };
    vol.append(range, out);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x';
    remove.title = 'Tirar da playlist';
    remove.textContent = '×';
    remove.onclick = () => { plEditing.items.splice(i, 1); renderEditor(); };
    row.append(num, kind, name, vol, remove);
    if (it.rotation) {
      row.classList.add('rot');
      row.appendChild(rotationBox(it.rotation));
    }
    box.appendChild(row);
  });
}

// ---------- Rodízio (um arquivo diferente a cada vez que toca pelo horário, e um especial no domingo marcado) ----------

const dateBr = (key) => key.split('-').reverse().join('/');

function rotationSummary(r) {
  const next = r.files.length ? soundTitle(r.files[r.next % r.files.length]) : 'nenhum';
  return `${r.files.length} ${r.files.length === 1 ? 'arquivo' : 'arquivos'} · próximo: ${next}${r.special.name ? ` · ${WEEK_NAMES[r.special.week]}: ${soundTitle(r.special.name)}` : ''}`;
}

function fileOptions(select, empty) {
  select.innerHTML = '';
  if (empty) select.add(new Option(empty, ''));
  soundFiles.forEach(f => select.add(new Option(`${f.kind === 'video' ? 'Vídeo' : 'Som'}: ${soundTitle(f.name)}`, f.name)));
}

function rotationBox(r) {
  const box = document.createElement('div');
  box.className = 'rot-box';
  const redraw = () => renderEditor();

  const head = document.createElement('div');
  head.className = 'rot-label';
  head.textContent = 'Um a cada vez que a playlist toca pelo horário, nesta ordem (clique num para ele ser o próximo):';
  const list = document.createElement('div');
  list.className = 'rot-files';
  if (r.files.length === 0) list.innerHTML = '<div class="muted small">Coloque os vídeos do rodízio aqui embaixo.</div>';
  r.files.forEach((name, i) => {
    const chip = document.createElement('div');
    chip.className = 'rot-file';
    chip.classList.toggle('next', i === r.next % r.files.length);
    chip.classList.toggle('missing', !fileOf(name));
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'rot-pick';
    pick.title = 'Tocar este na próxima vez';
    pick.textContent = `${i + 1}. ${soundTitle(name)}${i === r.next % r.files.length ? ' (próximo)' : ''}`;
    pick.onclick = () => { r.next = i; r.lastDate = null; r.lastName = null; redraw(); };
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn-x small';
    up.title = 'Subir na ordem';
    up.textContent = '↑';
    up.disabled = i === 0;
    up.onclick = () => {
      const nextName = r.files[r.next % r.files.length];
      r.files = moveItem(r.files, i, i - 1);
      r.next = r.files.indexOf(nextName);
      redraw();
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x small';
    remove.title = 'Tirar do rodízio';
    remove.textContent = '×';
    remove.onclick = () => {
      const nextName = r.files[r.next % r.files.length];
      r.files.splice(i, 1);
      r.next = Math.max(0, r.files.indexOf(nextName === name ? r.files[i] || r.files[0] : nextName));
      redraw();
    };
    chip.append(pick, up, remove);
    list.appendChild(chip);
  });

  const add = document.createElement('div');
  add.className = 'pl-add';
  const addSelect = document.createElement('select');
  addSelect.setAttribute('aria-label', 'Arquivo para pôr no rodízio');
  fileOptions(addSelect);
  addSelect.value = (soundFiles.find(f => f.kind === 'video' && !r.files.includes(f.name)) || {}).name || addSelect.value;
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary btn-sm';
  addBtn.textContent = '+ Pôr no rodízio';
  addBtn.onclick = () => {
    if (!addSelect.value) return;
    r.files.push(addSelect.value);
    redraw();
  };
  add.append(addSelect, addBtn);

  // Especial: no domingo marcado toca este no lugar do rodízio (o rodízio fica parado)
  const special = document.createElement('div');
  special.className = 'rot-special';
  const spLabel = document.createElement('span');
  spLabel.textContent = 'Especial:';
  const spFile = document.createElement('select');
  spFile.setAttribute('aria-label', 'Arquivo especial');
  fileOptions(spFile, 'Nenhum');
  spFile.value = r.special.name || '';
  spFile.onchange = () => { r.special.name = spFile.value || null; redraw(); };
  const spWeek = document.createElement('select');
  spWeek.setAttribute('aria-label', 'Em qual domingo do mês');
  Object.entries(WEEK_NAMES).forEach(([value, text]) => spWeek.add(new Option(`no ${text}`, value)));
  spWeek.value = r.special.week;
  spWeek.disabled = !r.special.name;
  spWeek.onchange = () => { r.special.week = spWeek.value; };
  special.append(spLabel, spFile, spWeek);

  box.append(head, list, add, special);
  if (!r.special.name) return box;

  // Mudou de data num mês (ex: a Ceia foi para outro domingo): nesse mês o especial toca só na data marcada
  const moved = document.createElement('div');
  moved.className = 'rot-moved';
  const mvLabel = document.createElement('span');
  mvLabel.textContent = 'Mudou de data num mês? Marque o dia:';
  const mvDate = document.createElement('input');
  mvDate.type = 'date';
  const mvBtn = document.createElement('button');
  mvBtn.type = 'button';
  mvBtn.className = 'btn btn-secondary btn-sm';
  mvBtn.textContent = 'Marcar';
  mvBtn.onclick = () => {
    if (!mvDate.value) return;
    r.special.moved = [...r.special.moved.filter(d => d.slice(0, 7) !== mvDate.value.slice(0, 7)), mvDate.value].sort();
    redraw();
  };
  moved.append(mvLabel, mvDate, mvBtn);
  const today = dayKey(new Date());
  r.special.moved.filter(d => d >= today.slice(0, 7)).forEach(d => {
    const chip = document.createElement('span');
    chip.className = 'rot-date';
    chip.textContent = `${dateBr(d)} (no lugar do ${WEEK_NAMES[r.special.week].replace(' do mês', '')} desse mês)`;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'btn-x small';
    x.title = 'Desmarcar';
    x.textContent = '×';
    x.onclick = () => { r.special.moved = r.special.moved.filter(m => m !== d); redraw(); };
    chip.appendChild(x);
    moved.appendChild(chip);
  });
  box.appendChild(moved);
  return box;
}

function addToPlaylist(name) {
  if (!plEditing) return;
  plEditing.items.push({ name, volume: 1 });
  renderEditor();
  toast(`"${soundTitle(name)}" entrou na playlist.`, 'success');
}

function setupPlaylists() {
  document.querySelectorAll('input[name="sched-view"]').forEach(r => {
    r.onchange = () => {
      $('sched-view-schedules').hidden = r.value !== 'schedules';
      $('sched-view-playlists').hidden = r.value !== 'playlists';
    };
  });
  $('btn-pl-new').onclick = () => openEditor(null);
  $('btn-pl-cancel').onclick = closeEditor;
  $('btn-pl-add').onclick = () => { if ($('pl-add-select').value) addToPlaylist($('pl-add-select').value); };
  $('btn-pl-rotation').onclick = () => {
    if (!plEditing) return;
    plEditing.items.push({ rotation: { files: [], next: 0, lastDate: null, lastName: null, special: { name: null, week: 'w1', moved: [] } }, volume: 1 });
    renderEditor();
  };
  $('pl-transition').onchange = renderEditor;
  $('pl-time').oninput = () => { $('pl-time-val').textContent = `${Number($('pl-time').value).toFixed(1).replace('.', ',')} s`; };
  makeSortable($('pl-items'), '.pl-item', (from, to) => {
    if (!plEditing) return;
    plEditing.items = moveItem(plEditing.items, from, to);
    renderEditor();
  });
  $('pl-editor').onsubmit = (e) => {
    e.preventDefault();
    const name = $('pl-name').value.trim();
    if (!name) {
      toast('Dê um nome para a playlist.', 'error');
      $('pl-name').focus();
      return;
    }
    if (plEditing.items.length === 0) {
      toast('Coloque pelo menos um som ou vídeo.', 'error');
      return;
    }
    if (plEditing.items.some(it => it.rotation && !it.rotation.files.length && !it.rotation.special.name)) {
      toast('O rodízio está vazio: coloque os vídeos dele.', 'error');
      return;
    }
    const item = {
      id: plEditing.id,
      name,
      items: plEditing.items,
      transition: $('pl-transition').value,
      transitionTime: Number($('pl-time').value)
    };
    const exists = playlists.some(p => p.id === item.id);
    savePlaylists(exists ? playlists.map(p => (p.id === item.id ? item : p)) : [...playlists, item]);
    closeEditor();
    if (exists) {
      toast('Playlist salva.', 'success');
    } else {
      // Nova playlist: já abre o agendamento dela para escolher a hora de início
      toast(`Playlist "${name}" criada. Escolha a hora em que ela começa.`, 'success');
      schedulePlaylist(item.id);
    }
  };
}

// Abre o "Novo agendamento" com a playlist já escolhida
function schedulePlaylist(id) {
  const radio = document.querySelector('input[name="sched-view"][value="schedules"]');
  radio.checked = true;
  radio.onchange();
  resetForm();
  $('sch-sound').value = `pl:${id}`;
  $('btn-sch-save').disabled = false;
  $('schedule-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('sch-hour').focus();
}

// ---------- Tocando agora ----------

function renderNowPlaying() {
  $('now-playing').classList.toggle('on', !!playing);
  $('now-playing-name').textContent = playing ? playing.label : 'Nada tocando';
  const list = playing && playing.playlist;
  $('now-playing-list').hidden = !list;
  $('now-playing-list').textContent = list ? `Playlist "${list.name}": ${list.index + 1} de ${list.total}` : '';
  $('btn-sound-next').hidden = !list || list.index + 1 >= list.total;
  $('btn-sound-stop').disabled = !playing;
  renderSounds();
}

// Toca aqui (janela do programa, saída "Neste computador"); do vídeo, só o som
function stopLocal() {
  if (!audio) return;
  const el = audio.el;
  audio = null;
  // Solta os avisos antes de esvaziar: tirar o arquivo dispara "error" no <audio>
  el.onended = null;
  el.onerror = null;
  el.pause();
  el.removeAttribute('src');
  el.load();
}

function onPlay(p) {
  stopLocal();
  if (p.output === 'obs' || !CAN_PLAY) return;
  const el = new Audio(p.url);
  audio = { id: p.id, el };
  el.volume = p.volume;
  // Avisa o fim: o servidor passa para o próximo e a imagem/vídeo sai do OBS
  el.onended = () => { stopLocal(); ws.send('sound-ended', { id: p.id }); };
  el.onerror = () => { toast(`Não consegui tocar "${p.label}".`, 'error'); stopLocal(); ws.send('sound-ended', { id: p.id }); };
  el.play().catch(() => { toast('O som não pôde tocar.', 'error'); stopLocal(); });
}

function renderOutput() {
  document.querySelectorAll('input[name="sound-output"]').forEach(r => { r.checked = r.value === output; });
  $('sound-device-note').textContent = output === 'obs'
    ? 'O som sai no OBS, junto com o overlay (a fonte Navegador precisa estar aberta e com o som ligado no mixer). Deixe o programa aberto na hora marcada.'
    : CAN_PLAY
      ? 'O som sai neste computador (o som do programa); vídeos e imagens aparecem no OBS. Deixe o programa aberto na hora marcada: pode estar minimizado.'
      : 'Este aparelho só controla: o som sai no computador onde o programa está aberto.';
}

export function setupSounds() {
  const onState = (state) => {
    if (state.soundOutput && state.soundOutput !== output) {
      output = state.soundOutput;
      renderOutput();
    }
    const now = state.soundNow || null;
    if (JSON.stringify(now) !== JSON.stringify(playing)) {
      playing = now;
      renderNowPlaying();
      renderPlaylists();
    }
    if (state.soundPlaylists && JSON.stringify(state.soundPlaylists) !== JSON.stringify(playlists)) {
      playlists = state.soundPlaylists;
      renderPlaylists();
      renderSoundSelect();
    }
    if (!state.soundSchedules) return;
    schedules = state.soundSchedules;
    renderSchedules();
  };
  ws.on('init', onState);
  ws.on('update-content', onState);
  ws.on('sound-play', onPlay);
  ws.on('sound-stop', stopLocal);
  ws.on('sound-ended', (p) => { if (audio && audio.id === p.id) stopLocal(); });

  document.querySelectorAll('input[name="sound-output"]').forEach(r => {
    r.onchange = () => {
      output = r.value;
      renderOutput();
      ws.send('sound-output', { output });
    };
  });
  renderOutput();

  $('btn-sound-stop').onclick = () => ws.send('sound-stop');
  $('btn-sound-next').onclick = () => ws.send('sound-next');
  $('sound-files').onchange = (e) => { uploadSounds(e.target.files); e.target.value = ''; };
  const zone = $('sound-dropzone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragging');
    uploadSounds(e.dataTransfer.files);
  });

  setupTimePicker();
  setupForm();
  setupPlaylists();
  resetForm();
  loadSounds();
  // "Próximo: hoje às..." anda com o relógio
  setInterval(renderUpcoming, 60000);
}

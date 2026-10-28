// Aba Sons: sons agendados (o sino antes do culto, um hino para começar...).
// O servidor marca a hora e manda "sound-play"; quem toca é a janela do programa (Electron)
// neste computador ("app") ou o overlay do OBS ("obs"). No celular ou no navegador só aparece o aviso.
import { $, toast, confirmDialog } from './ui.js';
import * as ws from './ws.js';

const CAN_PLAY = /Electron/.test(navigator.userAgent);
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

let soundFiles = [];
let schedules = [];
let editingId = null;
let audio = null;       // o que está tocando agora (só na janela do programa)
let playing = null;     // { name, label }
let playingTimer = null;
let output = 'app';     // onde o som sai: 'app' (este computador) ou 'obs'

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sizeText = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const soundTitle = (name) => name.replace(/\.[^.]+$/, '');

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
  renderSounds();
  renderSoundSelect();
  renderSchedules();
}

const playIcon = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const stopIcon = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';

function renderSounds() {
  const list = $('sound-list');
  list.innerHTML = '';
  if (soundFiles.length === 0) {
    list.innerHTML = '<div class="empty">Envie o som do sino ou do hino que toca antes do culto.</div>';
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
    play.title = isPlaying ? 'Parar' : 'Tocar agora';
    play.innerHTML = isPlaying ? stopIcon : playIcon;
    play.onclick = () => (isPlaying ? ws.send('sound-stop') : ws.send('sound-play', { name: file.name, volume: 1, label: soundTitle(file.name) }));
    const name = document.createElement('div');
    name.className = 'sound-name';
    const strong = document.createElement('strong');
    strong.textContent = soundTitle(file.name);
    const meta = document.createElement('span');
    const uses = schedules.filter(s => s.name === file.name).length;
    meta.textContent = `${sizeText(file.size)}${uses ? ` · ${uses} agendamento${uses > 1 ? 's' : ''}` : ''}`;
    name.append(strong, meta);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-x';
    remove.title = 'Apagar este som';
    remove.textContent = '×';
    remove.onclick = async () => {
      const ok = await confirmDialog({
        title: 'Apagar este som?',
        text: uses ? `"${soundTitle(file.name)}" e os ${uses} agendamento(s) dele serão apagados.` : `"${soundTitle(file.name)}" será apagado.`,
        okLabel: 'Apagar',
        danger: true
      });
      if (!ok) return;
      await fetch(`/api/sounds/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
      loadSounds();
    };
    row.append(play, name, remove);
    list.appendChild(row);
  });
}

function renderSoundSelect() {
  const select = $('sch-sound');
  const current = select.value;
  select.innerHTML = '';
  if (soundFiles.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Envie um som primeiro';
    select.appendChild(option);
  }
  soundFiles.forEach(file => {
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = soundTitle(file.name);
    select.appendChild(option);
  });
  if (soundFiles.some(f => f.name === current)) select.value = current;
  $('btn-sch-save').disabled = soundFiles.length === 0;
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
  const list = [...files].filter(f => /^audio\//.test(f.type) || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f.name));
  if (list.length === 0) {
    toast('Escolha arquivos de som (.mp3, .wav...).', 'error');
    return;
  }
  let ok = 0;
  for (const file of list) if (await uploadSound(file)) ok++;
  if (ok) toast(`${ok} som(ns) enviado(s).`, 'success');
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
  $('sch-sound').value = s.name;
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
    const file = soundFiles.find(f => f.name === s.name);
    title.textContent = s.label || soundTitle(s.name);
    const detail = document.createElement('span');
    detail.textContent = `${repeatText(s)} · ${file ? soundTitle(s.name) : 'som apagado'} · volume ${Math.round(s.volume * 100)}%`;
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
    test.onclick = () => ws.send('sound-play', { name: s.name, volume: s.volume, label: s.label || soundTitle(s.name) });
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
      const ok = await confirmDialog({ title: 'Apagar agendamento?', text: `${s.time} · ${s.label || soundTitle(s.name)}`, okLabel: 'Apagar', danger: true });
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
    list.innerHTML = '<div class="empty">Nenhum toque marcado.</div>';
    return;
  }
  upcoming.forEach(({ s, when }) => {
    const row = document.createElement('div');
    row.className = 'upcoming-row';
    const name = document.createElement('strong');
    name.textContent = s.label || soundTitle(s.name);
    const date = document.createElement('span');
    date.textContent = whenText(when);
    row.append(name, date);
    list.appendChild(row);
  });
}

function setupForm() {
  $('sch-mode').onchange = renderFormMode;
  $('sch-volume').oninput = renderFormMode;
  $('btn-sch-cancel').onclick = resetForm;
  $('schedule-form').onsubmit = (e) => {
    e.preventDefault();
    const name = $('sch-sound').value;
    if (!name) {
      toast('Envie um som primeiro.', 'error');
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
      id: editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      name,
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

// ---------- Tocar (só na janela do programa) ----------

function renderNowPlaying() {
  $('now-playing').classList.toggle('on', !!playing);
  $('now-playing-name').textContent = playing ? playing.label : 'Nada tocando';
  $('btn-sound-stop').disabled = !playing;
  renderSounds();
}

function stopLocal() {
  if (audio) {
    // Solta os avisos antes de esvaziar: tirar o arquivo dispara "error" no <audio>
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = null;
  }
  clearTimeout(playingTimer);
  playing = null;
  renderNowPlaying();
}

function onPlay(p) {
  stopLocal();
  playing = { id: p.id, name: p.name, label: p.label };
  if (p.output === 'obs') {
    // Toca no OBS; o overlay avisa o fim ("sound-ended"). Se o OBS não estiver aberto, some sozinho.
    playingTimer = setTimeout(() => { playing = null; renderNowPlaying(); }, 10 * 60 * 1000);
  } else if (CAN_PLAY) {
    audio = new Audio(p.url);
    audio.volume = p.volume;
    audio.onended = stopLocal;
    audio.onerror = () => { toast(`Não consegui tocar "${p.label}".`, 'error'); stopLocal(); };
    audio.play().catch(() => { toast('O som não pôde tocar.', 'error'); stopLocal(); });
  } else {
    // Aqui (celular/navegador) só mostra; o som sai no computador do programa
    playingTimer = setTimeout(() => { playing = null; renderNowPlaying(); }, 15000);
  }
  renderNowPlaying();
}

function renderOutput() {
  document.querySelectorAll('input[name="sound-output"]').forEach(r => { r.checked = r.value === output; });
  $('sound-device-note').textContent = output === 'obs'
    ? 'Os sons saem no OBS, junto com o overlay (a fonte Navegador precisa estar aberta e com o som ligado no mixer). Deixe o programa aberto na hora marcada.'
    : CAN_PLAY
      ? 'Os sons saem neste computador (o som do programa). Deixe o programa aberto na hora marcada: pode estar minimizado.'
      : 'Este aparelho só controla: os sons saem no computador onde o programa está aberto.';
}

export function setupSounds() {
  const onState = (state) => {
    if (state.soundOutput && state.soundOutput !== output) {
      output = state.soundOutput;
      renderOutput();
    }
    if (!state.soundSchedules) return;
    schedules = state.soundSchedules;
    renderSchedules();
  };
  ws.on('init', onState);
  ws.on('update-content', onState);
  ws.on('sound-play', onPlay);
  ws.on('sound-stop', stopLocal);
  ws.on('sound-ended', (p) => { if (playing && playing.id === p.id) stopLocal(); });

  document.querySelectorAll('input[name="sound-output"]').forEach(r => {
    r.onchange = () => {
      output = r.value;
      renderOutput();
      ws.send('sound-output', { output });
    };
  });
  renderOutput();

  $('btn-sound-stop').onclick = () => ws.send('sound-stop');
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
  resetForm();
  loadSounds();
  // "Próximo: hoje às..." anda com o relógio
  setInterval(renderUpcoming, 60000);
}

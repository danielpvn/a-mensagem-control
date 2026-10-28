// Aba Agendamentos: sons e vídeos que entram sozinhos na hora marcada (o sino antes do culto, um vídeo de aviso...).
// Os arquivos ficam em Documentos/A Mensagem Control/data/sounds e são servidos em /sounds/.
// Cada som pode ter uma imagem (data/sounds/_imagens/<som>.<ext>) que aparece no OBS enquanto ele toca.
// Playlists: { id, name, items: [{ name, volume }], transition, transitionTime } tocam um item atrás do outro.
// Agendamentos: { id, name (arquivo) ou playlist (id), label, time "HH:MM", mode, date, days, volume, enabled }
//   mode 'once'   -> só no dia `date` ("2026-11-01"); depois de tocar, desliga sozinho
//   mode 'daily'  -> todo dia
//   mode 'weekly' -> nos dias da semana em `days` (0 = domingo ... 6 = sábado)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const DIR = path.join(db.DATA_DIR, 'sounds');
const AUDIO = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB por arquivo (vídeos)
const IMG_DIR = path.join(DIR, '_imagens');
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

fs.mkdirSync(IMG_DIR, { recursive: true });

function safe(name) {
  const clean = path.basename(String(name || ''))
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!clean) throw new Error('Nome inválido.');
  return clean;
}

function freeName(name) {
  if (!fs.existsSync(path.join(DIR, name))) return name;
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length || undefined);
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!fs.existsSync(path.join(DIR, candidate))) return candidate;
  }
}

// Imagens do som: "<nome do som>.png" etc.
function imageFiles(name) {
  const prefix = `${name}.`;
  return fs.readdirSync(IMG_DIR).filter(f => f.startsWith(prefix) && IMAGE.test(f) && !f.slice(prefix.length).includes('.'));
}

function imageUrl(name) {
  const file = imageFiles(name)[0];
  if (!file) return null;
  const stat = fs.statSync(path.join(IMG_DIR, file));
  return `/sounds/_imagens/${encodeURIComponent(file)}?v=${Math.round(stat.mtimeMs)}`;
}

function listSounds() {
  return fs.readdirSync(DIR)
    .filter(name => AUDIO.test(name) || VIDEO.test(name))
    .map(name => {
      const stat = fs.statSync(path.join(DIR, name));
      const kind = VIDEO.test(name) ? 'video' : 'audio';
      return { name, kind, size: stat.size, url: `/sounds/${encodeURIComponent(name)}`, image: kind === 'audio' ? imageUrl(name) : null, addedAt: stat.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Recebe o arquivo em streaming (igual às mídias)
function saveUpload(req, name) {
  let target;
  try {
    const fileName = safe(name);
    if (!AUDIO.test(fileName) && !VIDEO.test(fileName)) throw new Error('Envie um som (.mp3, .wav, .ogg, .m4a) ou um vídeo (.mp4, .webm, .mov).');
    target = path.join(DIR, freeName(fileName));
  } catch (err) {
    return Promise.reject(err);
  }
  return streamTo(req, target, MAX_BYTES, '4 GB');
}

// Imagem do som (troca a anterior)
async function saveImage(req, soundName, fileName) {
  const name = safe(soundName);
  if (!fs.existsSync(path.join(DIR, name))) throw new Error('Som não encontrado.');
  if (!AUDIO.test(name)) throw new Error('Só os sons têm imagem (o vídeo já aparece no OBS).');
  const ext = path.extname(safe(fileName)).toLowerCase();
  if (!IMAGE.test(ext)) throw new Error('Envie uma imagem (.png, .jpg, .webp ou .gif).');
  const old = imageFiles(name);
  const saved = await streamTo(req, path.join(IMG_DIR, `${name}${ext}`), MAX_IMAGE_BYTES, '30 MB');
  old.filter(f => f !== saved.name).forEach(f => fs.rmSync(path.join(IMG_DIR, f), { force: true }));
  return { image: imageUrl(name) };
}

function removeImage(name) {
  imageFiles(safe(name)).forEach(f => fs.rmSync(path.join(IMG_DIR, f), { force: true }));
}

function streamTo(req, target, maxBytes, maxText) {
  return new Promise((resolve, reject) => {
    const partial = `${target}.part`;
    const out = fs.createWriteStream(partial);
    let bytes = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(partial, { force: true }, () => {});
      reject(err);
    };
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        fail(new Error(`Arquivo grande demais (máximo ${maxText}).`));
      }
    });
    req.on('aborted', () => fail(new Error('Envio interrompido.')));
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (bytes === 0) {
        fs.rm(partial, { force: true }, () => {});
        reject(new Error('Arquivo vazio.'));
        return;
      }
      fs.rmSync(target, { force: true });
      fs.renameSync(partial, target);
      resolve({ name: path.basename(target), size: bytes });
    });
    req.pipe(out);
  });
}

function removeSound(name) {
  const file = path.join(DIR, safe(name));
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  removeImage(name);
  return true;
}

// ---------- Agendamentos ----------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanSchedule(raw) {
  const mode = ['once', 'daily', 'weekly'].includes(raw && raw.mode) ? raw.mode : 'daily';
  const days = Array.isArray(raw && raw.days)
    ? [...new Set(raw.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const playlist = raw && raw.playlist ? String(raw.playlist).slice(0, 40) : null;
  return {
    id: String((raw && raw.id) || crypto.randomUUID()).slice(0, 40),
    name: playlist ? null : safe(raw && raw.name),
    playlist,
    label: String((raw && raw.label) || '').trim().slice(0, 60),
    time: TIME.test(raw && raw.time) ? raw.time : '19:00',
    mode,
    date: mode === 'once' && DATE.test(raw && raw.date) ? raw.date : null,
    days: mode === 'weekly' ? (days.length ? days : [0]) : [],
    volume: Math.min(1, Math.max(0, Number(raw && raw.volume !== undefined ? raw.volume : 1) || 0)),
    enabled: raw ? raw.enabled !== false : true
  };
}

function loadSchedules() {
  return db.getSetting('soundSchedules', []).map(s => {
    try { return cleanSchedule(s); } catch (e) { return null; }
  }).filter(Boolean);
}

function saveSchedules(list) {
  const clean = (Array.isArray(list) ? list : []).slice(0, 100).map(s => {
    try { return cleanSchedule(s); } catch (e) { return null; }
  }).filter(Boolean);
  db.setSetting('soundSchedules', clean);
  return clean;
}

// ---------- Playlists ----------

const TRANSITIONS = ['none', 'fade', 'black', 'slide', 'zoom'];

function cleanPlaylist(raw) {
  const items = (Array.isArray(raw && raw.items) ? raw.items : []).slice(0, 100).map(it => {
    try {
      return { name: safe(it && it.name), volume: Math.min(1, Math.max(0, Number(it && it.volume !== undefined ? it.volume : 1) || 0)) };
    } catch (e) { return null; }
  }).filter(Boolean);
  const time = Number(raw && raw.transitionTime);
  return {
    id: String((raw && raw.id) || crypto.randomUUID()).slice(0, 40),
    name: String((raw && raw.name) || '').trim().slice(0, 60) || 'Playlist',
    items,
    transition: TRANSITIONS.includes(raw && raw.transition) ? raw.transition : 'fade',
    transitionTime: Number.isFinite(time) ? Math.min(5, Math.max(0.2, time)) : 1
  };
}

function loadPlaylists() {
  return db.getSetting('soundPlaylists', []).map(cleanPlaylist);
}

function savePlaylists(list) {
  const clean = (Array.isArray(list) ? list : []).slice(0, 50).map(cleanPlaylist);
  db.setSetting('soundPlaylists', clean);
  return clean;
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Vale para este dia (sem olhar a hora)?
function runsOn(s, date) {
  if (s.mode === 'once') return s.date === dayKey(date);
  if (s.mode === 'weekly') return s.days.includes(date.getDay());
  return true;
}

// Relógio: confere a cada poucos segundos e chama `onFire(schedule)` uma vez por minuto marcado.
// Se o computador estava desligado/dormindo na hora, não toca atrasado (só avisa se for até 1 min).
function startScheduler({ getSchedules, onFire, onChange }) {
  const fired = new Set();
  const tick = () => {
    const now = new Date();
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const minuteKey = `${dayKey(now)} ${hhmm}`;
    let changed = false;
    const list = getSchedules();
    list.forEach(s => {
      if (!s.enabled || s.time !== hhmm || !runsOn(s, now)) return;
      const key = `${s.id}|${minuteKey}`;
      if (fired.has(key)) return;
      fired.add(key);
      onFire(s);
      // "Só uma vez": depois de tocar, desliga
      if (s.mode === 'once') { s.enabled = false; changed = true; }
    });
    if (changed) onChange(saveSchedules(list));
    // Não guarda chaves velhas para sempre
    if (fired.size > 500) [...fired].slice(0, 400).forEach(k => fired.delete(k));
  };
  tick();
  return setInterval(tick, 5000);
}

module.exports = { DIR, TRANSITIONS, listSounds, loadPlaylists, savePlaylists, imageUrl, saveUpload, saveImage, removeImage, removeSound, loadSchedules, saveSchedules, startScheduler };

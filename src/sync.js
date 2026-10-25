// Sincronização com o banco online (Supabase): biblioteca de Mensagens, Hinos e imagens de fundo.
// - O PC sempre trabalha com o banco local; isto roda em segundo plano (a cada minuto e logo
//   depois de uma alteração). Sem internet, tenta de novo depois, sem atrapalhar o culto.
// - Leitor: só recebe. Editor: também envia o que mudou aqui.
// - Quem vence em conflito: a última versão enviada (a hora é sempre a do servidor).
const fs = require('fs');
const path = require('path');
const db = require('./db');
const hymns = require('./hymns');
const backgrounds = require('./backgrounds');
const defaults = require('./cloud-config');

const INTERVAL_MS = 60 * 1000;
const PAGE = 500;
const OVERLAP_MS = 5000; // relê um pouco para trás: alterações que chegaram no mesmo instante

let timer = null;
let soonTimer = null;
let running = null;
let listener = () => {};
let changedListener = () => {};
let status = { state: 'off', message: 'Banco online não conectado.', lastSync: null, lastError: null };

// ---------- Configuração e sessão ----------

const config = () => ({ ...defaults, ...db.getSetting('cloudConfig', {}) });
const session = () => db.getSetting('cloudSession', null);
const saveSession = (value) => db.setSetting('cloudSession', value);
const isConfigured = () => !!(config().url && config().anonKey);

function setStatus(partial) {
  status = { ...status, ...partial };
  listener(publicStatus());
}

function publicStatus() {
  const s = session();
  return {
    ...status,
    configured: isConfigured(),
    url: config().url || '',
    loggedIn: !!s,
    email: s ? s.email : null,
    role: s ? s.role : null,
    church: s ? s.church : null,
    pending: {
      sermons: db.countDirtySermons(),
      hymns: hymns.countDirtyHymns(),
      deletions: db.pendingDeletions('sermon').length + db.pendingDeletions('hymn').length + db.pendingDeletions('background').length
    }
  };
}

async function authRequest(grant, body) {
  const { url, anonKey } = config();
  const res = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error_description || data.msg || data.error || `Erro ${res.status}`;
    throw new Error(/invalid login/i.test(message) ? 'E-mail ou senha incorretos.' : message);
  }
  return data;
}

function sessionFrom(data, extra = {}) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    userId: data.user && data.user.id,
    email: data.user && data.user.email,
    ...extra
  };
}

// Renova o acesso quando está perto de vencer (o login dura 1 hora; a renovação, meses)
async function accessToken() {
  let s = session();
  if (!s) throw new Error('Não conectado.');
  if (Date.now() > s.expiresAt - 120000) {
    const data = await authRequest('refresh_token', { refresh_token: s.refreshToken });
    s = { ...s, ...sessionFrom(data, { role: s.role, church: s.church }) };
    saveSession(s);
  }
  return s.accessToken;
}

async function api(pathAndQuery, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const { url, anonKey } = config();
  const token = await accessToken();
  const res = await fetch(`${url}${pathAndQuery}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    // Internet travada não pode deixar a sincronização presa para sempre
    signal: AbortSignal.timeout(raw ? 120000 : 45000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Banco online respondeu ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

async function loadProfile() {
  const s = session();
  const res = await api(`/rest/v1/profiles?select=role,church&user_id=eq.${s.userId}`);
  const rows = await res.json();
  const profile = rows[0] || { role: 'reader', church: null };
  saveSession({ ...session(), role: profile.role, church: profile.church });
}

async function login(email, password) {
  if (!isConfigured()) throw new Error('Banco online não configurado.');
  const data = await authRequest('password', { email: String(email || '').trim(), password: String(password || '') });
  saveSession(sessionFrom(data));
  await loadProfile();
  // Sessão nova: busca a biblioteca inteira de novo
  db.setSetting('cloudCursors', {});
  setStatus({ state: 'idle', message: 'Conectado.', lastError: null });
  syncNow();
  return publicStatus();
}

function logout() {
  saveSession(null);
  setStatus({ state: 'off', message: 'Banco online não conectado.', lastError: null });
  return publicStatus();
}

function setConfig({ url, anonKey }) {
  const clean = { url: String(url || '').trim().replace(/\/+$/, ''), anonKey: String(anonKey || '').trim() };
  db.setSetting('cloudConfig', clean);
  logout();
  return publicStatus();
}

// ---------- Baixar (pull) ----------

const cursors = () => db.getSetting('cloudCursors', {});
function saveCursor(table, value) {
  db.setSetting('cloudCursors', { ...cursors(), [table]: value });
}

// Lê em páginas tudo o que mudou desde a última vez
async function pullTable(table, key, apply) {
  const since = cursors()[table];
  const from = since ? new Date(new Date(since).getTime() - OVERLAP_MS).toISOString() : null;
  let offset = 0;
  let newest = since || null;
  let changed = 0;
  for (;;) {
    const filter = from ? `&updated_at=gt.${encodeURIComponent(from)}` : '';
    const res = await api(`/rest/v1/${table}?select=*${filter}&order=updated_at.asc,${key}.asc&limit=${PAGE}&offset=${offset}`);
    const rows = await res.json();
    for (const row of rows) {
      if (await apply(row)) changed++;
      if (!newest || row.updated_at > newest) newest = row.updated_at;
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  if (newest) saveCursor(table, newest);
  return changed;
}

const isEditor = () => (session() || {}).role === 'editor';

async function pullSermons() {
  return pullTable('library_sermons', 'id', async (row) => {
    // Editor com alteração ainda não enviada: a dele vence (vai ser enviada em seguida)
    if (isEditor() && db.isSermonDirty(row.id)) return false;
    if (row.deleted) return db.deleteSermon(row.id, { fromSync: true });
    db.saveSermon({ id: row.id, title: row.title, date: row.date, paragraphs: row.paragraphs || [] }, { fromSync: true, remoteUpdatedAt: row.updated_at });
    return true;
  });
}

async function pullHymns() {
  const changed = await pullTable('library_hymns', 'uid', async (row) => hymns.applyRemoteHymn(row, { keepLocalChanges: isEditor() }));
  if (changed) hymns.invalidateIndex();
  return changed;
}

const bgSync = {
  get: db.connection.prepare('SELECT size, dirty FROM background_sync WHERE name = ?'),
  set: db.connection.prepare(`INSERT INTO background_sync (name, size, dirty, remote_updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET size = excluded.size, dirty = excluded.dirty, remote_updated_at = excluded.remote_updated_at`),
  remove: db.connection.prepare('DELETE FROM background_sync WHERE name = ?')
};

async function pullBackgrounds() {
  return pullTable('library_backgrounds', 'name', async (row) => {
    const file = path.join(backgrounds.DIR, row.name);
    const local = bgSync.get.get(row.name);
    if (row.deleted) {
      if (isEditor() && local && local.dirty) return false;
      bgSync.remove.run(row.name);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        return true;
      }
      return false;
    }
    if (fs.existsSync(file) && fs.statSync(file).size === Number(row.size)) {
      bgSync.set.run(row.name, row.size, 0, row.updated_at);
      return false;
    }
    const res = await api(`/storage/v1/object/authenticated/backgrounds/${encodeURIComponent(row.name)}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    bgSync.set.run(row.name, row.size, 0, row.updated_at);
    return true;
  });
}

// ---------- Enviar (push, só editor) ----------

// Envia em lotes; o servidor devolve a hora oficial de cada item
async function upsert(table, rows, key) {
  const done = [];
  for (let i = 0; i < rows.length; i += 200) {
    const res = await api(`/rest/v1/${table}?on_conflict=${key}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: rows.slice(i, i + 200)
    });
    done.push(...await res.json());
  }
  return done;
}

const inList = (keys) => `in.(${keys.map(k => `"${String(k).replace(/"/g, '\\"')}"`).join(',')})`;

async function pushDeletions(kind, table, key) {
  const keys = db.pendingDeletions(kind);
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    await api(`/rest/v1/${table}?${key}=${encodeURIComponent(inList(chunk))}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: { deleted: true }
    });
    chunk.forEach(k => db.clearDeletion(kind, k));
  }
  return keys.length;
}

async function pushSermons() {
  const rows = db.dirtySermons().map(s => ({ id: s.id, title: s.title, date: s.date, paragraphs: s.paragraphs, deleted: false }));
  if (rows.length) (await upsert('library_sermons', rows, 'id')).forEach(r => db.markSermonSynced(r.id, r.updated_at));
  return rows.length + await pushDeletions('sermon', 'library_sermons', 'id');
}

async function pushHymns() {
  const rows = hymns.dirtyHymns().map(h => ({ ...h, deleted: false }));
  if (rows.length) (await upsert('library_hymns', rows, 'uid')).forEach(r => hymns.markHymnSynced(r.uid, r.updated_at));
  return rows.length + await pushDeletions('hymn', 'library_hymns', 'uid');
}

async function pushBackgrounds() {
  let sent = 0;
  for (const { name } of backgrounds.list()) {
    const file = path.join(backgrounds.DIR, name);
    const size = fs.statSync(file).size;
    const state = bgSync.get.get(name);
    if (state && !state.dirty && Number(state.size) === size) continue;
    const ext = path.extname(name).slice(1).toLowerCase();
    await api(`/storage/v1/object/backgrounds/${encodeURIComponent(name)}`, {
      method: 'POST',
      raw: true,
      headers: { 'Content-Type': ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', 'x-upsert': 'true' },
      body: fs.readFileSync(file)
    });
    const [row] = await upsert('library_backgrounds', [{ name, size, deleted: false }], 'name');
    bgSync.set.run(name, size, 0, row.updated_at);
    sent++;
  }
  const deleted = db.pendingDeletions('background');
  for (const name of deleted) {
    await api(`/storage/v1/object/backgrounds/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
  }
  return sent + await pushDeletions('background', 'library_backgrounds', 'name');
}

// ---------- Ciclo ----------

async function runSync() {
  if (!isConfigured() || !session()) {
    setStatus({ state: 'off', message: isConfigured() ? 'Banco online não conectado.' : 'Banco online não configurado.' });
    return { changed: {} };
  }
  setStatus({ state: 'syncing', message: 'Sincronizando...' });
  try {
    await loadProfile(); // o papel pode ter mudado no painel do Supabase
    const changed = {
      sermons: await pullSermons(),
      hymns: await pullHymns(),
      backgrounds: await pullBackgrounds()
    };
    let sent = 0;
    if (isEditor()) sent = await pushSermons() + await pushHymns() + await pushBackgrounds();
    const parts = [];
    if (changed.sermons || changed.hymns || changed.backgrounds) parts.push(`recebidas ${changed.sermons + changed.hymns + changed.backgrounds} alterações`);
    if (sent) parts.push(`enviadas ${sent}`);
    setStatus({ state: 'ok', lastSync: new Date().toISOString(), lastError: null, message: parts.length ? `Sincronizado: ${parts.join(', ')}.` : 'Tudo sincronizado.' });
    if (changed.sermons || changed.hymns || changed.backgrounds) changedListener(changed);
    return { changed };
  } catch (err) {
    const offline = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|aborted|timeout/i.test(`${err.name} ${err.message}`);
    setStatus({ state: 'error', lastError: err.message, message: offline ? 'Sem internet: tentando de novo em 1 minuto.' : err.message });
    return { changed: {}, error: err };
  }
}

// Evita duas sincronizações ao mesmo tempo
function syncNow() {
  if (!running) running = runSync().finally(() => { running = null; });
  return running;
}

// Depois de uma alteração local, espera um pouco (o operador pode estar importando vários)
function syncSoon() {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(syncNow, 4000);
}

// onStatus: avisa o painel; onChanged: avisa que a biblioteca local mudou (recarregar listas)
function start({ onStatus, onChanged }) {
  listener = onStatus || listener;
  changedListener = onChanged || changedListener;
  db.syncEvents.on('changed', () => { if (isEditor()) syncSoon(); });
  setTimeout(syncNow, 3000);
  timer = setInterval(syncNow, INTERVAL_MS);
}

function stop() {
  clearInterval(timer);
  clearTimeout(soonTimer);
}

module.exports = { start, stop, syncNow, login, logout, setConfig, status: publicStatus };

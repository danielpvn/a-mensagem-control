// Banco de dados local (SQLite embutido no Node/Electron, sem módulos nativos para compilar).
// Fica em Documentos/A Mensagem Control/data/amc.db. Os JSON antigos de data/sermons são
// importados uma única vez e mantidos na pasta como backup.
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { DatabaseSync } = require('node:sqlite');
const { processSermonParagraphs } = require('./sermon-text');

function resolveDataDir() {
  if (process.env.AMC_DATA_DIR) return process.env.AMC_DATA_DIR;
  try {
    // Fora do Electron, require('electron') devolve só o caminho do binário (sem `app`)
    const { app } = require('electron');
    if (app && app.getPath) {
      return path.join(app.getPath('documents'), 'A Mensagem Control', 'data');
    }
  } catch (e) {
    // Não está no Electron
  }
  return path.join(process.cwd(), 'data');
}

const DATA_DIR = resolveDataDir();
const LEGACY_SERMONS_DIR = path.join(DATA_DIR, 'sermons');
const BUNDLED_SAMPLE = path.join(__dirname, '..', 'data', 'sermons', '62-1014m_a_estatura_de_um_homem_perfeito.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'amc.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS sermons (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sermon_paragraphs (
    sermon_id TEXT NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    number TEXT,
    text TEXT NOT NULL,
    PRIMARY KEY (sermon_id, position)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Onde a leitura parou em cada mensagem (o pastor lê um pouco toda sexta)
  CREATE TABLE IF NOT EXISTS reading_progress (
    sermon_id TEXT PRIMARY KEY REFERENCES sermons(id) ON DELETE CASCADE,
    paragraph_index INTEGER NOT NULL,
    paragraph_number TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------- Controle de sincronização com o banco online ----------
// Itens novos/alterados aqui ficam com dirty = 1 (sermons, hymns, background_sync).
// Exclusões ficam em sync_deletions, para os outros computadores apagarem também.
// O motor de sincronização (sync.js) escuta syncEvents 'changed' para enviar logo.
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_deletions (
    kind TEXT NOT NULL,            -- 'sermon', 'hymn' ou 'background'
    key TEXT NOT NULL,             -- id da mensagem, uid do hino ou nome do arquivo
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (kind, key)
  );

  CREATE TABLE IF NOT EXISTS background_sync (
    name TEXT PRIMARY KEY,
    size INTEGER,
    dirty INTEGER NOT NULL DEFAULT 1,
    remote_updated_at TEXT
  );
`);

// Acrescenta uma coluna em tabelas antigas (o SQLite não tem "ADD COLUMN IF NOT EXISTS")
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// O que já existia antes do banco online entra como pendente (o editor envia na 1ª vez)
ensureColumn('sermons', 'dirty', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('sermons', 'remote_updated_at', 'TEXT');

const syncEvents = new EventEmitter();
const syncStmt = {
  addDeletion: db.prepare(`INSERT INTO sync_deletions (kind, key) VALUES (?, ?)
    ON CONFLICT(kind, key) DO UPDATE SET created_at = datetime('now')`),
  removeDeletion: db.prepare('DELETE FROM sync_deletions WHERE kind = ? AND key = ?'),
  listDeletions: db.prepare('SELECT key FROM sync_deletions WHERE kind = ?')
};

function notifyChange(kind) {
  syncEvents.emit('changed', kind);
}

// Apagou aqui: avisa os outros computadores (se recriar com a mesma chave, o aviso some)
function recordDeletion(kind, key) {
  syncStmt.addDeletion.run(kind, key);
  notifyChange(kind);
}

function clearDeletion(kind, key) {
  syncStmt.removeDeletion.run(kind, key);
}

const pendingDeletions = (kind) => syncStmt.listDeletions.all(kind).map(r => r.key);

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Números de parágrafo são guardados como texto ("54" ou "54 (1/3)"); números puros voltam como Number
function toParagraphNumber(value) {
  if (value === null || value === undefined) return null;
  return /^\d+$/.test(value) ? Number(value) : value;
}

const stmt = {
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  listSermons: db.prepare(`
    SELECT s.id, s.title, s.date, s.created_at,
           (SELECT COUNT(*) FROM sermon_paragraphs p WHERE p.sermon_id = s.id) AS rawCount,
           r.paragraph_index AS progressIndex, r.paragraph_number AS progressNumber, r.updated_at AS progressAt
    FROM sermons s
    LEFT JOIN reading_progress r ON r.sermon_id = s.id
    ORDER BY COALESCE(r.updated_at, s.created_at) DESC
  `),
  getSermon: db.prepare('SELECT id, title, date FROM sermons WHERE id = ?'),
  getParagraphs: db.prepare('SELECT number, text FROM sermon_paragraphs WHERE sermon_id = ? ORDER BY position'),
  upsertSermon: db.prepare(`
    INSERT INTO sermons (id, title, date, dirty, remote_updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, date = excluded.date, updated_at = datetime('now'),
      dirty = excluded.dirty, remote_updated_at = COALESCE(excluded.remote_updated_at, sermons.remote_updated_at)
  `),
  dirtySermons: db.prepare('SELECT id, title, date FROM sermons WHERE dirty = 1'),
  sermonState: db.prepare('SELECT dirty, remote_updated_at AS remoteUpdatedAt FROM sermons WHERE id = ?'),
  markSermonSynced: db.prepare('UPDATE sermons SET dirty = 0, remote_updated_at = ? WHERE id = ?'),
  countDirtySermons: db.prepare('SELECT COUNT(*) AS n FROM sermons WHERE dirty = 1'),
  deleteParagraphs: db.prepare('DELETE FROM sermon_paragraphs WHERE sermon_id = ?'),
  insertParagraph: db.prepare('INSERT INTO sermon_paragraphs (sermon_id, position, number, text) VALUES (?, ?, ?, ?)'),
  deleteSermon: db.prepare('DELETE FROM sermons WHERE id = ?'),
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  getProgress: db.prepare('SELECT paragraph_index AS paragraphIndex, paragraph_number AS paragraphNumber, updated_at AS updatedAt FROM reading_progress WHERE sermon_id = ?'),
  setProgress: db.prepare(`
    INSERT INTO reading_progress (sermon_id, paragraph_index, paragraph_number, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(sermon_id) DO UPDATE SET paragraph_index = excluded.paragraph_index,
      paragraph_number = excluded.paragraph_number, updated_at = excluded.updated_at
  `)
};

// Salva já dividido em partes de ~150 caracteres, para a contagem da biblioteca bater com a tela.
// fromSync: veio do banco online (não marca como pendente nem avisa para enviar de novo).
function saveSermon({ id, title, date, paragraphs }, { fromSync = false, remoteUpdatedAt = null } = {}) {
  transaction(() => {
    stmt.upsertSermon.run(id, title, date || 'Data desconhecida', fromSync ? 0 : 1, remoteUpdatedAt);
    stmt.deleteParagraphs.run(id);
    processSermonParagraphs(paragraphs).forEach((p, idx) => {
      const number = p.number === null || p.number === undefined ? null : String(p.number);
      stmt.insertParagraph.run(id, idx, number, p.text || '');
    });
  });
  if (!fromSync) {
    clearDeletion('sermon', id);
    notifyChange('sermon');
  }
}

function listSermons() {
  return stmt.listSermons.all().map(row => ({
    id: row.id,
    title: row.title,
    date: row.date,
    paragraphCount: row.rawCount,
    progress: row.progressIndex === null ? null : {
      paragraphIndex: row.progressIndex,
      paragraphNumber: toParagraphNumber(row.progressNumber),
      updatedAt: row.progressAt
    }
  }));
}

// Retorna o sermão já paginado (parágrafos longos divididos), pronto para exibir
function getSermon(id) {
  const sermon = stmt.getSermon.get(id);
  if (!sermon) return null;
  const raw = stmt.getParagraphs.all(id).map(p => ({ number: toParagraphNumber(p.number), text: p.text }));
  const progress = stmt.getProgress.get(id) || null;
  if (progress) progress.paragraphNumber = toParagraphNumber(progress.paragraphNumber);
  return { id: sermon.id, title: sermon.title, date: sermon.date, paragraphs: processSermonParagraphs(raw), progress };
}

function deleteSermon(id, { fromSync = false } = {}) {
  const removed = stmt.deleteSermon.run(id).changes > 0;
  if (removed && !fromSync) recordDeletion('sermon', id);
  return removed;
}

// Para o envio ao banco online: parágrafos como estão guardados (já divididos)
function dirtySermons() {
  return stmt.dirtySermons.all().map(s => ({
    id: s.id,
    title: s.title,
    date: s.date,
    paragraphs: stmt.getParagraphs.all(s.id).map(p => ({ number: toParagraphNumber(p.number), text: p.text }))
  }));
}

const isSermonDirty = (id) => {
  const row = stmt.sermonState.get(id);
  return !!(row && row.dirty);
};
// Versão do banco online que este computador já tem (para não aplicar a mesma de novo)
const sermonRemoteVersion = (id) => {
  const row = stmt.sermonState.get(id);
  return row ? row.remoteUpdatedAt : null;
};
const markSermonSynced = (id, remoteUpdatedAt) => stmt.markSermonSynced.run(remoteUpdatedAt, id);
const countDirtySermons = () => stmt.countDirtySermons.get().n;

function getSetting(key, fallback) {
  const row = stmt.getSetting.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch (e) {
    return fallback;
  }
}

function setSetting(key, value) {
  stmt.setSetting.run(key, JSON.stringify(value));
}

function saveProgress(sermonId, paragraphIndex, paragraphNumber) {
  const number = paragraphNumber === null || paragraphNumber === undefined ? null : String(paragraphNumber);
  stmt.setProgress.run(sermonId, paragraphIndex, number);
}

function importJsonFile(filePath) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!json.id || !json.title) return false;
  saveSermon({ id: String(json.id), title: json.title, date: json.date, paragraphs: json.paragraphs || [] });
  return true;
}

// Primeira execução: traz os sermões que estavam em JSON (versões até 1.0.3)
function migrateLegacyJson() {
  if (stmt.getMeta.get('legacy_json_imported')) return;

  let imported = 0;
  if (fs.existsSync(LEGACY_SERMONS_DIR)) {
    fs.readdirSync(LEGACY_SERMONS_DIR)
      .filter(f => f.endsWith('.json'))
      .forEach(f => {
        try {
          if (importJsonFile(path.join(LEGACY_SERMONS_DIR, f))) imported++;
        } catch (err) {
          console.error(`Não foi possível importar ${f}:`, err.message);
        }
      });
  }

  // Banco vazio: coloca o sermão de exemplo para o operador ver como funciona
  if (imported === 0 && listSermons().length === 0 && fs.existsSync(BUNDLED_SAMPLE)) {
    importJsonFile(BUNDLED_SAMPLE);
  }

  stmt.setMeta.run('legacy_json_imported', new Date().toISOString());
  console.log(`Migração dos JSON concluída: ${imported} mensagens importadas.`);
}

migrateLegacyJson();

module.exports = {
  connection: db,
  transaction,
  ensureColumn,
  syncEvents,
  notifyChange,
  recordDeletion,
  clearDeletion,
  pendingDeletions,
  dirtySermons,
  isSermonDirty,
  sermonRemoteVersion,
  markSermonSynced,
  countDirtySermons,
  DATA_DIR,
  listSermons,
  getSermon,
  saveSermon,
  deleteSermon,
  getSetting,
  setSetting,
  saveProgress
};

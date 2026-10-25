// Hinos: banco de dados e busca por qualquer trecho da letra.
// A busca roda em memória (alguns milhares de linhas são lidas em milissegundos) e tolera
// acentos, palavras fora de ordem, palavra pela metade e pequenos erros de digitação.
const crypto = require('crypto');
const { connection: db, transaction, ensureColumn, notifyChange, recordDeletion, clearDeletion } = require('./db');
const { parseLyrics, sectionsToLyrics, buildSlides, sectionLines } = require('../public/js/shared/hymn-text.js');

db.exec(`
  CREATE TABLE IF NOT EXISTS hymns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    title TEXT NOT NULL,
    collection TEXT,
    auto_chorus INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hymn_sections (
    hymn_id INTEGER NOT NULL REFERENCES hymns(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    label TEXT,
    text TEXT NOT NULL,
    PRIMARY KEY (hymn_id, position)
  );
`);

// Banco online: cada hino tem um identificador global (uid) e fica pendente (dirty) até ser enviado
ensureColumn('hymns', 'uid', 'TEXT');
ensureColumn('hymns', 'dirty', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('hymns', 'remote_updated_at', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS hymns_uid ON hymns (uid)');

const stmt = {
  list: db.prepare('SELECT id, number, title, collection FROM hymns'),
  get: db.prepare('SELECT id, number, title, collection, auto_chorus AS autoChorus FROM hymns WHERE id = ?'),
  sections: db.prepare('SELECT kind, label, text FROM hymn_sections WHERE hymn_id = ? ORDER BY position'),
  allSections: db.prepare('SELECT hymn_id AS hymnId, position, kind, label, text FROM hymn_sections ORDER BY hymn_id, position'),
  insert: db.prepare('INSERT INTO hymns (number, title, collection, auto_chorus) VALUES (?, ?, ?, ?)'),
  update: db.prepare(`UPDATE hymns SET number = ?, title = ?, collection = ?, auto_chorus = ?, updated_at = datetime('now') WHERE id = ?`),
  remove: db.prepare('DELETE FROM hymns WHERE id = ?'),
  clearSections: db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?'),
  insertSection: db.prepare('INSERT INTO hymn_sections (hymn_id, position, kind, label, text) VALUES (?, ?, ?, ?, ?)'),
  findDuplicate: db.prepare(`SELECT id FROM hymns WHERE lower(title) = lower(?) AND IFNULL(number, '') = IFNULL(?, '') AND IFNULL(collection, '') = IFNULL(?, '')`),
  categories: db.prepare('SELECT collection AS name, COUNT(*) AS count FROM hymns GROUP BY collection ORDER BY collection'),
  withoutUid: db.prepare('SELECT id, number, title, collection FROM hymns WHERE uid IS NULL'),
  setUid: db.prepare('UPDATE hymns SET uid = ? WHERE id = ?'),
  insertWithUid: db.prepare('INSERT INTO hymns (number, title, collection, auto_chorus, uid, dirty, remote_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  byUid: db.prepare('SELECT id, dirty, remote_updated_at AS remoteUpdatedAt FROM hymns WHERE uid = ?'),
  uidOf: db.prepare('SELECT uid FROM hymns WHERE id = ?'),
  markDirty: db.prepare('UPDATE hymns SET dirty = 1 WHERE id = ?'),
  updateFromSync: db.prepare(`UPDATE hymns SET number = ?, title = ?, collection = ?, auto_chorus = ?, dirty = 0, remote_updated_at = ?, updated_at = datetime('now') WHERE id = ?`),
  dirtyHymns: db.prepare('SELECT id, uid, number, title, collection, auto_chorus AS autoChorus FROM hymns WHERE dirty = 1'),
  markSynced: db.prepare('UPDATE hymns SET dirty = 0, remote_updated_at = ? WHERE uid = ?'),
  countDirty: db.prepare('SELECT COUNT(*) AS n FROM hymns WHERE dirty = 1')
};

// ---------- Texto normalizado ----------

function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokenize = (text) => normalize(text).split(' ').filter(Boolean);

// "001" e "1" são o mesmo hino
const cleanNumber = (value) => {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? String(parseInt(text, 10)) : text;
};

// A categoria "Diversos" inclui as subpastas ("Diversos / Salmos e Hinos")
const inCategory = (hymn, category) => !category || hymn.collection === category || String(hymn.collection || '').startsWith(`${category} / `);

// Ordena números de hino de forma natural (2 antes de 10); sem número vai para o fim
function compareHymns(a, b) {
  const na = parseInt(a.number, 10);
  const nb = parseInt(b.number, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  if (isNaN(na) !== isNaN(nb)) return isNaN(na) ? 1 : -1;
  return a.title.localeCompare(b.title, 'pt-BR');
}

// ---------- Índice de busca ----------

let index = null;
let vocabulary = new Set();

function buildIndex() {
  const hymns = new Map(stmt.list.all().map(h => [h.id, {
    id: h.id,
    number: h.number,
    title: h.title,
    collection: h.collection,
    titleTokens: tokenize(h.title),
    windows: []
  }]));

  // Cada "janela" é uma linha + a seguinte da mesma seção: o obreiro canta frases que atravessam linhas
  stmt.allSections.all().forEach(section => {
    const hymn = hymns.get(section.hymnId);
    if (!hymn) return;
    // Mesma numeração de linhas das telas (sem as linhas em branco que separam telas)
    const lines = sectionLines(section.text);
    lines.forEach((line, lineIndex) => {
      const text = lineIndex + 1 < lines.length ? `${line} ${lines[lineIndex + 1]}` : line;
      const tokens = tokenize(text);
      const lineTokens = tokenize(line);
      hymn.windows.push({
        sectionIndex: section.position,
        kind: section.kind,
        label: section.label,
        lineIndex,
        line,
        joined: tokens.join(' '),
        tokens,
        lineJoined: lineTokens.join(' '),
        lineTokens
      });
    });
  });

  index = [...hymns.values()];
  vocabulary = new Set();
  index.forEach(hymn => {
    hymn.titleTokens.forEach(t => vocabulary.add(t));
    hymn.windows.forEach(w => w.lineTokens.forEach(t => vocabulary.add(t)));
  });
}

function invalidateIndex() {
  index = null;
}

// Distância de edição com limite; troca de duas letras vizinhas ("aurroa") conta como 1 erro
function withinDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      row[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return false;
    rows.push(row);
  }
  return rows[a.length][b.length] <= max;
}

// Quanto uma palavra digitada combina com uma palavra da letra (0 a 1)
function tokenScore(queryToken, token) {
  if (queryToken === token) return 1;
  // Palavra pela metade: quem digita rápido escreve "sub" para "subindo"
  if (queryToken.length >= 3 && token.startsWith(queryToken)) return 0.85;
  if (queryToken.length >= 4 && withinDistance(queryToken, token, queryToken.length >= 7 ? 2 : 1)) return 0.7;
  return 0;
}

// Palavras curtas ("e", "o", "de") pesam pouco: quase todo hino tem
const weightOf = (token) => (token.length <= 2 ? 0.3 : 1);

// Compara cada palavra digitada com o vocabulário inteiro uma vez só; depois cada trecho
// só consulta essa tabela (é o que deixa a busca instantânea enquanto se digita)
function buildScoreTables(queryTokens) {
  return queryTokens.map(q => {
    const table = new Map();
    vocabulary.forEach(token => {
      const score = tokenScore(q, token);
      if (score > 0) table.set(token, score);
    });
    return { weight: weightOf(q), table };
  });
}

function matchScore(tables, tokens) {
  let total = 0;
  let got = 0;
  tables.forEach(({ weight, table }) => {
    let best = 0;
    for (const token of tokens) {
      const score = table.get(token);
      if (score && score > best) {
        best = score;
        if (best === 1) break;
      }
    }
    total += weight;
    got += weight * best;
  });
  return total ? got / total : 0;
}

function search(query, limit = 12, category = null) {
  if (!index) buildIndex();
  const raw = String(query || '').trim();
  if (!raw) return [];

  const queryTokens = tokenize(raw);
  const phrase = queryTokens.join(' ');
  const onlyNumber = /^\d+$/.test(raw);
  const wantedNumber = cleanNumber(raw);
  const tables = buildScoreTables(queryTokens);
  const minimum = queryTokens.length >= 3 ? 0.6 : 0.5;
  const results = [];

  index.forEach(hymn => {
    if (!inCategory(hymn, category)) return;
    let score = 0;
    let match = null;

    if (onlyNumber && hymn.number !== null && cleanNumber(hymn.number) === wantedNumber) score = 2;
    else if (onlyNumber && hymn.number && cleanNumber(hymn.number).startsWith(wantedNumber)) score = 1.2;

    if (tables.length) {
      const titleBonus = phrase && normalize(hymn.title).includes(phrase) ? 0.3 : 0;
      score = Math.max(score, matchScore(tables, hymn.titleTokens) * 0.95 + titleBonus);
    }

    hymn.windows.forEach(win => {
      // Uma linha sozinha ganha de leve da janela de duas linhas, para mostrar a linha certa
      const lineScore = matchScore(tables, win.lineTokens) + (phrase.length >= 4 && win.lineJoined.includes(phrase) ? 0.3 : 0) + 0.01;
      const windowScore = matchScore(tables, win.tokens) + (phrase.length >= 4 && win.joined.includes(phrase) ? 0.3 : 0);
      const s = Math.max(lineScore, windowScore);
      if (s > score) {
        score = s;
        match = win;
      }
    });

    if (score >= minimum) {
      results.push({
        id: hymn.id,
        number: hymn.number,
        title: hymn.title,
        collection: hymn.collection,
        score: Math.round(score * 100) / 100,
        match: match ? {
          sectionIndex: match.sectionIndex,
          kind: match.kind,
          label: match.label,
          lineIndex: match.lineIndex,
          line: match.line
        } : null
      });
    }
  });

  return results
    .sort((a, b) => b.score - a.score || compareHymns(a, b))
    .slice(0, limit);
}

// ---------- Identificador global ----------

// O mesmo hino importado da mesma pasta em igrejas diferentes ganha o mesmo uid
// (categoria + número + título), para não duplicar quando os dois sincronizam.
function makeUid({ collection, number, title }) {
  const key = [normalize(collection), cleanNumber(number), normalize(title)].join('|');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
}

// Hinos de antes do banco online ganham o uid uma vez
function backfillUids() {
  const rows = stmt.withoutUid.all();
  if (rows.length === 0) return;
  transaction(() => {
    rows.forEach(h => {
      let uid = makeUid(h);
      // Dois hinos idênticos (mesma categoria, número e título): o segundo ganha sufixo
      for (let i = 2; stmt.byUid.get(uid); i++) uid = `${makeUid(h)}-${i}`;
      stmt.setUid.run(uid, h.id);
    });
  });
}
backfillUids();

function freeUid(data) {
  let uid = makeUid(data);
  for (let i = 2; stmt.byUid.get(uid); i++) uid = `${makeUid(data)}-${i}`;
  return uid;
}

// ---------- CRUD ----------

function listHymns(category = null) {
  return stmt.list.all().filter(h => inCategory(h, category)).sort(compareHymns);
}

function listCategories() {
  return stmt.categories.all().map(c => ({ name: c.name, count: c.count }));
}

function getHymn(id) {
  const hymn = stmt.get.get(id);
  if (!hymn) return null;
  const sections = stmt.sections.all(id).map(s => ({ kind: s.kind, label: s.label, text: s.text }));
  return { ...hymn, autoChorus: hymn.autoChorus === 1, sections, lyrics: sectionsToLyrics(sections) };
}

function getHymnSlides(id, linesPerSlide) {
  const hymn = getHymn(id);
  if (!hymn) return null;
  return { ...hymn, slides: buildSlides(hymn.sections, { autoChorus: hymn.autoChorus, linesPerSlide }) };
}

function cleanInput({ number, title, collection, autoChorus, lyrics }) {
  const sections = parseLyrics(lyrics);
  if (!String(title || '').trim()) throw new Error('O hino precisa de um título.');
  if (sections.length === 0) throw new Error('A letra do hino está vazia.');
  return {
    number: cleanNumber(number) || null,
    title: String(title).trim(),
    collection: String(collection ?? '').trim() || null,
    autoChorus: autoChorus === false ? 0 : 1,
    sections
  };
}

function writeSections(id, sections) {
  stmt.clearSections.run(id);
  sections.forEach((s, position) => stmt.insertSection.run(id, position, s.kind, s.label, s.text));
}

function createHymn(input) {
  const data = cleanInput(input);
  const uid = freeUid(data);
  const id = transaction(() => {
    const newId = Number(stmt.insertWithUid.run(data.number, data.title, data.collection, data.autoChorus, uid, 1, null).lastInsertRowid);
    writeSections(newId, data.sections);
    return newId;
  });
  clearDeletion('hymn', uid);
  invalidateIndex();
  notifyChange('hymn');
  return id;
}

function updateHymn(id, input) {
  const data = cleanInput(input);
  const changed = transaction(() => {
    const result = stmt.update.run(data.number, data.title, data.collection, data.autoChorus, id);
    if (result.changes > 0) {
      writeSections(id, data.sections);
      stmt.markDirty.run(id);
    }
    return result.changes > 0;
  });
  invalidateIndex();
  if (changed) notifyChange('hymn');
  return changed;
}

function deleteHymn(id) {
  const row = stmt.uidOf.get(id);
  const removed = stmt.remove.run(id).changes > 0;
  invalidateIndex();
  if (removed && row && row.uid) recordDeletion('hymn', row.uid);
  return removed;
}

// Importação em lote: pula hinos que já existem (mesmo número e título)
function importHymns(list) {
  let created = 0;
  let skipped = 0;
  const errors = [];
  transaction(() => {
    list.forEach((item, i) => {
      try {
        const data = cleanInput(item);
        if (stmt.findDuplicate.get(data.title, data.number, data.collection)) {
          skipped++;
          return;
        }
        const uid = freeUid(data);
        const id = Number(stmt.insertWithUid.run(data.number, data.title, data.collection, data.autoChorus, uid, 1, null).lastInsertRowid);
        writeSections(id, data.sections);
        clearDeletion('hymn', uid);
        created++;
      } catch (err) {
        errors.push(`${item.title || `Item ${i + 1}`}: ${err.message}`);
      }
    });
  });
  invalidateIndex();
  if (created) notifyChange('hymn');
  return { created, skipped, errors };
}

// ---------- Banco online ----------

// Pendentes de envio, já no formato da tabela library_hymns
function dirtyHymns() {
  return stmt.dirtyHymns.all().map(h => ({
    uid: h.uid,
    number: h.number,
    title: h.title,
    collection: h.collection,
    auto_chorus: h.autoChorus === 1,
    lyrics: sectionsToLyrics(stmt.sections.all(h.id))
  }));
}

const markHymnSynced = (uid, remoteUpdatedAt) => stmt.markSynced.run(remoteUpdatedAt, uid);
const countDirtyHymns = () => stmt.countDirty.get().n;

// Aplica um hino que veio do banco online. keepLocalChanges: editor com alteração local
// ainda não enviada (a dele vence e será enviada); leitor sempre recebe a versão online.
function applyRemoteHymn(row, { keepLocalChanges }) {
  const local = stmt.byUid.get(row.uid);
  // Já tem exatamente esta versão (ex: o próprio editor acabou de enviar): nada a fazer
  if (local && local.remoteUpdatedAt === row.updated_at) return false;
  if (row.deleted) {
    if (local && !(keepLocalChanges && local.dirty)) {
      stmt.remove.run(local.id);
      return true;
    }
    return false;
  }
  if (local && keepLocalChanges && local.dirty) return false;
  const sections = parseLyrics(row.lyrics);
  if (sections.length === 0) return false;
  const number = cleanNumber(row.number) || null;
  transaction(() => {
    if (local) {
      stmt.updateFromSync.run(number, row.title, row.collection || null, row.auto_chorus ? 1 : 0, row.updated_at, local.id);
      writeSections(local.id, sections);
    } else {
      const id = Number(stmt.insertWithUid.run(number, row.title, row.collection || null, row.auto_chorus ? 1 : 0, row.uid, 0, row.updated_at).lastInsertRowid);
      writeSections(id, sections);
    }
  });
  return true;
}

module.exports = {
  invalidateIndex,
  dirtyHymns,
  markHymnSynced,
  countDirtyHymns,
  applyRemoteHymn,
  search,
  listHymns,
  listCategories,
  getHymn,
  getHymnSlides,
  createHymn,
  updateHymn,
  deleteHymn,
  importHymns
};

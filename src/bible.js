// Bíblia ACF: banco local, importação da pasta da igreja, capítulos e busca.
// O texto NÃO vai no repositório (é público e a ACF tem direitos da SBTB). Chega de dois jeitos:
// pelo banco online (só igrejas aprovadas; o editor que importou envia) ou importando a pasta
// "2 Biblia_ACF" (automático na primeira vez, se estiver em C:\tf_slides).
const fs = require('fs');
const path = require('path');
const { connection: db, transaction, getSetting, setSetting, notifyChange } = require('./db');
const { books, parseReference } = require('./bible-books');

const DEFAULT_FOLDER = 'C:\\tf_slides\\2 Biblia_ACF';

db.exec(`
  CREATE TABLE IF NOT EXISTS bible_verses (
    id INTEGER PRIMARY KEY,
    book INTEGER NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL,          -- telas separadas por \\n (versículos longos já vêm divididos)
    UNIQUE (book, chapter, verse)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS bible_fts USING fts5(
    text, content='bible_verses', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  );
`);

const stmt = {
  count: db.prepare('SELECT COUNT(*) AS n FROM bible_verses'),
  chapters: db.prepare('SELECT book, MAX(chapter) AS chapters FROM bible_verses GROUP BY book'),
  chapter: db.prepare('SELECT verse, text FROM bible_verses WHERE book = ? AND chapter = ? ORDER BY verse'),
  clear: db.prepare('DELETE FROM bible_verses'),
  insert: db.prepare('INSERT OR REPLACE INTO bible_verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)'),
  clearChapter: db.prepare('DELETE FROM bible_verses WHERE book = ? AND chapter = ?'),
  allVerses: db.prepare('SELECT book, chapter, verse, text FROM bible_verses ORDER BY book, chapter, verse'),
  search: db.prepare(`
    SELECT v.book, v.chapter, v.verse, v.text FROM bible_fts f
    JOIN bible_verses v ON v.id = f.rowid
    WHERE bible_fts MATCH ? ORDER BY bm25(bible_fts) LIMIT ?
  `)
};

let chapterCounts = null;
function getChapterCounts() {
  if (!chapterCounts) {
    chapterCounts = new Map(stmt.chapters.all().map(r => [r.book, r.chapters]));
  }
  return chapterCounts;
}

function verseCount() {
  return stmt.count.get().n;
}

function listBooks() {
  const counts = getChapterCounts();
  return books.map(b => ({ id: b.id, name: b.name, abbrev: b.abbrev, testament: b.testament, chapters: counts.get(b.id) || 0 }));
}

const bookName = (id) => (books[id - 1] ? books[id - 1].name : '');

// ---------- Importação ----------

// Um arquivo de capítulo: "*Gênesis 1*" antes de cada tela e "*21* texto" no começo do versículo.
// Telas sem "*N*" continuam o versículo anterior (versículo longo dividido).
function parseChapterText(text) {
  const verses = [];
  String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line || /^\*[^*]+\s\d+\*$/.test(line)) return;
    const match = line.match(/^\*(\d+)\*\s*(.*)$/);
    if (match) verses.push({ verse: parseInt(match[1], 10), parts: [match[2].trim()] });
    else if (verses.length) verses[verses.length - 1].parts.push(line);
  });
  return verses.map(v => ({ verse: v.verse, text: v.parts.filter(Boolean).join('\n') }));
}

// Caminho relativo -> livro e capítulo: ".../1 Velho Testamento/01 - Gênesis/01.txt"
function locate(relativePath) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  if (parts.length < 3) return null;
  const testament = parts[parts.length - 3];
  const bookFolder = parts[parts.length - 2];
  const chapterFile = parts[parts.length - 1];
  const t = testament.match(/^(\d)/);
  const b = bookFolder.match(/^(\d+)/);
  const c = chapterFile.match(/^(\d+)\.txt$/i);
  if (!t || !b || !c) return null;
  const book = (t[1] === '2' ? 39 : 0) + parseInt(b[1], 10);
  if (book < 1 || book > 66) return null;
  return { book, chapter: parseInt(c[1], 10) };
}

// files: [{ path, text }] (do painel ou lidos do disco). Substitui a Bíblia inteira.
function importBible(files) {
  let chapters = 0;
  let verses = 0;
  const skipped = [];
  const parsed = files.map(f => ({ where: locate(f.path), verses: parseChapterText(f.text), path: f.path }));
  if (!parsed.some(p => p.where && p.verses.length)) throw new Error('Nenhum capítulo reconhecido. Escolha a pasta "2 Biblia_ACF".');

  transaction(() => {
    stmt.clear.run();
    parsed.forEach(p => {
      if (!p.where || p.verses.length === 0) {
        skipped.push(p.path);
        return;
      }
      chapters++;
      p.verses.forEach(v => {
        stmt.insert.run(p.where.book, p.where.chapter, v.verse, v.text);
        verses++;
      });
    });
    db.exec("INSERT INTO bible_fts(bible_fts) VALUES('rebuild')");
  });
  chapterCounts = null;
  // Editor: a Bíblia importada aqui vai para o banco online (as outras igrejas recebem)
  setSetting('bibleCloud', { dirty: true });
  notifyChange('bible');
  return { chapters, verses, skipped: skipped.length };
}

// ---------- Banco online (sync.js) ----------

// Sem marca (Bíblia importada antes do banco online) conta como "ainda não enviada"
const cloudDirty = () => verseCount() > 0 && getSetting('bibleCloud', { dirty: true }).dirty !== false;
const markCloudSynced = () => setSetting('bibleCloud', { dirty: false });

// Capítulos para enviar: [{ id: "livro:capítulo", book, chapter, verses: [{ verse, text }] }]
function chaptersForCloud() {
  const map = new Map();
  for (const v of stmt.allVerses.all()) {
    const id = `${v.book}:${v.chapter}`;
    if (!map.has(id)) map.set(id, { id, book: v.book, chapter: v.chapter, verses: [] });
    map.get(id).verses.push({ verse: v.verse, text: v.text });
  }
  return [...map.values()];
}

// Capítulos que chegaram do banco online (troca só esses); o índice de busca é refeito no fim
function applyCloudChapters(rows) {
  if (rows.length === 0) return 0;
  transaction(() => {
    rows.forEach(row => {
      stmt.clearChapter.run(row.book, row.chapter);
      if (row.deleted) return;
      (row.verses || []).forEach(v => stmt.insert.run(row.book, row.chapter, v.verse, String(v.text || '')));
    });
    db.exec("INSERT INTO bible_fts(bible_fts) VALUES('rebuild')");
  });
  chapterCounts = null;
  markCloudSynced();
  return rows.length;
}

function readFolder(root) {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.txt$/i.test(entry.name)) files.push({ path: path.relative(root, full), text: fs.readFileSync(full, 'utf8') });
    }
  })(root);
  return files;
}

// Primeira vez neste PC: se a pasta da igreja existir, importa sozinho
function autoImport() {
  if (verseCount() > 0 || !fs.existsSync(DEFAULT_FOLDER)) return;
  try {
    const result = importBible(readFolder(DEFAULT_FOLDER));
    console.log(`Bíblia ACF importada de ${DEFAULT_FOLDER}: ${result.verses} versículos.`);
  } catch (err) {
    console.error('Não foi possível importar a Bíblia automaticamente:', err.message);
  }
}

// ---------- Leitura e busca ----------

function getChapter(book, chapter) {
  const verses = stmt.chapter.all(book, chapter).map(v => ({ verse: v.verse, text: v.text }));
  if (verses.length === 0) return null;
  return { book, bookName: bookName(book), chapter, chapters: getChapterCounts().get(book) || chapter, verses };
}

const quote = (t) => `"${t.replace(/"/g, '')}"`;

// Busca por palavras em camadas, da mais exata para a mais solta, sem repetir versículos:
// 1) a frase na ordem digitada (a última palavra pode estar pela metade);
// 2) todas as palavras inteiras ("fé" acha "fé" antes de "fere");
// 3) todas, aceitando palavra pela metade; 4) qualquer uma delas.
function searchWords(allTokens, limit) {
  const tokens = allTokens.filter(t => t.length >= 2);
  if (tokens.length === 0) return [];
  const queries = [
    allTokens.length > 1 ? `${quote(allTokens.join(' '))}*` : null,
    tokens.map(quote).join(' AND '),
    tokens.map(t => `${quote(t)}*`).join(' AND '),
    tokens.length > 1 ? tokens.map(t => `${quote(t)}*`).join(' OR ') : null
  ].filter(Boolean);

  const seen = new Set();
  const rows = [];
  for (const query of queries) {
    for (const row of stmt.search.all(query, limit)) {
      const key = `${row.book}:${row.chapter}:${row.verse}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    if (rows.length >= limit) break;
  }
  return rows.slice(0, limit);
}

// Busca: referência ("jo 3 16") ou palavras ("amou o mundo")
function search(query, limit = 30) {
  const text = String(query || '').trim();
  const result = { reference: null, books: [], results: [] };
  if (!text) return result;

  const ref = parseReference(text);
  if (ref) {
    const counts = getChapterCounts();
    result.books = ref.candidates.slice(0, 8).map(b => ({ id: b.id, name: b.name, abbrev: b.abbrev, chapters: counts.get(b.id) || 0 }));
    const book = ref.book;
    const chapters = counts.get(book.id) || 0;
    if (ref.chapter && ref.chapter <= chapters) {
      const chapter = getChapter(book.id, ref.chapter);
      const lastVerse = chapter.verses[chapter.verses.length - 1].verse;
      const verse = ref.verse && ref.verse <= lastVerse ? ref.verse : null;
      const verseEnd = verse && ref.verseEnd && ref.verseEnd > verse ? Math.min(ref.verseEnd, lastVerse) : null;
      result.reference = {
        book: book.id,
        bookName: book.name,
        chapter: ref.chapter,
        verse,
        verseEnd,
        label: `${book.name} ${ref.chapter}${verse ? `:${verse}${verseEnd ? `-${verseEnd}` : ''}` : ''}`,
        preview: verse ? chapter.verses.find(v => v.verse === verse).text.replace(/\n/g, ' ') : ''
      };
    }
  }

  // Palavras (ignora números soltos de referência)
  const tokens = text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(t => t && !/^\d+$/.test(t));
  if (tokens.length && !(ref && ref.chapter)) {
    result.results = searchWords(tokens, limit).map(r => ({
      book: r.book,
      bookName: bookName(r.book),
      chapter: r.chapter,
      verse: r.verse,
      label: `${bookName(r.book)} ${r.chapter}:${r.verse}`,
      text: r.text.replace(/\n/g, ' ')
    }));
  }
  return result;
}

module.exports = {
  DEFAULT_FOLDER, autoImport, importBible, verseCount, listBooks, getChapter, search, bookName,
  cloudDirty, markCloudSynced, chaptersForCloud, applyCloudChapters
};

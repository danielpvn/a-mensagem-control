// Os 66 livros da Bíblia (ordem da ACF) e o leitor de referências digitadas pelo operador:
// "jo 3 16", "joão 3:16", "1co 13 4-7", "sl 23", "gn1.1", "apoc 22".

// [nome, abreviação, apelidos extras]
const BOOKS = [
  ['Gênesis', 'gn', ['gen']], ['Êxodo', 'ex', ['exo']], ['Levítico', 'lv', ['lev']], ['Números', 'nm', ['num']],
  ['Deuteronômio', 'dt', ['deut']], ['Josué', 'js', ['jos']], ['Juízes', 'jz', ['jui']], ['Rute', 'rt', []],
  ['1 Samuel', '1sm', ['1sam']], ['2 Samuel', '2sm', ['2sam']], ['1 Reis', '1rs', []], ['2 Reis', '2rs', []],
  ['1 Crônicas', '1cr', ['1cro']], ['2 Crônicas', '2cr', ['2cro']], ['Esdras', 'ed', ['esd']], ['Neemias', 'ne', ['nee']],
  ['Ester', 'et', ['est']], ['Jó', 'jó', ['job']], ['Salmos', 'sl', ['salmo', 'sal']], ['Provérbios', 'pv', ['prov', 'pr']],
  ['Eclesiastes', 'ec', ['ecl']], ['Cânticos', 'ct', ['cantares', 'cant', 'cnt']], ['Isaías', 'is', ['isa']],
  ['Jeremias', 'jr', ['jer']], ['Lamentações', 'lm', ['lam']], ['Ezequiel', 'ez', ['eze']], ['Daniel', 'dn', ['dan']],
  ['Oséias', 'os', ['ose']], ['Joel', 'jl', []], ['Amós', 'am', []], ['Obadias', 'ob', ['obd']], ['Jonas', 'jn', ['jon']],
  ['Miquéias', 'mq', ['miq']], ['Naum', 'na', []], ['Habacuque', 'hc', ['hab']], ['Sofonias', 'sf', ['sof']],
  ['Ageu', 'ag', []], ['Zacarias', 'zc', ['zac']], ['Malaquias', 'ml', ['mal']],
  ['Mateus', 'mt', ['mat']], ['Marcos', 'mc', ['mar']], ['Lucas', 'lc', ['luc']], ['João', 'jo', ['joa']],
  ['Atos', 'at', ['atos dos apostolos']], ['Romanos', 'rm', ['rom']], ['1 Coríntios', '1co', ['1cor']],
  ['2 Coríntios', '2co', ['2cor']], ['Gálatas', 'gl', ['gal']], ['Efésios', 'ef', ['efe']], ['Filipenses', 'fp', ['fil']],
  ['Colossenses', 'cl', ['col']], ['1 Tessalonicenses', '1ts', ['1tes']], ['2 Tessalonicenses', '2ts', ['2tes']],
  ['1 Timóteo', '1tm', ['1tim']], ['2 Timóteo', '2tm', ['2tim']], ['Tito', 'tt', ['tit']], ['Filemom', 'fm', ['flm']],
  ['Hebreus', 'hb', ['heb']], ['Tiago', 'tg', ['tia']], ['1 Pedro', '1pe', ['1ped']], ['2 Pedro', '2pe', ['2ped']],
  ['1 João', '1jo', ['1joa']], ['2 João', '2jo', ['2joa']], ['3 João', '3jo', ['3joa']], ['Judas', 'jd', ['jud']],
  ['Apocalipse', 'ap', ['apoc', 'apc']]
];

const normalize = (text) => String(text || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const books = BOOKS.map(([name, abbrev, aliases], i) => ({
  id: i + 1,
  name,
  abbrev,
  testament: i < 39 ? 'VT' : 'NT',
  // Jó sem acento viraria "jo" (= João): ele só é achado por "jó" com acento ou "job"
  keys: name === 'Jó' ? aliases.map(normalize) : [normalize(name), normalize(abbrev), ...aliases.map(normalize)]
}));

// Encontra livros pelo que foi digitado. "jó" (com acento) é Jó; "jo" sem acento é João,
// como nas Bíblias em português.
function findBooks(typed) {
  const raw = String(typed || '').trim().toLowerCase();
  if (!raw) return [];
  if (raw === 'jó' || raw === 'jó') return [books[17]];
  const key = normalize(raw);
  if (!key) return [];
  const exact = books.filter(b => b.keys.includes(key));
  if (exact.length) return exact;
  return books.filter(b => b.keys.some(k => k.startsWith(key)));
}

// "1 co 13 4-7" -> { book, chapter: 13, verse: 4, verseEnd: 7 }
// Devolve null se não parece referência; { candidates } se o livro está incompleto.
function parseReference(input) {
  const text = String(input || '').trim();
  const match = text.match(/^([1-3]?\s*[a-zà-ÿ]+(?:\s+[a-zà-ÿ]+)*)\.?\s*(\d+)?(?:\s*[\s:.,]\s*(\d+))?(?:\s*-\s*(\d+))?\s*$/i);
  if (!match) return null;
  const candidates = findBooks(match[1]);
  if (candidates.length === 0) return null;
  const chapter = match[2] ? parseInt(match[2], 10) : null;
  const verse = match[3] ? parseInt(match[3], 10) : null;
  const verseEnd = match[4] ? parseInt(match[4], 10) : null;
  return { book: candidates[0], candidates, chapter, verse, verseEnd };
}

module.exports = { books, findBooks, parseReference };

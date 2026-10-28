// Mensagens do site de busca do Tabernáculo da Fé (busca.tabernaculodafe.org.br).
// Baixa a lista e os parágrafos de cada mensagem pela mesma API que o site usa e troca a
// biblioteca do app por elas. Baixa tudo antes de trocar: se a internet cair no meio, nada muda.
const https = require('https');
const db = require('./db');
const { processSermonParagraphs } = require('./sermon-text');

const API = 'https://apibusca.tabernaculodafe.org.br/';
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(API + path, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://busca.tabernaculodafe.org.br',
        Referer: 'https://busca.tabernaculodafe.org.br/',
        'User-Agent': 'A Mensagem Control'
      },
      timeout: 30000
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`O site respondeu ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(new Error('Resposta do site inválida')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('O site demorou para responder')));
    req.on('error', reject);
  });
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// "19470412" -> "12 de Abril de 1947"; sem dia ("19500100") -> "Janeiro de 1950"
function formatDate(raw) {
  const m = String(raw || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return '';
  const [, year, month, day] = m;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return year;
  return Number(day) ? `${Number(day)} de ${monthName} de ${year}` : `${monthName} de ${year}`;
}

// Parágrafos do site -> partes do app (cada uma com até ~150 caracteres, "54 (2/3)")
function toParagraphs(rows) {
  const ordered = rows
    .filter(r => r && typeof r.text === 'string' && r.text.trim())
    .sort((a, b) => Number(a.paragraph) - Number(b.paragraph))
    .map(r => ({ number: String(r.paragraph), text: r.text.replace(/\s+/g, ' ').trim() }));
  return processSermonParagraphs(ordered).map(p => ({ number: String(p.number), text: p.text }));
}

const sermonId = (code) => `tf_${String(code).toLowerCase()}`;

let running = null;

// onProgress({ done, total, title }) é chamado a cada mensagem baixada
async function importFromSite({ onProgress = () => {}, pauseMs = 120 } = {}) {
  if (running) throw new Error('A importação já está em andamento.');
  running = (async () => {
    const titles = await fetchJson('messageGetTitles?orderBy=date');
    if (!Array.isArray(titles) || titles.length === 0) throw new Error('O site não devolveu nenhuma mensagem.');

    const sermons = [];
    const failed = [];
    for (let i = 0; i < titles.length; i++) {
      const t = titles[i];
      try {
        const rows = await fetchJson(`messageGetParagraphs?codeId=${encodeURIComponent(t.code)}`);
        const paragraphs = toParagraphs(Array.isArray(rows) ? rows : []);
        if (paragraphs.length === 0) throw new Error('sem parágrafos');
        sermons.push({ id: sermonId(t.code), title: String(t.title || '').trim(), date: formatDate(t.date), paragraphs });
      } catch (err) {
        failed.push(t.title || t.code);
      }
      onProgress({ done: i + 1, total: titles.length, title: t.title });
      // Sem pressa: uma de cada vez, com uma pausa curta, para não sobrecarregar o site
      if (pauseMs) await wait(pauseMs);
    }

    // Só troca a biblioteca se quase tudo veio (internet caiu no meio = não apaga nada)
    if (sermons.length < titles.length * 0.9) {
      throw new Error(`Só consegui baixar ${sermons.length} de ${titles.length} mensagens. Nada foi trocado; tente de novo.`);
    }

    const keep = new Set(sermons.map(s => s.id));
    let removed = 0;
    db.listSermons().forEach(s => {
      if (!keep.has(s.id) && db.deleteSermon(s.id)) removed++;
    });
    sermons.forEach(s => db.saveSermon(s));
    return { imported: sermons.length, total: titles.length, failed, removed };
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

module.exports = { importFromSite, formatDate, toParagraphs, isRunning: () => !!running };

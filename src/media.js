// Mídias que o pastor envia (imagens e vídeos): Documentos/A Mensagem Control/data/media/<pasta>/<arquivo>,
// servidas em /media/... A pasta "Geral" é a do dia a dia (sempre existe); outras pastas são opcionais.
const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('./db');
const { DATA_DIR } = db;

const DIR = path.join(DATA_DIR, 'media');
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
// Vídeo do YouTube: um arquivinho "<título>.youtube" com o código do vídeo
const YOUTUBE = /\.youtube$/i;
const MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB por arquivo

const GENERAL = 'Geral';

fs.mkdirSync(path.join(DIR, GENERAL), { recursive: true });

const typeOf = (name) => (IMAGE.test(name) ? 'image' : VIDEO.test(name) ? 'video' : YOUTUBE.test(name) ? 'youtube' : null);

// Nome seguro de pasta/arquivo: sem caminhos, sem caracteres que o Windows não aceita
function safe(name) {
  const clean = path.basename(String(name || ''))
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!clean) throw new Error('Nome inválido.');
  return clean;
}


function folderPath(folder) {
  return path.join(DIR, safe(folder));
}

function listFolders() {
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const files = fs.readdirSync(path.join(DIR, e.name)).filter(typeOf);
      const stat = fs.statSync(path.join(DIR, e.name));
      return { name: e.name, count: files.length, modified: stat.mtimeMs };
    })
    // "Geral" no topo, depois as com nome (A-Z) e por último as de data antigas (mais recente primeiro)
    .sort((a, b) => {
      const rank = (n) => (n === GENERAL ? 0 : /^\d{4}-\d{2}-\d{2}$/.test(n) ? 2 : 1);
      return rank(a.name) - rank(b.name) || (rank(a.name) === 2 ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name, 'pt-BR'));
    });
}

function createFolder(name) {
  const folder = safe(name);
  fs.mkdirSync(path.join(DIR, folder), { recursive: true });
  return folder;
}

// Ordem escolhida pelo operador (arrastando), por pasta
const savedOrder = (folder) => (db.getSetting('mediaOrder', {})[folder] || []);

function setOrder(folder, names) {
  const all = db.getSetting('mediaOrder', {});
  all[safe(folder)] = (Array.isArray(names) ? names : []).map(String);
  db.setSetting('mediaOrder', all);
}

function readYoutube(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return /^[\w-]{11}$/.test(data.videoId) ? data : null;
  } catch (err) {
    return null;
  }
}

// Itens na ordem que o operador arrumou; os que ele ainda não mexeu vão no fim,
// na ordem em que foram enviados (a ordem que o pastor costuma mandar)
function listItems(folder) {
  const dir = folderPath(folder);
  if (!fs.existsSync(dir)) return [];
  const order = savedOrder(path.basename(dir));
  const position = (name) => {
    const i = order.indexOf(name);
    return i === -1 ? Infinity : i;
  };
  return fs.readdirSync(dir)
    .filter(typeOf)
    .map(name => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      const item = {
        name,
        type: typeOf(name),
        size: stat.size,
        added: stat.birthtimeMs || stat.mtimeMs,
        url: `/media/${encodeURIComponent(path.basename(dir))}/${encodeURIComponent(name)}`
      };
      if (item.type === 'youtube') {
        const yt = readYoutube(file);
        if (!yt) return null;
        Object.assign(item, { videoId: yt.videoId, title: yt.title, url: `https://www.youtube.com/watch?v=${yt.videoId}`, thumb: `https://i.ytimg.com/vi/${yt.videoId}/hqdefault.jpg` });
      }
      return item;
    })
    .filter(Boolean)
    .sort((a, b) => position(a.name) - position(b.name) || a.added - b.added || a.name.localeCompare(b.name, 'pt-BR'));
}

// Aceita os formatos de link do YouTube: watch?v=, youtu.be/, shorts/, live/, embed/
function parseYoutubeUrl(text) {
  let url;
  try {
    url = new URL(String(text || '').trim());
  } catch (err) {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    const match = url.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
    if (!id && match) id = match[2];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  // "t=90", "t=1m30s" ou "start=90": o vídeo já começa nesse ponto
  const t = url.searchParams.get('t') || url.searchParams.get('start') || '';
  let start = 0;
  const parts = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (parts) start = (Number(parts[1]) || 0) * 3600 + (Number(parts[2]) || 0) * 60 + (Number(parts[3]) || 0);
  return { videoId: id, start };
}

// Título do vídeo pelo oEmbed do YouTube (sem chave); sem internet, fica um nome genérico
function youtubeTitle(videoId) {
  return new Promise(resolve => {
    const req = https.get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(body).title || null : null);
        } catch (err) {
          resolve(null);
        }
      });
    });
    req.setTimeout(6000, () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function addYoutube(folder, link) {
  const parsed = parseYoutubeUrl(link);
  if (!parsed) throw new Error('Esse link não parece ser de um vídeo do YouTube.');
  const dir = folderPath(folder);
  fs.mkdirSync(dir, { recursive: true });
  const title = (await youtubeTitle(parsed.videoId)) || `Vídeo do YouTube ${parsed.videoId}`;
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || parsed.videoId;
  const name = freeName(dir, `${base}.youtube`);
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ videoId: parsed.videoId, title }));
  return { name, type: 'youtube', title, start: parsed.start };
}

// Se já existir um arquivo com o mesmo nome, vira "foto (2).jpg"
function freeName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

// Recebe o arquivo em streaming (vídeos grandes não passam pela memória)
function saveUpload(req, folder, name) {
  return new Promise((resolve, reject) => {
    let fileName;
    let dir;
    try {
      fileName = safe(name);
      if (!typeOf(fileName)) throw new Error('Envie imagens (.jpg, .png, .webp, .gif) ou vídeos (.mp4, .webm, .mov).');
      dir = folderPath(folder);
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      reject(err);
      return;
    }
    const finalName = freeName(dir, fileName);
    const target = path.join(dir, finalName);
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
      if (bytes > MAX_BYTES) {
        req.destroy();
        fail(new Error('Arquivo grande demais (máximo 4 GB).'));
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
      fs.renameSync(partial, target);
      resolve({ name: finalName, type: typeOf(finalName), size: bytes });
    });
    req.pipe(out);
  });
}

function removeItem(folder, name) {
  const file = path.join(folderPath(folder), safe(name));
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

function removeFolder(folder) {
  if (safe(folder) === GENERAL) throw new Error('A pasta Geral não pode ser apagada.');
  const dir = folderPath(folder);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

module.exports = { DIR, GENERAL, listFolders, createFolder, listItems, setOrder, addYoutube, parseYoutubeUrl, saveUpload, removeItem, removeFolder };

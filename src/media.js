// Mídias que o pastor envia (imagens e vídeos), guardadas em uma pasta por culto:
// Documentos/A Mensagem Control/data/media/<pasta>/<arquivo>, servidas em /media/...
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const DIR = path.join(DATA_DIR, 'media');
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB por arquivo

fs.mkdirSync(DIR, { recursive: true });

const typeOf = (name) => (IMAGE.test(name) ? 'image' : VIDEO.test(name) ? 'video' : null);

// Nome seguro de pasta/arquivo: sem caminhos, sem caracteres que o Windows não aceita
function safe(name) {
  const clean = path.basename(String(name || ''))
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!clean) throw new Error('Nome inválido.');
  return clean;
}

// Pasta do dia ("2026-10-25"), criada quando o operador abre a aba
function todayFolder() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    // Pastas de data primeiro (mais recente no topo), depois as com nome
    .sort((a, b) => b.name.localeCompare(a.name, 'pt-BR'));
}

function createFolder(name) {
  const folder = safe(name);
  fs.mkdirSync(path.join(DIR, folder), { recursive: true });
  return folder;
}

// Itens na ordem em que foram enviados (a ordem que o pastor costuma mandar)
function listItems(folder) {
  const dir = folderPath(folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(typeOf)
    .map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return {
        name,
        type: typeOf(name),
        size: stat.size,
        added: stat.birthtimeMs || stat.mtimeMs,
        url: `/media/${encodeURIComponent(path.basename(dir))}/${encodeURIComponent(name)}`
      };
    })
    .sort((a, b) => a.added - b.added || a.name.localeCompare(b.name, 'pt-BR'));
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
  const dir = folderPath(folder);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

module.exports = { DIR, todayFolder, listFolders, createFolder, listItems, saveUpload, removeItem, removeFolder };

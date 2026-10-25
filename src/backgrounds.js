// Imagens de fundo (Bíblia e Hinos), guardadas em Documentos/A Mensagem Control/data/backgrounds
// e servidas em /backgrounds/<arquivo>. Na primeira vez, traz os fundos da pasta da igreja.
const fs = require('fs');
const path = require('path');
const { connection: db, DATA_DIR, notifyChange, recordDeletion, clearDeletion } = require('./db');

const DIR = path.join(DATA_DIR, 'backgrounds');
const CHURCH_FOLDER = 'C:\\tf_slides\\_backgrounds';
const ALLOWED = /\.(jpe?g|png|webp)$/i;

fs.mkdirSync(DIR, { recursive: true });

// Nome seguro: sem pastas, sem caracteres estranhos, extensão de imagem
function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim();
  if (!ALLOWED.test(base)) throw new Error('Use uma imagem .jpg, .png ou .webp.');
  return base;
}

function list() {
  return fs.readdirSync(DIR)
    .filter(f => ALLOWED.test(f))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map(name => ({ name, url: `/backgrounds/${encodeURIComponent(name)}` }));
}

function save(name, buffer) {
  const file = safeName(name);
  if (!buffer || buffer.length === 0) throw new Error('Imagem vazia.');
  fs.writeFileSync(path.join(DIR, file), buffer);
  // Pendente de envio para o banco online (o editor envia na próxima sincronização)
  db.prepare(`INSERT INTO background_sync (name, size, dirty) VALUES (?, ?, 1)
    ON CONFLICT(name) DO UPDATE SET size = excluded.size, dirty = 1`).run(file, buffer.length);
  clearDeletion('background', file);
  notifyChange('background');
  return { name: file, url: `/backgrounds/${encodeURIComponent(file)}` };
}

function remove(name) {
  const safe = safeName(name);
  const file = path.join(DIR, safe);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  db.prepare('DELETE FROM background_sync WHERE name = ?').run(safe);
  recordDeletion('background', safe);
  return true;
}

function autoImport() {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get('backgrounds_imported');
  if (done || !fs.existsSync(CHURCH_FOLDER)) return;
  let copied = 0;
  fs.readdirSync(CHURCH_FOLDER).filter(f => ALLOWED.test(f)).forEach(f => {
    const target = path.join(DIR, f);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(path.join(CHURCH_FOLDER, f), target);
      copied++;
    }
  });
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('backgrounds_imported', new Date().toISOString());
  console.log(`Fundos copiados de ${CHURCH_FOLDER}: ${copied}.`);
}

module.exports = { DIR, list, save, remove, autoImport };

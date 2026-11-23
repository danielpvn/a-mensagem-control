// Caixinha de sugestões e problemas: qualquer igreja com o app manda (texto + fotos/vídeos);
// só o dono do app lê. Tudo fica no banco online (tabela feedback e o armazenamento privado
// "feedback"); as regras de quem lê estão em supabase/schema.sql.
const crypto = require('crypto');
const sync = require('./sync');

const BUCKET = 'feedback';
const MAX_BYTES = 50 * 1024 * 1024; // limite de arquivo do plano gratuito do Supabase
const KINDS = ['sugestao', 'problema'];
const STATUSES = ['novo', 'visto', 'resolvido'];

const safeName = (name) => String(name || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'arquivo';
const objectPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

// Envia um anexo (o corpo vem em streaming do painel) e devolve o caminho dele no armazenamento
async function uploadAttachment(stream, { name, type, size }) {
  if (!/^(image|video)\//.test(String(type || ''))) throw new Error('Só dá para anexar fotos e vídeos.');
  if (size > MAX_BYTES) throw new Error('Arquivo grande demais: o limite é 50 MB por arquivo.');
  const month = new Date().toISOString().slice(0, 7);
  const path = `${month}/${crypto.randomUUID()}-${safeName(name)}`;
  await sync.request(`/storage/v1/object/${BUCKET}/${objectPath(path)}`, {
    method: 'POST',
    body: stream,
    raw: true,
    headers: { 'Content-Type': type, ...(size ? { 'Content-Length': String(size) } : {}), 'x-upsert': 'false' }
  });
  return { path, name: String(name || '').slice(0, 120), type, size: Number(size) || 0 };
}

async function submit({ kind, message, contact, attachments }, appVersion) {
  const text = String(message || '').trim();
  if (!KINDS.includes(kind)) throw new Error('Escolha se é sugestão ou problema.');
  if (text.length < 3) throw new Error('Escreva o que aconteceu ou a sua ideia.');
  const status = sync.status();
  const files = (Array.isArray(attachments) ? attachments : []).slice(0, 6).map(a => ({
    path: String(a.path || ''), name: String(a.name || '').slice(0, 120), type: String(a.type || ''), size: Number(a.size) || 0
  })).filter(a => a.path);
  await sync.request('/rest/v1/feedback', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      kind,
      message: text.slice(0, 4000),
      contact: String(contact || '').trim().slice(0, 120) || null,
      church: status.church || null,
      app_version: appVersion,
      attachments: files
    }
  });
}

// Só o dono do app (tabela app_owners) recebe true
async function isOwner() {
  if (!sync.status().loggedIn) return false;
  try {
    const res = await sync.request('/rest/v1/rpc/is_app_owner', { method: 'POST', body: {} });
    return (await res.json()) === true;
  } catch (err) {
    return false;
  }
}

async function signedUrl(path) {
  const res = await sync.request(`/storage/v1/object/sign/${BUCKET}/${objectPath(path)}`, { method: 'POST', body: { expiresIn: 3 * 3600 } });
  const data = await res.json();
  const signed = data.signedURL || data.signedUrl;
  return signed ? `${sync.cloudUrl()}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}` : null;
}

// Lista para o dono, já com links temporários para ver as fotos e vídeos
async function list() {
  const res = await sync.request('/rest/v1/feedback?select=*&order=created_at.desc&limit=200');
  const rows = await res.json();
  for (const row of rows) {
    row.attachments = await Promise.all((row.attachments || []).map(async a => ({ ...a, url: await signedUrl(a.path).catch(() => null) })));
  }
  return rows;
}

async function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error('Situação inválida.');
  await sync.request(`/rest/v1/feedback?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status } });
}

async function remove(id) {
  const res = await sync.request(`/rest/v1/feedback?id=eq.${encodeURIComponent(id)}&select=attachments`);
  const [row] = await res.json();
  const paths = row ? (row.attachments || []).map(a => a.path).filter(Boolean) : [];
  if (paths.length) await sync.request(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: paths } }).catch(() => {});
  await sync.request(`/rest/v1/feedback?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

module.exports = { uploadAttachment, submit, isOwner, list, setStatus, remove, MAX_BYTES };

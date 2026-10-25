// PIN para controlar o app de outro aparelho (celular, notebook no Wi-Fi da igreja).
// - O próprio computador da mídia (localhost) nunca precisa de PIN.
// - Sem PIN configurado, qualquer aparelho da rede pode controlar (como antes).
// - O overlay (OBS), fundos, mídias e fontes ficam sempre abertos: o OBS pode estar em outro PC.
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'amc_pin';
let failures = 0;
let lockedUntil = 0;

function secret() {
  let value = db.getSetting('authSecret', null);
  if (!value) {
    value = crypto.randomBytes(24).toString('hex');
    db.setSetting('authSecret', value);
  }
  return value;
}

const pin = () => db.getSetting('remotePin', null);
const token = (value) => crypto.createHash('sha256').update(`${secret()}:${value}`).digest('hex');

function isLocal(req) {
  const address = (req.socket && req.socket.remoteAddress) || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function isAuthorized(req) {
  const current = pin();
  if (!current || isLocal(req)) return true;
  return readCookie(req, COOKIE) === token(current);
}

// Páginas e rotas que controlam o app. O resto (overlay, mídia, fundos, fontes, js/css) é livre.
function middleware(req, res, next) {
  const guarded = req.path === '/' || req.path === '/admin.html' || (req.path.startsWith('/api/') && !req.path.startsWith('/api/pin'));
  if (!guarded || isAuthorized(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Digite o PIN para controlar daqui.' });
  return res.redirect('/pin.html');
}

// Confere o PIN digitado; depois de 5 erros, espera 30 segundos
function login(req, res) {
  const current = pin();
  if (!current) return res.json({ success: true });
  if (Date.now() < lockedUntil) {
    return res.status(429).json({ error: 'Muitas tentativas. Espere 30 segundos.' });
  }
  if (String(req.body.pin || '') !== current) {
    failures++;
    if (failures >= 5) {
      failures = 0;
      lockedUntil = Date.now() + 30000;
    }
    return res.status(401).json({ error: 'PIN incorreto.' });
  }
  failures = 0;
  res.setHeader('Set-Cookie', `${COOKIE}=${token(current)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
  res.json({ success: true });
}

function setPin(value) {
  const clean = String(value || '').trim();
  if (clean && !/^\d{4,8}$/.test(clean)) throw new Error('O PIN deve ter de 4 a 8 números.');
  db.setSetting('remotePin', clean || null);
  return !!clean;
}

module.exports = { isAuthorized, isLocal, middleware, login, setPin, hasPin: () => !!pin() };

// OBS em outro computador: nome deste PC, liberar a porta no Firewall do Windows
// e o nome dos computadores que abriram o overlay.
const os = require('os');
const dns = require('dns');
const { execFile } = require('child_process');

const RULE = 'A Mensagem Control (OBS em outro PC)';
const isWindows = process.platform === 'win32';

function run(file, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
  });
}

// A regra criada pelo app (ou pelo Instalar.bat) existe?
async function firewallStatus() {
  if (!isWindows) return { supported: false, allowed: true };
  const { ok } = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE}`]);
  return { supported: true, allowed: ok };
}

// Cria a regra pedindo permissão de administrador (o Windows mostra a janela do "Sim/Não")
async function allowFirewall(port) {
  if (!isWindows) return { supported: false, allowed: true };
  const args = `advfirewall firewall add rule name="${RULE}" dir=in action=allow protocol=TCP localport=${Number(port)} profile=any`;
  const command = `Start-Process netsh -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '${args}'`;
  await run('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], 120000);
  return firewallStatus();
}

// Nome do computador pelo IP (quando a rede responde); guarda para não perguntar de novo
const names = new Map();
function nameFor(ip, onFound) {
  if (names.has(ip)) return names.get(ip);
  names.set(ip, null);
  dns.reverse(ip, (err, hosts) => {
    if (err || !hosts || !hosts.length) return;
    names.set(ip, hosts[0].split('.')[0].toUpperCase());
    onFound();
  });
  return null;
}

const cleanAddress = (address) => String(address || '').replace(/^::ffff:/, '');

module.exports = { hostname: () => os.hostname(), firewallStatus, allowFirewall, nameFor, cleanAddress, RULE };

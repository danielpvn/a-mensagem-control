// Atualizador automático de 1 clique.
// A URL do pacote é SEMPRE lida do update.json oficial no GitHub, nunca do navegador:
// assim nenhum aparelho da rede local consegue fazer o app baixar e instalar outro arquivo.
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');

const UPDATE_JSON_URL = 'https://raw.githubusercontent.com/danielpvn/a-mensagem-control/main/update.json';
// Canal de testes: só é lido nos PCs que ligaram "Receber versões de teste" em Configurações
const BETA_JSON_URL = 'https://raw.githubusercontent.com/danielpvn/a-mensagem-control/dev/update-beta.json';
const ALLOWED_DOWNLOAD_PREFIX = 'https://github.com/danielpvn/a-mensagem-control/releases/download/';

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, (response) => {
      // Trata redirecionamentos (301 e 302) sem abrir múltiplos streams concorrentes
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Falha no download: Status ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destPath);
      response.pipe(file);

      file.on('finish', () => {
        file.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    request.on('error', reject);
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const escapedZipPath = zipPath.replace(/'/g, "''");
    const escapedDestDir = destDir.replace(/'/g, "''");
    // Força o PowerShell a lançar erro se a descompactação falhar e ignora perfis
    const cmd = `powershell -NoProfile -NonInteractive -Command "$ErrorActionPreference = 'Stop'; Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedDestDir}' -Force"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`PowerShell descompactacao falhou: ${stderr || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Falha ao buscar JSON: Status ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// "2.1.0-beta.2" -> { core: [2, 1, 0], beta: 2 }; versão final não tem beta
function parseVersion(version) {
  const [core, pre] = String(version).split('-');
  const match = pre ? pre.match(/(\d+)$/) : null;
  return { core: core.split('.').map(Number), beta: pre ? (match ? Number(match[1]) : 0) : null };
}

// A versão final é mais nova que qualquer teste dela (2.1.0 > 2.1.0-beta.5)
function isNewerVersion(current, online) {
  if (!current || !online) return false;
  const c = parseVersion(current);
  const o = parseVersion(online);
  for (let i = 0; i < Math.max(c.core.length, o.core.length); i++) {
    const a = c.core[i] || 0;
    const b = o.core[i] || 0;
    if (b > a) return true;
    if (a > b) return false;
  }
  if (c.beta === null) return false;
  if (o.beta === null) return true;
  return o.beta > c.beta;
}

// Escolhe a atualização: a oficial e, no canal de testes, a de teste se for mais nova
async function latestRelease({ beta = false } = {}) {
  const stable = await fetchJson(UPDATE_JSON_URL);
  if (!beta) return stable;
  try {
    const test = await fetchJson(BETA_JSON_URL);
    if (test && test.version && isNewerVersion(stable.version, test.version)) return { ...test, isBeta: true };
  } catch (err) {
    // sem arquivo de teste: fica na oficial
  }
  return stable;
}

async function checkForUpdate(currentVersion, options = {}) {
  const updateData = await latestRelease(options);
  return {
    updateAvailable: isNewerVersion(currentVersion, updateData.version),
    currentVersion,
    onlineVersion: updateData.version,
    isBeta: !!updateData.isBeta,
    notes: updateData.notes || ''
  };
}

// Baixa, extrai e agenda a troca dos arquivos. Resolve quando o .bat está pronto para rodar;
// quem chama deve responder ao navegador e então chamar o retorno `launch()`.
async function prepareUpdate(currentVersion, options = {}) {
  const info = await latestRelease(options);
  if (!isNewerVersion(currentVersion, info.version)) {
    throw new Error('Nenhuma versão nova disponível.');
  }
  const url = info.url || '';
  if (!url.startsWith(ALLOWED_DOWNLOAD_PREFIX) || !url.toLowerCase().endsWith('.zip')) {
    throw new Error('Endereço de atualização inválido no update.json.');
  }

  const tempDir = os.tmpdir();
  const zipPath = path.join(tempDir, 'amc_update.zip');
  const extractDir = path.join(tempDir, 'extracted');

  // Limpa diretórios temporários anteriores
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });

  console.log('Baixando ZIP da atualização:', url);
  await downloadFile(url, zipPath);

  console.log('Descompactando atualização...');
  await extractZip(zipPath, extractDir);

  const batPath = path.join(tempDir, 'update_app.bat');
  const currentExePath = process.versions.electron ? require('electron').app.getPath('exe') : process.argv[0];
  const appDir = path.dirname(currentExePath);

  // A pasta gerada no zip extraído pode ser a pasta raiz ou a pasta filha A Mensagem Control-win32-x64
  let sourceDir = path.join(extractDir, 'A Mensagem Control-win32-x64');
  if (!fs.existsSync(sourceDir)) {
    if (fs.existsSync(path.join(extractDir, 'A Mensagem Control.exe'))) {
      sourceDir = extractDir;
    } else {
      const files = fs.readdirSync(extractDir);
      throw new Error(`Pasta compactada incorreta: arquivos do aplicativo nao encontrados no ZIP. Encontrado na raiz: [${files.join(', ')}]`);
    }
  }

  // Script .bat que roda silencioso para substituir os arquivos e reabrir o app
  const batContent = `@echo off
title Atualizando A Mensagem Control
echo Aguardando o aplicativo fechar...
timeout /t 2 /nobreak > nul

echo Atualizando arquivos em ${appDir}...
xcopy "${sourceDir}" "${appDir}" /E /I /H /Y /Q > nul

echo Iniciando o aplicativo atualizado...
start "" "${currentExePath}"

echo Limpando arquivos temporarios...
del "%~f0"
`;

  fs.writeFileSync(batPath, batContent, 'ascii');

  return function launch() {
    console.log('Iniciando script de atualização e fechando aplicativo...');

    // Spawna o script desvinculado (detached)
    const child = spawn('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      cwd: tempDir
    });
    child.unref();

    // Encerra o Electron após 500ms
    setTimeout(() => {
      try {
        const { app: electronApp } = require('electron');
        electronApp.quit();
      } catch (e) {
        process.exit(0);
      }
    }, 500);
  };
}

module.exports = { checkForUpdate, prepareUpdate, isNewerVersion };

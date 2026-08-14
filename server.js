const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

let SERMONS_DIR = path.join(process.cwd(), 'data', 'sermons');

function ensureSermonsDir() {
  try {
    const { app: electronApp } = require('electron');
    if (electronApp) {
      const docs = electronApp.getPath('documents');
      SERMONS_DIR = path.join(docs, 'A Mensagem Control', 'data', 'sermons');
    }
  } catch (e) {
    // Não está no Electron ou não está pronto ainda
  }

  try {
    if (!fs.existsSync(SERMONS_DIR)) {
      fs.mkdirSync(SERMONS_DIR, { recursive: true });
    }
    
    // Copia sermão de exemplo se a pasta estiver vazia
    const files = fs.readdirSync(SERMONS_DIR);
    if (files.length === 0) {
      const sampleFileName = '62-1014m_a_estatura_de_um_homem_perfeito.json';
      const bundledSamplePath = path.join(__dirname, 'data', 'sermons', sampleFileName);
      const localSamplePath = path.join(SERMONS_DIR, sampleFileName);
      
      if (fs.existsSync(bundledSamplePath)) {
        fs.copyFileSync(bundledSamplePath, localSamplePath);
        console.log('Sermão de exemplo copiado para:', localSamplePath);
      }
    }
  } catch (err) {
    console.error('Erro ao inicializar diretório de sermões:', err);
  }
}

// Inicializa no boot
ensureSermonsDir();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Estado global do software
let globalState = {
  activeSermonId: null,
  activeSermonTitle: '',
  activeSermonDate: '',
  currentParagraphIndex: -1,
  currentParagraphText: '',
  currentParagraphNumber: null,
  isCleared: true,
  styles: {
    fontFamily: 'Outfit, sans-serif',
    fontSize: '2.2rem',
    textColor: '#ffffff',
    titleColor: '#3b82f6',
    titleSize: '0.85rem',
    bgColor: 'rgba(10, 15, 30, 0.85)',
    accentColor: '#2563eb',
    animationType: 'slide-up',
    alignment: 'center',
    padding: '24px 40px',
    borderRadius: '16px',
    shadow: '0 20px 40px rgba(0,0,0,0.5)',
    borderSize: '4px',
    showTitle: true
  }
};

let activeSermonParagraphs = [];

function nextParagraph() {
  if (activeSermonParagraphs.length === 0) return;
  const nextIndex = globalState.currentParagraphIndex + 1;
  if (nextIndex < activeSermonParagraphs.length) {
    setParagraphOnServer(nextIndex);
  }
}

function prevParagraph() {
  if (activeSermonParagraphs.length === 0) return;
  const prevIndex = globalState.currentParagraphIndex - 1;
  if (prevIndex >= 0) {
    setParagraphOnServer(prevIndex);
  }
}

function toggleClearOnServer() {
  if (globalState.currentParagraphIndex === -1) return;
  globalState.isCleared = !globalState.isCleared;
  broadcast('update-content', globalState);
}

function setParagraphOnServer(index) {
  if (index < 0 || index >= activeSermonParagraphs.length) return;
  const p = activeSermonParagraphs[index];
  globalState.currentParagraphIndex = index;
  globalState.currentParagraphText = p.text || '';
  globalState.currentParagraphNumber = p.number || null;
  globalState.isCleared = false;
  
  broadcast('update-content', globalState);
  broadcast('sync-paragraph-selection', { index });
}

// WebSocket: Enviar estado atualizado para todos os clientes conectados
function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

let shutdownTimer = null;

function checkAdminConnections() {
  if (process.versions.electron) return;
  let adminCount = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.isAdmin) {
      adminCount++;
    }
  });

  if (adminCount === 0) {
    if (!shutdownTimer) {
      console.log('Nenhum painel administrativo ativo. Agendando desligamento automático em 10 segundos...');
      shutdownTimer = setTimeout(() => {
        console.log('Desligando o servidor automaticamente (sem painéis ativos).');
        process.exit(0);
      }, 10000);
    }
  } else {
    if (shutdownTimer) {
      console.log('Painel do operador detectado. Cancelando desligamento automático.');
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  }
}

wss.on('connection', (ws) => {
  console.log('Cliente conectado ao WebSocket');
  ensureSermonsDir();
  
  ws.send(JSON.stringify({ type: 'init', payload: globalState }));

  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      console.log('Comando recebido:', data.type);

      switch (data.type) {
        case 'register-admin':
          ws.isAdmin = true;
          checkAdminConnections();
          break;

        case 'set-paragraph':
          globalState.currentParagraphIndex = data.payload.index;
          globalState.currentParagraphText = data.payload.text || '';
          globalState.currentParagraphNumber = data.payload.number || null;
          globalState.isCleared = false;
          broadcast('update-content', globalState);
          break;

        case 'clear-screen':
          globalState.isCleared = true;
          broadcast('update-content', globalState);
          break;

        case 'set-sermon':
          globalState.activeSermonId = data.payload.id;
          globalState.activeSermonTitle = data.payload.title;
          globalState.activeSermonDate = data.payload.date;
          globalState.currentParagraphIndex = -1;
          globalState.currentParagraphText = '';
          globalState.currentParagraphNumber = null;
          globalState.isCleared = true;

          ensureSermonsDir();
          try {
            if (globalState.activeSermonId) {
              const files = fs.readdirSync(SERMONS_DIR);
              const file = files.find(f => {
                if (!f.endsWith('.json')) return false;
                try {
                  const content = fs.readFileSync(path.join(SERMONS_DIR, f), 'utf-8');
                  const json = JSON.parse(content);
                  return json.id === globalState.activeSermonId;
                } catch (e) {
                  return false;
                }
              });

              if (file) {
                const sermonContent = fs.readFileSync(path.join(SERMONS_DIR, file), 'utf-8');
                activeSermonParagraphs = JSON.parse(sermonContent).paragraphs || [];
                console.log(`Carregados ${activeSermonParagraphs.length} parágrafos em memória no servidor.`);
              } else {
                console.warn('Arquivo do sermão não encontrado para ID:', globalState.activeSermonId);
                activeSermonParagraphs = [];
              }
            } else {
              activeSermonParagraphs = [];
            }
          } catch (err) {
            console.error('Erro ao carregar parágrafos no servidor:', err);
            activeSermonParagraphs = [];
          }

          broadcast('update-content', globalState);
          break;

        case 'update-styles':
          globalState.styles = { ...globalState.styles, ...data.payload };
          broadcast('update-style', globalState.styles);
          break;

        default:
          console.warn('Tipo de mensagem desconhecido:', data.type);
      }
    } catch (err) {
      console.error('Erro ao processar mensagem do WebSocket:', err);
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado do WebSocket');
    setTimeout(checkAdminConnections, 2000);
  });
});

// API: Listar sermões disponíveis
app.get('/api/sermons', (req, res) => {
  ensureSermonsDir();
  try {
    const files = fs.readdirSync(SERMONS_DIR);
    const sermons = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const content = fs.readFileSync(path.join(SERMONS_DIR, file), 'utf-8');
        const json = JSON.parse(content);
        return {
          id: json.id,
          title: json.title,
          date: json.date,
          fileName: file,
          paragraphCount: json.paragraphs ? json.paragraphs.length : 0
        };
      });
    res.json(sermons);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar sermões', details: err.message });
  }
});

// API: Obter sermão por ID
app.get('/api/sermons/:id', (req, res) => {
  ensureSermonsDir();
  try {
    const files = fs.readdirSync(SERMONS_DIR);
    const file = files.find(f => {
      const content = fs.readFileSync(path.join(SERMONS_DIR, f), 'utf-8');
      const json = JSON.parse(content);
      return json.id === req.params.id;
    });

    if (!file) {
      return res.status(404).json({ error: 'Sermão não encontrado' });
    }

    const sermonContent = fs.readFileSync(path.join(SERMONS_DIR, file), 'utf-8');
    res.json(JSON.parse(sermonContent));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter sermão', details: err.message });
  }
});

// API: Importar sermão a partir de texto copiado
app.post('/api/import', (req, res) => {
  ensureSermonsDir();
  const { title, date, id, rawText } = req.body;

  if (!title || !rawText || !id) {
    return res.status(400).json({ error: 'Título, ID e Texto são obrigatórios' });
  }

  try {
    // Processa o texto bruto para extrair parágrafos
    const lines = rawText.split('\n');
    const paragraphs = [];
    let currentParagraphText = '';
    let currentParagraphNumber = null;

    // Expressão regular para capturar números de parágrafo como "[54]", "54", "54.", "54 -" no início da linha
    const paragraphRegex = /^(?:\[?(\d+)\]?[\s.-]+|(\d+)\s+)/;

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;

      const match = trimmedLine.match(paragraphRegex);

      if (match) {
        // Se já estávamos acumulando um parágrafo anterior, salva-o
        if (currentParagraphNumber !== null && currentParagraphText) {
          paragraphs.push({
            number: currentParagraphNumber,
            text: currentParagraphText.trim()
          });
        }

        // Inicia um novo parágrafo
        currentParagraphNumber = parseInt(match[1] || match[2], 10);
        // Remove a numeração do início da linha para salvar apenas o texto
        currentParagraphText = trimmedLine.replace(paragraphRegex, '');
      } else {
        // Se não houver numeração no início, acumula o texto na linha atual
        if (currentParagraphNumber !== null) {
          currentParagraphText += ' ' + trimmedLine;
        } else {
          // Se não encontrou parágrafo numerado ainda, usa um número sequencial provisório ou cria um parágrafo sem número
          currentParagraphNumber = paragraphs.length + 1;
          currentParagraphText = trimmedLine;
        }
      }
    });

    // Salva o último parágrafo
    if (currentParagraphNumber !== null && currentParagraphText) {
      paragraphs.push({
        number: currentParagraphNumber,
        text: currentParagraphText.trim()
      });
    }

    const sermonData = {
      id,
      title,
      date: date || 'Data desconhecida',
      paragraphs
    };

    const fileName = `${id.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`;
    fs.writeFileSync(path.join(SERMONS_DIR, fileName), JSON.stringify(sermonData, null, 2), 'utf-8');

    res.json({ success: true, fileName, paragraphCount: paragraphs.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar importação', details: err.message });
  }
});


function ensureIcoFile() {
  const localIcoPath = path.join(process.cwd(), 'data', 'favicon.ico');
  if (fs.existsSync(localIcoPath)) {
    return localIcoPath;
  }

  try {
    const bundledPngPath = path.join(__dirname, 'public', 'assets', 'favicon.png');
    if (!fs.existsSync(bundledPngPath)) {
      console.warn('Bundled PNG not found for ICO conversion.');
      return null;
    }
    const pngData = fs.readFileSync(bundledPngPath);
    const size = pngData.length;

    const icoHeader = Buffer.alloc(22);
    icoHeader.writeUInt16LE(0, 0);      // Reserved
    icoHeader.writeUInt16LE(1, 2);      // Icon type (1 = icon)
    icoHeader.writeUInt16LE(1, 4);      // Number of images
    icoHeader.writeUInt8(0, 6);         // Width (0 = 256)
    icoHeader.writeUInt8(0, 7);         // Height (0 = 256)
    icoHeader.writeUInt8(0, 8);         // Color count
    icoHeader.writeUInt8(0, 9);         // Reserved
    icoHeader.writeUInt16LE(1, 10);     // Color planes
    icoHeader.writeUInt16LE(32, 12);    // Bits per pixel
    icoHeader.writeUInt32LE(size, 14);  // Size of PNG
    icoHeader.writeUInt32LE(22, 18);    // Offset of PNG

    const icoData = Buffer.concat([icoHeader, pngData]);
    const dataDir = path.dirname(localIcoPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(localIcoPath, icoData);
    console.log('favicon.ico criado com sucesso em data/');
    return localIcoPath;
  } catch (err) {
    console.error('Falha ao criar o favicon.ico:', err);
    return null;
  }
}

function createDesktopShortcut() {
  if (process.platform !== 'win32') return;

  const isElectron = !!process.versions.electron;
  
  if (isElectron) {
    const exePath = process.execPath;
    const isDev = exePath.includes('node_modules') || exePath.includes('electron.exe');
    if (isDev) return;

    const exeDir = path.dirname(exePath);
    const escapedExePath = exePath.replace(/'/g, "''");
    const escapedExeDir = exeDir.replace(/'/g, "''");

    const psScript = `
      $desktop = [System.Environment]::GetFolderPath('Desktop');
      $shortcutPath = Join-Path $desktop 'A Mensagem Control.lnk';
      if (-not (Test-Path $shortcutPath)) {
        $WshShell = New-Object -ComObject WScript.Shell;
        $Shortcut = $WshShell.CreateShortcut($shortcutPath);
        $Shortcut.TargetPath = '${escapedExePath}';
        $Shortcut.WorkingDirectory = '${escapedExeDir}';
        $Shortcut.Description = 'A Mensagem Control';
        $Shortcut.IconLocation = '${escapedExePath},0';
        $Shortcut.Save();
        Write-Output 'OK';
      } else {
        $WshShell = New-Object -ComObject WScript.Shell;
        $Shortcut = $WshShell.CreateShortcut($shortcutPath);
        $Shortcut.TargetPath = '${escapedExePath}';
        $Shortcut.WorkingDirectory = '${escapedExeDir}';
        $Shortcut.IconLocation = '${escapedExePath},0';
        $Shortcut.Save();
        Write-Output 'UPDATED';
      }
    `;

    const formattedScript = psScript.replace(/\n/g, ' ').trim();
    exec(`powershell -Command "${formattedScript}"`, (err, stdout) => {
      if (err) {
        console.error('Erro ao criar atalho no Desktop (Electron):', err);
      } else {
        console.log('Atalho do Desktop configurado (Electron):', stdout.trim());
      }
    });
  } else {
    const exePath = process.argv[0];
    const isPackaged = process.pkg || exePath.endsWith('AMensagemControl.exe');
    if (!isPackaged) return;

    const icoPath = ensureIcoFile();
    const exeDir = path.dirname(exePath);

    const constEscapedExePath = exePath.replace(/'/g, "''");
    const constEscapedExeDir = exeDir.replace(/'/g, "''");
    const constEscapedIcoPath = icoPath ? icoPath.replace(/'/g, "''") : '';

    const psScript = `
      $desktop = [System.Environment]::GetFolderPath('Desktop');
      $shortcutPath = Join-Path $desktop 'A Mensagem Control.lnk';
      if (-not (Test-Path $shortcutPath)) {
        $WshShell = New-Object -ComObject WScript.Shell;
        $Shortcut = $WshShell.CreateShortcut($shortcutPath);
        $Shortcut.TargetPath = 'powershell.exe';
        $Shortcut.Arguments = '-WindowStyle Hidden -Command "Start-Process -FilePath ''${constEscapedExePath}'' -WindowStyle Hidden; Start-Process -FilePath ''msedge.exe'' -ArgumentList ''--app=http://localhost:3000/admin.html''"';
        $Shortcut.WorkingDirectory = '${constEscapedExeDir}';
        $Shortcut.Description = 'A Mensagem Control';
        ${constEscapedIcoPath ? `$Shortcut.IconLocation = '${constEscapedIcoPath},0';` : ''}
        $Shortcut.Save();
        Write-Output 'OK';
      } else {
        $WshShell = New-Object -ComObject WScript.Shell;
        $Shortcut = $WshShell.CreateShortcut($shortcutPath);
        $Shortcut.TargetPath = 'powershell.exe';
        $Shortcut.Arguments = '-WindowStyle Hidden -Command "Start-Process -FilePath ''${constEscapedExePath}'' -WindowStyle Hidden; Start-Process -FilePath ''msedge.exe'' -ArgumentList ''--app=http://localhost:3000/admin.html''"';
        $Shortcut.WorkingDirectory = '${constEscapedExeDir}';
        ${constEscapedIcoPath ? `$Shortcut.IconLocation = '${constEscapedIcoPath},0';` : ''}
        $Shortcut.Save();
        Write-Output 'UPDATED';
      }
    `;

    const formattedScript = psScript.replace(/\n/g, ' ').trim();
    exec(`powershell -Command "${formattedScript}"`, (err, stdout) => {
      if (err) {
        console.error('Erro ao criar atalho no Desktop (Node):', err);
      } else {
        console.log('Atalho do Desktop configurado (Node):', stdout.trim());
      }
    });
  }
}


// --- AUTOPUPDATER BACKEND IMPLEMENTATION ---
const CURRENT_VERSION = '1.0.0';
const UPDATE_JSON_URL = 'https://raw.githubusercontent.com/danielpvn/a-mensagem-control/main/update.json';

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Falha no download: Status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const escapedZipPath = zipPath.replace(/'/g, "''");
    const escapedDestDir = destDir.replace(/'/g, "''");
    const cmd = `powershell -Command "Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedDestDir}' -Force"`;
    
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`PowerShell descompactação falhou: ${stderr || err.message}`));
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

function isNewerVersion(current, online) {
  if (!current || !online) return false;
  const partsCurrent = current.split('.').map(Number);
  const partsOnline = online.split('.').map(Number);
  for (let i = 0; i < Math.max(partsCurrent.length, partsOnline.length); i++) {
    const c = partsCurrent[i] || 0;
    const o = partsOnline[i] || 0;
    if (o > c) return true;
    if (c > o) return false;
  }
  return false;
}

app.get('/api/check-update', async (req, res) => {
  try {
    const updateData = await fetchJson(UPDATE_JSON_URL);
    const onlineVersion = updateData.version;
    const updateAvailable = isNewerVersion(CURRENT_VERSION, onlineVersion);
    
    res.json({
      updateAvailable,
      currentVersion: CURRENT_VERSION,
      onlineVersion,
      notes: updateData.notes || '',
      url: updateData.url || ''
    });
  } catch (err) {
    console.error('Erro ao checar atualizações:', err);
    res.json({ updateAvailable: false, error: err.message });
  }
});

app.post('/api/trigger-update', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL da atualização é obrigatória' });
  }
  
  try {
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
    
    // A pasta gerada no zip extraído será A Mensagem Control-win32-x64
    const sourceDir = path.join(extractDir, 'A Mensagem Control-win32-x64');
    if (!fs.existsSync(sourceDir)) {
      throw new Error('Pasta compactada incorreta: pasta A Mensagem Control-win32-x64 não encontrada no ZIP.');
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
    
    // Retorna resposta de sucesso para o cliente exibir a animação
    res.json({ success: true });
    
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
    
  } catch (err) {
    console.error('Erro ao processar atualização automática:', err);
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`-> Painel do Operador: http://localhost:${PORT}/admin.html`);
  console.log(`-> Overlay do OBS: http://localhost:${PORT}/overlay.html`);
  
  try {
    createDesktopShortcut();
  } catch (err) {
    console.error('Erro na criação automática do atalho:', err);
  }
});

module.exports = {
  nextParagraph,
  prevParagraph,
  toggleClearOnServer
};

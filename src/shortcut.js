// Cria/atualiza o atalho "A Mensagem Control" na Área de Trabalho do Windows.
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

function ensureIcoFile() {
  const localIcoPath = path.join(process.cwd(), 'data', 'favicon.ico');
  if (fs.existsSync(localIcoPath)) {
    return localIcoPath;
  }

  try {
    const bundledPngPath = path.join(__dirname, '..', 'public', 'assets', 'favicon.png');
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
  // Em testes (banco separado) não mexe no atalho da instalação real
  if (process.env.AMC_DATA_DIR) return;

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

module.exports = { createDesktopShortcut };

const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

// Só uma cópia do app por vez: uma segunda abriria outro servidor na mesma porta 3000
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Inicia o servidor HTTP + WebSocket local integrado
// Como server.js executa server.listen() ao ser importado, o servidor iniciará automaticamente.
const server = require('./server.js');

let mainWindow;

// Se o operador clicar no atalho com o app já aberto, traz a janela existente para frente
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0f19',
    title: 'A Mensagem Control',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Oculta a barra de menus do topo para parecer um software limpo
  mainWindow.removeMenu();

  // Intercepta cliques em links target="_blank" para abrir no navegador padrão do sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Carrega o painel do operador do servidor local
  mainWindow.loadURL(`http://localhost:${server.PORT}/admin.html`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Inicialização do Electron
app.whenReady().then(() => {
  createWindow();

  // Registra atalhos globais para controle (Logitech R400 ou teclado) mesmo com o app minimizado
  globalShortcut.register('PageDown', () => {
    server.nextParagraph();
  });

  globalShortcut.register('PageUp', () => {
    server.prevParagraph();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Encerra o processo do servidor e do app quando todas as janelas forem fechadas
app.on('window-all-closed', () => {
  // Garante a liberação dos atalhos do sistema
  globalShortcut.unregisterAll();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

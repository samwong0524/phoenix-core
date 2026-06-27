import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f0f0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'win32',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
    },
  });

  // Load Next.js dev server or production build
  if (isDev) {
    win.loadURL('http://localhost:3100');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../backend/.next/server/pages/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  // Handle navigation to external URLs
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '\u6253\u5F00 Phoenix-Core',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '\u5FEB\u901F\u547D\u4EE4',
      click: () => {
        mainWindow?.webContents.send('open-quickpick');
      },
    },
    { type: 'separator' },
    {
      label: '\u9000\u51FA',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Phoenix-Core');
  tray.setContextMenu(contextMenu);

  // Flash on notification
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function registerGlobalShortcuts() {
  globalShortcut.register('CommandOrControl+K', () => {
    if (mainWindow) {
      mainWindow.webContents.send('open-quickpick');
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  mainWindow = createMainWindow();
  createTray();
  registerGlobalShortcuts();

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  } else {
    mainWindow?.show();
  }
});

// IPC handlers
ipcMain.handle('platform', () => process.platform);
ipcMain.handle('version', () => app.getVersion());
ipcMain.on('flash-tray', () => {
  tray?.flashFrame?.(true);
});

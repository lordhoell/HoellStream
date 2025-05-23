// main.js
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const configPath = path.join(app.getPath('userData'), 'config.json');

function defaultConfig() {
  return {
    TW_SE_JWT: "",
    TW_SE_CID: "",
    YT_SE_JWT: "",
    YT_SE_CID: "",
    TWITCH_CHANNEL: "",
    TWITCH_OAUTH: "",
    TWITCH_CLIENT_ID: "",
    TWITCH_APP_TOKEN: "",
    YT_API_KEY: "",
    YT_STREAM_ID: ""
  };
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath));
  } catch {
    return defaultConfig();
  }
}

function saveConfig(data) {
  console.log('[saveConfig] Saving config.json');
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

function createWindow(file, options = {}) {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    ...options,
  });

  console.log('[createWindow]', file);
  win.loadFile(file);
  return win;
}

let overlayWin, chatWin, settingsWin;

function createSettingsWindow() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 500,
    height: 600,
    title: 'Edit Config',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => (settingsWin = null));
}

app.whenReady().then(() => {
  setTimeout(() => {
    overlayWin = createWindow('overlay-ws.html', { title: 'Overlay' });
    chatWin = createWindow('chat.html', { title: 'Chat' });

    setTimeout(() => {
      chatWin.reload();
    }, 300);
  }, 400);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Menu',
      submenu: [
        {
          label: 'Edit Config',
          click: () => createSettingsWindow(),
        },
        {
          label: 'Reset Config',
          click: () => {
            const blank = defaultConfig();
            saveConfig(blank);
            setTimeout(() => {
              if (overlayWin) overlayWin.reload();
              if (chatWin) chatWin.reload();
              if (settingsWin) settingsWin.reload();
            }, 500);
          }
        },
    {
      label: 'Toggle DevTools',
      click: () => {
        if (overlayWin) overlayWin.webContents.toggleDevTools();
        if (chatWin)    chatWin.webContents.toggleDevTools();
      }
    },
        { role: 'reload' },
        { role: 'quit' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      overlayWin = createWindow('overlay-ws.html');
      chatWin = createWindow('chat.html');
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('load-config', async () => loadConfig());
ipcMain.handle('save-config', async (e, data) => {
  saveConfig(data);
});

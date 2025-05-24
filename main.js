// main.js
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const fetch = require('node-fetch');

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

function getWindowState(key, defaults) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window-state.json')));
    return state[key] || defaults;
  } catch {
    return defaults;
  }
}

function saveWindowState(key, bounds) {
  const statePath = path.join(app.getPath('userData'), 'window-state.json');
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath));
  } catch {}
  state[key] = bounds;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function createWindow(file, options = {}) {
  const key = file.replace(/\..*$/, ''); // 'overlay-ws' or 'chat'
  const defaults = { width: 800, height: 600 };
  const saved = getWindowState(key, defaults);
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    ...options,
  });
  

  win.on('resize', () => saveWindowState(key, win.getBounds()));
  win.on('move', () => saveWindowState(key, win.getBounds()));

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

// --- Twitch OAuth login integration ---
ipcMain.handle('twitch-login', async (event, { clientId, clientSecret }) => {
  const redirectUri = 'http://localhost:4390/twitch-callback';
  const state = Math.random().toString(36).substring(2, 15);

  // Step 1: Open Twitch OAuth URL
  const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=chat:read+chat:edit+user:read:email+channel:read:subscriptions+channel:read:redemptions+bits:read+channel:moderate+moderation:read+channel:read:hype_train+channel:read:polls+channel:read:predictions+channel:read:goals+channel:read:charity&state=${state}`;
  shell.openExternal(authUrl);

  // Step 2: Start temporary HTTP server to catch redirect
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/twitch-callback')) {
        const urlObj = new URL(`http://localhost:4390${req.url}`);
        const code = urlObj.searchParams.get('code');
        const returnedState = urlObj.searchParams.get('state');

        if (state !== returnedState) {
          res.end('State mismatch. Please try again.');
          server.close();
          return resolve({ success: false });
        }

        // Step 3: Exchange code for token
        try {
          const tokenResp = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri
            })
          });
          const tokenData = await tokenResp.json();

          if (!tokenData.access_token) {
            res.end('Failed to get token.');
            server.close();
            return resolve({ success: false });
          }

          // Step 4: Get user info
          const userResp = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Client-Id': clientId
            }
          });
          const userData = await userResp.json();
          const username = userData.data && userData.data[0] && userData.data[0].login;

          res.end('Twitch login successful! You can close this window.');
          server.close();
          resolve({
            success: true,
            oauth: `oauth:${tokenData.access_token}`,
            channel: username
          });
        } catch (err) {
          res.end('Twitch login failed.');
          server.close();
          resolve({ success: false });
        }
      }
    });
    server.listen(4390);
  });
});

// --- StreamElements OAuth login integration ---
ipcMain.handle('streamelements-login', async (event, { platform }) => {
  // StreamElements OAuth details
  const redirectUri = 'http://localhost:4390/se-callback';
  const state = Math.random().toString(36).substring(2, 15);
  const clientId = 'CLIENT_ID'; // Replace with your StreamElements app client_id

  // Platform-specific scopes and response_type
  let scope = '';
  let sePlatform = '';
  if (platform === 'twitch') {
    scope = 'channels:read chat:read chat:write overlays:read overlays:write tips:read tips:write';
    sePlatform = 'twitch';
  } else if (platform === 'youtube') {
    scope = 'channels:read overlays:read overlays:write';
    sePlatform = 'youtube';
  } else {
    return { success: false };
  }

  // Step 1: Open StreamElements OAuth URL
  const authUrl = `https://streamelements.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&platform=${sePlatform}`;
  shell.openExternal(authUrl);

  // Step 2: Start temporary HTTP server to catch redirect
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/se-callback')) {
        const urlObj = new URL(`http://localhost:4390${req.url}`);
        const code = urlObj.searchParams.get('code');
        const returnedState = urlObj.searchParams.get('state');

        if (state !== returnedState) {
          res.end('State mismatch. Please try again.');
          server.close();
          return resolve({ success: false });
        }

        // Step 3: Exchange code for JWT token
        try {
          const tokenResp = await fetch('https://streamelements.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri
            })
          });
          const tokenData = await tokenResp.json();

          if (!tokenData.access_token) {
            res.end('Failed to get token.');
            server.close();
            return resolve({ success: false });
          }

          // Step 4: Get user/account info
          const userResp = await fetch('https://api.streamelements.com/kappa/v2/users/me', {
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`
            }
          });
          const userData = await userResp.json();

          res.end('StreamElements login successful! You can close this window.');
          server.close();
          resolve({
            success: true,
            jwt: tokenData.access_token,
            accountId: userData._id
          });
        } catch (err) {
          res.end('StreamElements login failed.');
          server.close();
          resolve({ success: false });
        }
      }
    });
    server.listen(4390);
  });
});

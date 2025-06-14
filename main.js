// main.js
const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const fetch = require('node-fetch');

// Import the auth module
const auth = require('./auth');

// Import the YouTube API service
const YouTubeAPIService = require('./youtube-api');

// Import the Twitch API service
const TwitchAPIService = require('./twitch-api');

// Global service instances
let youtubeService = null;
let twitchService = null;

// Helper functions to get paths (lazy-loaded)
function getConfigPath() {
  if (!app || !app.getPath) {
    throw new Error('App not ready - cannot get config path');
  }
  return path.join(app.getPath('userData'), 'config.json');
}

function getTokensPath() {
  return path.join(app.getPath('userData'), 'tokens.secure');
}

function getWindowStatePath() {
  if (!app || !app.getPath) {
    throw new Error('App not ready - cannot get window state path');
  }
  return path.join(app.getPath('userData'), 'window-state.json');
}

function defaultConfig() {
  return {
    TWITCH_CHANNEL: "",
    TWITCH_OAUTH: "",
    TWITCH_CLIENT_ID: "",
    TWITCH_CLIENT_SECRET: "",
    TWITCH_APP_TOKEN: "",
    YOUTUBE_CLIENT_ID: "",
    YOUTUBE_CLIENT_SECRET: "",
    YT_API_KEY: "",
    YT_STREAM_ID: ""
  };
}

// Use auth module but keep backward compatibility
function loadConfig() {
  const config = auth.loadConfig();
  return Object.keys(config).length > 0 ? config : defaultConfig();
}

function saveConfig(data) {
  return auth.saveConfig(data);
}

function getWindowState(key, defaults) {
  try {
    const statePath = getWindowStatePath();
    if (!fs.existsSync(statePath)) {
      return defaults;
    }
    const stateContent = fs.readFileSync(statePath, 'utf8');
    if (!stateContent || stateContent.trim() === '') {
      return defaults;
    }
    const state = JSON.parse(stateContent);
    if (!state[key]) {
      return defaults;
    }
    
    // Ensure all required properties exist
    const savedState = state[key];
    return {
      width: savedState.width || defaults.width,
      height: savedState.height || defaults.height,
      x: typeof savedState.x === 'number' ? savedState.x : defaults.x,
      y: typeof savedState.y === 'number' ? savedState.y : defaults.y,
      zoomLevel: savedState.zoomLevel || defaults.zoomLevel
    };
  } catch (error) {
    return defaults;
  }
}

function saveWindowState(key, data) {
  try {
    const statePath = getWindowStatePath();
    let state = {};
    
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, 'utf8');
      if (content && content.trim() !== '') {
        state = JSON.parse(content);
      }
    }
    
    // Ensure we're saving valid data
    const validData = {
      width: Math.max(100, data.width || 800),
      height: Math.max(100, data.height || 600),
      x: typeof data.x === 'number' ? data.x : undefined,
      y: typeof data.y === 'number' ? data.y : undefined,
      zoomLevel: data.zoomLevel || 1.0
    };
    
    state[key] = validData;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
  }
}

function createWindow(file, options = {}) {
  const key = file.replace(/\..*$/, ''); // 'overlay-ws' or 'chat'
  const defaults = { 
    width: 800, 
    height: 600, 
    x: undefined, 
    y: undefined,
    zoomLevel: 1.0
  };
  const saved = getWindowState(key, defaults);
  
  // Create window with saved dimensions and position
  const windowOptions = {
    width: saved.width,
    height: saved.height,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: saved.zoomLevel || 1.0
    },
    ...options,
  };
  
  // Only set position if we have valid coordinates
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    windowOptions.x = saved.x;
    windowOptions.y = saved.y;
  }
  
  const win = new BrowserWindow(windowOptions);
  
  // Save window state when it changes
  win.on('resize', () => {
    const bounds = win.getBounds();
    const zoomLevel = win.webContents.getZoomFactor();
    saveWindowState(key, { ...bounds, zoomLevel });
  });
  
  win.on('move', () => {
    const bounds = win.getBounds();
    const zoomLevel = win.webContents.getZoomFactor();
    saveWindowState(key, { ...bounds, zoomLevel });
  });
  
  // Save zoom level when it changes
  win.webContents.on('zoom-changed', (event, zoomDirection) => {
    const zoomLevel = win.webContents.getZoomFactor();
    const bounds = win.getBounds();
    saveWindowState(key, { ...bounds, zoomLevel });
  });

  win.loadFile(file);
  
  // Set the zoom level after the page has loaded
  win.webContents.on('did-finish-load', () => {
    if (saved.zoomLevel) {
      win.webContents.setZoomFactor(saved.zoomLevel);
    }
  });
  
  return win;
}

let overlayWin, chatWin, settingsWin;

// Set global reference for YouTube service broadcasting
global.mainWindow = null;

function createSettingsWindow() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }

  const key = 'settings';
  const defaults = { 
    width: 600, 
    height: 800, 
    x: undefined, 
    y: undefined,
    zoomLevel: 1.0
  };
  const saved = getWindowState(key, defaults);

  settingsWin = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    title: 'Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: saved.zoomLevel || 1.0
    }
  });

  // Save window state when it changes
  settingsWin.on('resize', () => {
    const bounds = settingsWin.getBounds();
    const zoomLevel = settingsWin.webContents.getZoomFactor();
    saveWindowState(key, { ...bounds, zoomLevel });
  });
  
  settingsWin.on('move', () => {
    const bounds = settingsWin.getBounds();
    const zoomLevel = settingsWin.webContents.getZoomFactor();
    saveWindowState(key, { ...bounds, zoomLevel });
  });
  
  // Save zoom level when it changes
  settingsWin.webContents.on('zoom-changed', (event, zoomDirection) => {
    const zoomLevel = settingsWin.webContents.getZoomFactor();
    const bounds = settingsWin.getBounds();
    saveWindowState(key, { ...bounds, zoomLevel });
  });

  settingsWin.loadFile('settings.html');
  
  // Set the zoom level after the page has loaded
  settingsWin.webContents.on('did-finish-load', () => {
    if (saved.zoomLevel) {
      settingsWin.webContents.setZoomFactor(saved.zoomLevel);
    }
  });
  
  settingsWin.on('closed', () => (settingsWin = null));
}

app.whenReady().then(() => {
  // Register IPC handlers
  ipcMain.handle('zoom-changed', (event, zoomFactor) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const key = win.getTitle().includes('Chat') ? 'chat' : 'overlay-ws';
      const bounds = win.getBounds();
      saveWindowState(key, { ...bounds, zoomLevel: zoomFactor });
    }
  });

  // Create overlay window
  overlayWin = createWindow('overlay-ws.html');
  global.mainWindow = overlayWin; // Set global reference for YouTube service
  
  // Add close handler to overlay window to trigger full app shutdown
  overlayWin.on('close', () => {
    console.log('[Main] Overlay window closing - triggering full app shutdown...');
    
    // Stop YouTube service and cleanup (this will destroy the scraping window)
    if (youtubeService) {
      console.log('[Main] Stopping YouTube service from overlay close...');
      youtubeService.stop();
      youtubeService = null;
    }
    
    // Stop Twitch service and cleanup
    if (twitchService) {
      console.log('[Main] Stopping Twitch service from overlay close...');
      twitchService.stop();
      twitchService = null;
    }
    
    console.log('[Main] Services stopped from overlay close - quitting app');
    app.quit();
  });

  // Create chat window with offset
  setTimeout(() => {
    chatWin = createWindow('chat.html', { 
      x: 50, 
      y: 50,
      title: 'HoellStream - Chat',
      autoHideMenuBar: true
    });

    setTimeout(() => {
      chatWin.reload();
    }, 300);
  }, 400);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Menu',
      submenu: [
        {
          label: 'Settings',
          click: () => createSettingsWindow(),
        },
        { 
          label: 'Reload',
          click: async () => {
            console.log('[Main] Starting reload process - stopping services...');
            
            // Stop services first to prevent race conditions
            if (youtubeService) {
              console.log('[Main] Stopping YouTube service for reload...');
              await youtubeService.stop();
              youtubeService = null;
            }
            
            if (twitchService) {
              console.log('[Main] Stopping Twitch service for reload...');
              await twitchService.stop();
              twitchService = null;
            }
            
            console.log('[Main] Services stopped - reloading windows...');
            
            // Add longer delay to ensure services are fully cleaned up and windows fully initialize
            setTimeout(() => {
              if (overlayWin) overlayWin.reload();
              if (chatWin) chatWin.reload();
              console.log('[Main] Windows reloaded - waiting for full initialization...');
              
              // Additional delay to ensure windows are fully loaded before allowing service operations
              setTimeout(() => {
                console.log('[Main] Reload process complete - services can be safely restarted');
              }, 2000);
            }, 1000);
          }
        },
        {
          label: 'Toggle Console',
          click: () => {
            if (overlayWin) overlayWin.webContents.toggleDevTools();
            if (chatWin)    chatWin.webContents.toggleDevTools();
          }
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
        { role: 'quit' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      overlayWin = createWindow('overlay-ws.html');
      chatWin = createWindow('chat.html', { autoHideMenuBar: true });
    }
  });
});

app.on('window-all-closed', () => {
  console.log('[Main] All windows closed - cleaning up services...');
  
  // Stop YouTube service and cleanup (this will destroy the scraping window)
  if (youtubeService) {
    console.log('[Main] Stopping YouTube service...');
    youtubeService.stop();
    youtubeService = null;
  }
  
  // Stop Twitch service and cleanup
  if (twitchService) {
    console.log('[Main] Stopping Twitch service...');
    twitchService.stop();
    twitchService = null;
  }
  
  console.log('[Main] Services cleaned up - quitting app');
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  console.log('[Main] App is quitting - ensuring all services are stopped...');
  
  // Stop YouTube service and cleanup (this will destroy the scraping window)
  if (youtubeService) {
    console.log('[Main] Force stopping YouTube service...');
    youtubeService.stop();
    youtubeService = null;
  }
  
  // Stop Twitch service and cleanup
  if (twitchService) {
    console.log('[Main] Force stopping Twitch service...');
    twitchService.stop();
    twitchService = null;
  }
  
  console.log('[Main] All services force stopped');
});

ipcMain.handle('load-config', async () => loadConfig());
ipcMain.handle('save-config', async (e, data) => {
  saveConfig(data);
});

// --- OAuth2 Token Management ---
function loadTokens() {
  try {
    const tokenPath = getTokensPath();
    if (fs.existsSync(tokenPath)) {
      const encrypted = fs.readFileSync(tokenPath);
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted);
    }
  } catch (error) {
  }
  return {};
}

function saveTokens(tokens) {
  try {
    const tokenPath = getTokensPath();
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens, null, 2));
    fs.writeFileSync(tokenPath, encrypted);
    return true;
  } catch (error) {
    return false;
  }
}

async function refreshTwitchToken() {
  const tokens = loadTokens();
  if (!tokens.twitch || !tokens.twitch.refresh_token) {
    return false;
  }

  try {
    const config = loadConfig();
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID,
        client_secret: config.TWITCH_CLIENT_SECRET || process.env.TWITCH_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: tokens.twitch.refresh_token
      })
    });

    const data = await response.json();
    if (data.access_token) {
      tokens.twitch = data;
      saveTokens(tokens);
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function refreshYouTubeToken() {
  const tokens = loadTokens();
  if (!tokens.youtube || !tokens.youtube.refresh_token) {
    return false;
  }

  try {
    const config = loadConfig();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID,
        client_secret: config.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: tokens.youtube.refresh_token
      })
    });

    const data = await response.json();
    if (data.access_token) {
      // YouTube doesn't always return a new refresh token, so preserve the old one
      tokens.youtube = {
        ...data,
        refresh_token: tokens.youtube.refresh_token
      };
      saveTokens(tokens);
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// --- OAuth2 login integration for Twitch and YouTube ---
ipcMain.on('oauth-login', (event, platform) => {
  if (platform === 'twitch') {
    const TWITCH_REDIRECT_URI = 'http://localhost:4391/twitch-callback';
    const TWITCH_SCOPES = [
      'user:read:email',
      'channel:read:subscriptions',
      'channel_subscriptions',
      'moderator:read:followers',
      'channel:read:redemptions',
      'channel:read:charity',
      'bits:read',
      'channel:read:cheers',
      'channel:read:goals',
      'channel:read:hype_train',
      'channel:read:polls',
      'channel:read:predictions',
      'channel:manage:redemptions',
      'chat:read',
      'chat:edit'
    ].join(' ');
    
    // Load config to get client ID for the auth URL
    const config = loadConfig();
    const TWITCH_CLIENT_ID = config.TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID || 'o2z2j4tesfnnq8l3ygjvsf9xu7ngdm'
    
    const state = Math.random().toString(36).slice(2);
    const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(TWITCH_REDIRECT_URI)}&scope=${encodeURIComponent(TWITCH_SCOPES)}&state=${state}`;
    
    shell.openExternal(authUrl);
    
    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/twitch-callback')) {
        const urlObj = new URL(`http://localhost:4390${req.url}`);
        const code = urlObj.searchParams.get('code');
        const returnedState = urlObj.searchParams.get('state');
        
        if (state !== returnedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Failed</h1><p>State mismatch. Please try again.</p>');
          server.close();
          event.sender.send('oauth-result', 'twitch', false);
          return;
        }
        
        try {
          // Load config inside the callback to ensure it's accessible
          const callbackConfig = loadConfig();
          
          // Exchange code for token
          const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: TWITCH_CLIENT_ID,
              client_secret: callbackConfig.TWITCH_CLIENT_SECRET || process.env.TWITCH_CLIENT_SECRET,
              code,
              grant_type: 'authorization_code',
              redirect_uri: TWITCH_REDIRECT_URI
            })
          });
          
          const tokenData = await tokenResponse.json();
          
          if (!tokenData.access_token) {
            throw new Error('Failed to get access token');
          }
          
          // Get user info
          const userResponse = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Client-Id': TWITCH_CLIENT_ID
            }
          });
          
          const userData = await userResponse.json();
          const username = userData.data?.[0]?.login;
          
          if (!username) {
            throw new Error('Failed to get user info');
          }
          
          // Save tokens and user info
          const tokens = loadTokens();
          tokens.twitch = tokenData;
          tokens.twitch.username = username;
          saveTokens(tokens);
          
          // Update config with username
          const configForUpdate = loadConfig();
          configForUpdate.TWITCH_CHANNEL = username;
          saveConfig(configForUpdate);
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Successful</h1><p>You can close this window and return to HoellStream.</p>');
          event.sender.send('oauth-result', 'twitch', true);
        } catch (error) {
          console.error('Twitch authentication error:', error);
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication Failed</h1><p>Error: ${error.message}</p>`);
          event.sender.send('oauth-result', 'twitch', false);
        }
        
        server.close();
      }
    });
    
    server.listen(4391, (err) => {
      if (err) {
        console.error('Failed to start server:', err);
        event.sender.send('oauth-result', 'twitch', false);
      } else {
        console.log('Twitch auth server listening on port 4391');
      }
    });
  } else if (platform === 'youtube') {
    const YOUTUBE_REDIRECT_URI = 'http://localhost:4390/youtube-callback';
    const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';
    
    const YOUTUBE_CLIENT_ID = loadConfig().YOUTUBE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || '260252219634-h6dgs4566l4als3pellkd301avuvdm4a.apps.googleusercontent.com';
    const state = Math.random().toString(36).substring(2, 15);

    // Step 1: Open YouTube OAuth URL
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${YOUTUBE_CLIENT_ID}&redirect_uri=${encodeURIComponent(YOUTUBE_REDIRECT_URI)}&scope=${encodeURIComponent(YOUTUBE_SCOPES)}&access_type=offline&prompt=consent&state=${state}`;
    shell.openExternal(authUrl);

    // Step 2: Start temporary HTTP server to catch redirect
    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/youtube-callback')) {
        console.log('YouTube callback received:', req.url);
        const urlObj = new URL(`http://localhost:4390${req.url}`);
        const code = urlObj.searchParams.get('code');
        const returnedState = urlObj.searchParams.get('state');
        const error = urlObj.searchParams.get('error');
        
        // Check for error parameter from Google OAuth
        if (error) {
          console.error('YouTube auth error:', error);
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication Failed</h1><p>Error: ${error}</p>`);
          server.close();
          event.sender.send('oauth-result', 'youtube', false);
          return;
        }
        
        // Verify state parameter to prevent CSRF
        if (state !== returnedState) {
          console.error('YouTube auth state mismatch');
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Failed</h1><p>State mismatch. Please try again.</p>');
          server.close();
          event.sender.send('oauth-result', 'youtube', false);
          return;
        }
        
        // Check for required code parameter
        if (!code) {
          console.error('YouTube auth missing code parameter');
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Failed</h1><p>Missing authorization code. Please try again.</p>');
          server.close();
          event.sender.send('oauth-result', 'youtube', false);
          return;
        }
        
        try {
          console.log('Received YouTube OAuth code, attempting to exchange for token');
          // Load config inside the callback to ensure it's accessible
          const youtubeConfig = loadConfig();
          
          // Exchange code for token
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: YOUTUBE_CLIENT_ID,
              client_secret: youtubeConfig.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET,
              code,
              grant_type: 'authorization_code',
              redirect_uri: YOUTUBE_REDIRECT_URI
            })
          });

          if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('YouTube token exchange failed:', tokenResponse.status, errorText);
            throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
          }
          
          const tokenData = await tokenResponse.json();
          console.log('YouTube token exchange successful');
          
          if (!tokenData.access_token) {
            throw new Error('Failed to get access token');
          }
          
          // Get YouTube channel info
          console.log('Getting YouTube channel info...');
          const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`
            }
          });
          
          if (!channelResponse.ok) {
            const errorText = await channelResponse.text();
            console.error('YouTube channel info request failed:', channelResponse.status, errorText);
            throw new Error(`Channel info request failed: ${channelResponse.status} ${errorText}`);
          }
          
          const channelData = await channelResponse.json();
          console.log('YouTube channel data received:', JSON.stringify(channelData, null, 2));
          
          const channelId = channelData.items?.[0]?.id;
          const channelTitle = channelData.items?.[0]?.snippet?.title;
          
          if (!channelId) {
            throw new Error('Failed to get channel info - no channel ID found in response');
          }
          
          console.log(`YouTube channel identified: ${channelTitle} (${channelId})`);
          
          
          // Save tokens and channel info
          const tokens = loadTokens();
          tokens.youtube = tokens.youtube || {};
          tokens.youtube.access_token = tokenData.access_token;
          tokens.youtube.scope = tokenData.scope;
          tokens.youtube.token_type = tokenData.token_type;
          if (tokenData.refresh_token) {
            tokens.youtube.refresh_token = tokenData.refresh_token;
          }
          if (tokenData.expires_in) {
            tokens.youtube.expires_at = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
          }
          tokens.youtube.channelId = channelId;
          tokens.youtube.channelTitle = channelTitle;
          console.log('Saving YouTube tokens:', JSON.stringify(tokens.youtube, null, 2));
          saveTokens(tokens);
          
          // Update config with YouTube Stream ID if needed
          const configForUpdate = loadConfig();
          if (!configForUpdate.YT_STREAM_ID) {
            // Fetch all broadcasts for the authed user
            try {
              // First, get the user's channel ID to verify ownership
              console.log('Using authenticated YouTube channel ID:', channelId);
              
              const broadcastsResponse = await fetch(
                'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&broadcastStatus=all&mine=true',
                { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } }
              );
              const broadcastsData = await broadcastsResponse.json();
              
              // Filter broadcasts to only include those from the authenticated user's channel
              const userBroadcasts = broadcastsData.items?.filter(broadcast => {
                const broadcastChannelId = broadcast.snippet?.channelId;
                const isOwnedByUser = broadcastChannelId === channelId;
                
                if (!isOwnedByUser) {
                  console.log('Skipping broadcast not owned by user:', broadcast.id, 
                              'Channel:', broadcastChannelId, 
                              'Title:', broadcast.snippet?.title);
                }
                
                return isOwnedByUser;
              }) || [];
              
              console.log(`Found ${userBroadcasts.length} broadcasts owned by authenticated user`);
              
              let chosenBroadcast = null;
              // 1. Prefer currently live (public or unlisted)
              chosenBroadcast = userBroadcasts.find(
                b => b.status?.lifeCycleStatus === 'live' && ['public', 'unlisted'].includes(b.status?.privacyStatus)
              );
              // 2. If not live, prefer scheduled/upcoming (public or unlisted)
              if (!chosenBroadcast) {
                chosenBroadcast = userBroadcasts.find(
                  b => b.status?.lifeCycleStatus === 'upcoming' && ['public', 'unlisted'].includes(b.status?.privacyStatus)
                );
              }
              
              if (chosenBroadcast) {
                configForUpdate.YT_STREAM_ID = chosenBroadcast.id;
                saveConfig(configForUpdate);
                console.log('Selected YouTube stream:', chosenBroadcast.id, 
                          '\nTitle:', chosenBroadcast.snippet?.title, 
                          '\nStatus:', chosenBroadcast.status?.lifeCycleStatus, 
                          '\nPrivacy:', chosenBroadcast.status?.privacyStatus);
              } else {
                console.log('No suitable YouTube stream found for authed user.');
              }
            } catch (error) {
              console.error('Error getting YouTube stream ID:', error);
            }
          }
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Successful</h1><p>You can close this window and return to HoellStream.</p>');
          event.sender.send('oauth-result', 'youtube', true);
        } catch (error) {
          console.error('YouTube authentication error:', error);
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication Failed</h1><p>Error: ${error.message}</p>`);
          event.sender.send('oauth-result', 'youtube', false);
        }
        
        server.close();
      }
    });
    
    server.listen(4390, (err) => {
      if (err) {
        console.error('Failed to start server:', err);
        event.sender.send('oauth-result', 'youtube', false);
      }
    });
  }
});

// --- Expose auth module functions to renderer process ---
ipcMain.handle('get-tokens', async () => {
  return loadTokens();
});

ipcMain.handle('ensure-twitch-token', async () => {
  return await auth.ensureTwitchToken();
});

ipcMain.handle('ensure-youtube-token', async () => {
  return await auth.ensureYouTubeToken();
});

ipcMain.handle('get-twitch-stream-info', async () => {
  return await auth.getTwitchStreamInfo();
});

ipcMain.handle('get-youtube-stream-info', async () => {
  return await auth.getYouTubeStreamInfo();
});

ipcMain.handle('get-youtube-live-chat-id', async () => {
  const result = await auth.getYouTubeLiveChatId();
  return result;
});

ipcMain.handle('refresh-tokens', async (event, platform) => {
  if (platform === 'twitch') {
    return await refreshTwitchToken();
  } else if (platform === 'youtube') {
    return await refreshYouTubeToken();
  }
  return false;
});

// --- Legacy Twitch OAuth login integration ---
ipcMain.handle('twitch-login', async (event, { clientId, clientSecret }) => {
  const redirectUri = 'http://localhost:4390/twitch-callback';
  const state = Math.random().toString(36).substring(2, 15);

  // Step 1: Open Twitch OAuth URL
  const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=chat:read+chat:edit+user:read:email+channel:read:subscriptions+channel_subscriptions+channel:read:redemptions+bits:read+channel:moderate+moderation:read+channel:read:hype_train+channel:read:polls+channel:read:predictions+channel:read:goals+channel:read:charity&state=${state}`;
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
          // Load config inside the callback to ensure it's accessible
          const config = loadConfig();
          
          // Exchange code for token
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

// OAuth integration is now handled directly for Twitch and YouTube
// StreamElements integration has been removed

// YouTube API service IPC handlers
ipcMain.handle('youtube-api-get-videos', async () => {
  if (!youtubeService) {
    youtubeService = new YouTubeAPIService();
  }
  return await youtubeService.getVideos();
});

ipcMain.handle('youtube-api-get-live-chat-id', async () => {
  if (!youtubeService) {
    youtubeService = new YouTubeAPIService();
  }
  return await youtubeService.getLiveChatId();
});

ipcMain.handle('youtube-api-get-live-chat-messages', async () => {
  if (!youtubeService) {
    youtubeService = new YouTubeAPIService();
  }
  return await youtubeService.getLiveChatMessages();
});

ipcMain.handle('youtube-service-start', async () => {
  try {
    if (!youtubeService) {
      youtubeService = new YouTubeAPIService();
    }
    await youtubeService.start();
    
    // Small delay to ensure status is updated
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if service actually connected successfully
    const isConnected = youtubeService.isRunning && youtubeService.connectionStatus;
    return { 
      success: isConnected, 
      error: isConnected ? null : 'Failed to connect - check OAuth credentials' 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('youtube-service-stop', async () => {
  try {
    if (youtubeService) {
      await youtubeService.stop();
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Process individual YouTube message for emoji replacement (used for retroactive updates)
ipcMain.handle('youtube-process-message', async (event, message) => {
  try {
    if (!youtubeService) {
      youtubeService = new YouTubeAPIService();
    }
    return youtubeService.emojiScraper.processMessage(message);
  } catch (error) {
    console.error('[Main] Failed to process YouTube message for emoji replacement:', error);
    return message; // Return original message if processing fails
  }
});

// Twitch API service IPC handlers
ipcMain.handle('twitch-service-start', async () => {
  try {
    if (!twitchService) {
      twitchService = new TwitchAPIService();
    }
    await twitchService.start();
    
    // Small delay to ensure status is updated
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if service actually connected successfully
    const isConnected = twitchService.isRunning && twitchService.connectionStatus;
    return { 
      success: isConnected, 
      error: isConnected ? null : 'Failed to connect - check OAuth credentials' 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('twitch-service-stop', async () => {
  try {
    if (twitchService) {
      await twitchService.stop();
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('twitch-service-get-data', async () => {
  try {
    if (!twitchService) {
      return { chatMessages: [], events: [], viewerCount: 0, connectionStatus: false };
    }
    return twitchService.getCurrentData();
  } catch (error) {
    return { chatMessages: [], events: [], viewerCount: 0, connectionStatus: false };
  }
});

// Refresh authentication in overlay and chat windows
ipcMain.handle('refresh-overlay-auth', async () => {
  // Tell overlay and chat windows to reload their tokens
  if (overlayWin) {
    overlayWin.webContents.send('reload-tokens');
  }
  if (chatWin) {
    chatWin.webContents.send('reload-tokens');
  }
  return true;
});

// YouTube emoji scraper IPC handlers
ipcMain.handle('youtube-scrape-emojis', async () => {
  try {
    if (!youtubeService) {
      youtubeService = new YouTubeAPIService();
    }
    return await youtubeService.emojiScraper.scrapeEmojis();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('youtube-emoji-cache-status', async () => {
  try {
    if (!youtubeService) {
      youtubeService = new YouTubeAPIService();
    }
    return youtubeService.emojiScraper.getCacheStats();
  } catch (error) {
    return { totalEmojis: 0, error: error.message };
  }
});

ipcMain.handle('youtube-emoji-clear-cache', async () => {
  try {
    if (!youtubeService) {
      youtubeService = new YouTubeAPIService();
    }
    return youtubeService.emojiScraper.clearCache();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Close settings window
ipcMain.on('close-settings', () => {
  if (settingsWin) {
    settingsWin.close();
  }
});

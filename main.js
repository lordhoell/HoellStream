// main.js
const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');

// Import the auth module
const auth = require('./auth');

// Import the YouTube API service
const YouTubeAPIService = require('./youtube-api');

// Import the Twitch API service
const TwitchAPIService = require('./twitch-api');

// Import the Twitch Activity Scraper
const TwitchActivityScraper = require('./twitch-activity-scraper');

// Global service instances
let youtubeService = null;
let twitchService = null;
let twitchActivityScraper = null;

// HTTP API Server
let apiServer = null;
const API_PORT = 3000;

// Event Storage System
const eventStorage = {
  events: [],
  maxEvents: 50,
  
  // Add a new event with deduplication
  addEvent(event) {
    // Generate unique ID if not provided
    if (!event.id) {
      event.id = `${event.platform}_${event.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Check for duplicates
    const existingIndex = this.events.findIndex(e => e.id === event.id);
    if (existingIndex !== -1) {
      console.log('[Event Storage] Duplicate event ignored:', event.id);
      return;
    }
    
    // Add timestamp if not provided
    if (!event.timestamp) {
      event.timestamp = new Date().toISOString();
    }
    
    // Add to events array
    this.events.push(event);
    
    // Keep only the last maxEvents
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    
    console.log('[Event Storage] Event added:', event.type, 'from', event.platform);
  },
  
  // Get all events
  getAllEvents() {
    return [...this.events];
  },
  
  // Get recent events
  getRecentEvents(count) {
    return this.events.slice(-count);
  },
  
  // Get events since timestamp
  getEventsSince(timestamp) {
    const sinceTime = new Date(timestamp).getTime();
    return this.events.filter(event => {
      const eventTime = new Date(event.timestamp).getTime();
      return eventTime > sinceTime;
    });
  },
  
  // Clear all events
  clearEvents() {
    this.events = [];
  }
};

// OBS Chat Dock HTML Generator
function getObsChatHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>HoellStream - OBS Chat Dock</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="stylesheet" href="/obs-chat.css">
</head>
<body>
  <!-- Status bar for connection indicators -->
  <div class="status-bar">
    <div class="platform-indicator">
      <div class="platform-icon-container">
        <div class="connection-status status-disconnected" id="tiktok-status"></div>
        <img class="platform-icon-status" src="https://www.tiktok.com/favicon.ico" alt="TikTok">
      </div>
    </div>
    <div class="platform-indicator">
      <div class="platform-icon-container">
        <div class="connection-status status-disconnected" id="twitch-status"></div>
        <img class="platform-icon-status" src="https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png" alt="Twitch">
      </div>
    </div>
    <div class="platform-indicator">
      <div class="platform-icon-container">
        <div class="connection-status status-disconnected" id="youtube-status"></div>
        <img class="platform-icon-status" src="https://www.youtube.com/favicon.ico" alt="YouTube">
      </div>
    </div>
  </div>

  <div id="chatFeed" class="chat-feed"></div>
  
  <script>
${getObsChatScript()}
  </script>
</body>
</html>`;
}

// Browser-compatible replacement for chat.html script (uses Server-Sent Events)
function getObsChatScript() {
  // Return a complete, self-contained browser script that doesn't rely on parsing the original
  return `
// OBS Chat Browser Script
console.log('[OBS Chat] Starting browser-compatible chat script...');

const feed = document.getElementById('chatFeed');
const icons = {
  tiktok: 'https://www.tiktok.com/favicon.ico',
  twitch: 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png',
  youtube: 'https://www.youtube.com/favicon.ico'
};

// Connection status management
function updateConnectionStatus(service, isConnected) {
  const statusElement = document.getElementById(service + '-status');
  if (statusElement) {
    if (isConnected) {
      statusElement.classList.remove('status-disconnected');
      statusElement.classList.add('status-connected');
    } else {
      statusElement.classList.remove('status-connected');
      statusElement.classList.add('status-disconnected');
    }
  }
  console.log('Updated', service, 'status to:', isConnected ? 'connected' : 'disconnected');
}

// Chat message handling with deduplication
const processedMessages = new Set();

function addChat(platform, displayName, message, avatar, timestamp, hasEmotes, badges) {
  if (!feed) return;
  
  // Check if we've seen this exact message recently (within last 2 seconds)
  const now = Date.now();
  const cleanMessage = message.replace(/\s+/g, ' ').trim(); // Normalize whitespace
  const messageKey = platform + '_' + displayName + '_' + cleanMessage;
  
  // Clean up old entries first
  for (let entry of processedMessages) {
    const [key, timestamp] = entry.split('_TIME_');
    if ((now - parseInt(timestamp)) > 2000) { // 2 second window
      processedMessages.delete(entry);
    }
  }
  
  // Check for recent duplicate
  for (let entry of processedMessages) {
    if (entry.startsWith(messageKey + '_TIME_')) {
      console.log('[OBS Chat] Duplicate message detected, skipping:', platform, displayName, cleanMessage);
      return;
    }
  }
  
  // Add this message to processed set
  processedMessages.add(messageKey + '_TIME_' + now);
  
  console.log('[OBS Chat] Adding new chat message from', platform, ':', displayName, message);
  console.log('[OBS Chat] Avatar URL:', avatar);
  console.log('[OBS Chat] Badges:', badges);
  
  const chatLine = document.createElement('div');
  chatLine.className = 'chat-line';
  
  // Platform icon
  const platformIcon = document.createElement('img');
  platformIcon.className = 'platform-icon';
  platformIcon.src = icons[platform] || icons.twitch;
  platformIcon.alt = platform;
  
  // User avatar - use proper Twitch avatar or fallback
  const userAvatar = document.createElement('img');
  userAvatar.className = 'avatar';
  if (platform === 'twitch' && avatar && (avatar.includes('twitch') || avatar.includes('jtvnw'))) {
    userAvatar.src = avatar;
    console.log('[OBS Chat] Using Twitch avatar:', avatar);
  } else if (platform === 'twitch') {
    // Use Twitch default avatar if no specific avatar provided
    userAvatar.src = 'https://static-cdn.jtvnw.net/jtv_user_pictures/default-profile-image-300x300.png';
    console.log('[OBS Chat] Using default Twitch avatar');
  } else {
    userAvatar.src = avatar || icons[platform] || icons.twitch;
  }
  userAvatar.alt = displayName;
  
  // Username
  const usernameEl = document.createElement('span');
  usernameEl.className = 'username';
  usernameEl.textContent = displayName;
  
  // Badges (for Twitch - placed after username)
  let badgeContainer = null;
  if (badges && badges.length > 0) {
    console.log('[OBS Chat] Adding', badges.length, 'badges after username');
    badgeContainer = document.createElement('span');
    badgeContainer.className = 'badges';
    badges.forEach(badge => {
      if (badge.imageUrl) {
        const badgeImg = document.createElement('img');
        badgeImg.className = 'badge';
        badgeImg.src = badge.imageUrl;
        badgeImg.alt = badge.title || badge.setId;
        badgeImg.style.marginLeft = '4px';
        badgeContainer.appendChild(badgeImg);
        console.log('[OBS Chat] Added badge:', badge.title, badge.imageUrl);
      }
    });
  }
  
  // Message
  const messageEl = document.createElement('span');
  messageEl.className = 'message';
  messageEl.innerHTML = message;
  
  // Assemble the chat line in correct order: Icon -> Avatar -> Username -> Badges -> Message
  chatLine.appendChild(platformIcon);
  chatLine.appendChild(userAvatar);
  chatLine.appendChild(usernameEl);
  if (badgeContainer && badgeContainer.children.length > 0) {
    chatLine.appendChild(badgeContainer);
  }
  chatLine.appendChild(messageEl);
  
  feed.appendChild(chatLine);
  feed.scrollTop = feed.scrollHeight;
}

// YouTube event handling
function handleYouTubeEvent(type, data) {
  console.log('Handling YouTube event:', type, data);
  
  if (type === 'chat') {
    addChat('youtube', data.displayName, data.message, data.avatar, data.timestamp, false, []);
  } else if (type === 'superchat') {
    const message = data.message ? data.message + ' (' + data.amount + ')' : data.amount;
    addChat('youtube', data.author.name, '💰 ' + message, data.author.avatar, data.timestamp, false, []);
  } else if (type === 'sponsor') {
    addChat('youtube', data.author.name, '⭐ New member!', data.author.avatar, data.timestamp, false, []);
  } else if (type === 'jewel_gift') {
    const message = '💎 ' + data.giftName + ' jewels (' + data.jewelCount + ')';
    addChat('youtube', data.author.name, message, data.author.avatar, data.timestamp, false, []);
  }
}

// Twitch badge extraction
function extractTwitchBadges(data) {
  if (!data.badgeData || !Array.isArray(data.badgeData)) return [];
  return data.badgeData.map(badge => ({
    imageUrl: badge.imageUrl,
    title: badge.title,
    setId: badge.setId
  }));
}

// Server-Sent Events connection
console.log('[OBS Chat] Connecting to SSE endpoint...');
const eventSource = new EventSource('/obs-chat-events');

eventSource.onopen = () => {
  console.log('[OBS Chat] SSE connection opened');
};

eventSource.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log('[OBS Chat] Received SSE event:', data.type, data);
    
    if (data.type === 'twitch-chat-message') {
      console.log('[OBS Chat] Processing Twitch message:', data);
      const { username, message, tags, badgeData, avatar } = data;
      const displayName = tags['display-name'] || username;
      const userAvatar = avatar || 'https://static-cdn.jtvnw.net/jtv_user_pictures/default-profile-image-300x300.png';
      console.log('[OBS Chat] Twitch avatar URL:', userAvatar);
      const hasEmotes = message.includes('<img');
      const badges = extractTwitchBadges(data);
      console.log('[OBS Chat] Twitch badges:', badges);
      addChat('twitch', displayName, message, userAvatar, null, hasEmotes, badges);
    } else if (data.type === 'youtube-data-update') {
      console.log('[OBS Chat] Processing YouTube update:', data);
      const updateData = data;
      
      // Only process events array (which contains both chat and other events)
      // Don't process chatMessages separately to avoid duplication
      if (updateData.events && updateData.events.length > 0) {
        console.log('[OBS Chat] Processing', updateData.events.length, 'YouTube events');
        updateData.events.forEach(event => {
          const mappedEvent = {
            ...event,
            avatar: event.author?.avatar || event.avatar || 'https://www.youtube.com/favicon.ico',
            displayName: event.author?.name || event.displayName || event.username || 'Unknown User'
          };
          console.log('[OBS Chat] Processing YouTube event:', event.type, mappedEvent);
          handleYouTubeEvent(event.type, mappedEvent);
        });
      }
      
      // Update connection status
      updateConnectionStatus('youtube', updateData.connectionStatus);
    } else if (data.type === 'services-status') {
      updateConnectionStatus('twitch', data.services.twitch);
      updateConnectionStatus('youtube', data.services.youtube);
      updateConnectionStatus('tiktok', data.services.tiktok);
    } else if (data.type === 'twitch-connection-status') {
      updateConnectionStatus('twitch', data.connectionStatus);
    } else if (data.type === 'youtube-connection-status') {
      updateConnectionStatus('youtube', data.connectionStatus);
    }
  } catch (error) {
    console.error('[OBS Chat] Error processing SSE event:', error);
  }
};

eventSource.onerror = (error) => {
  console.error('[OBS Chat] SSE connection error:', error);
  updateConnectionStatus('twitch', false);
  updateConnectionStatus('youtube', false);
  updateConnectionStatus('tiktok', false);
};

// TikTok WebSocket connection
console.log('[OBS Chat] Connecting to TikTok WebSocket...');
try {
  const tikWs = new WebSocket('ws://localhost:21213/');
  
  tikWs.onopen = () => {
    console.log('[OBS Chat] TikTok WebSocket connected');
    updateConnectionStatus('tiktok', true);
  };
  
  tikWs.onclose = () => {
    console.log('[OBS Chat] TikTok WebSocket disconnected');
    updateConnectionStatus('tiktok', false);
  };
  
  tikWs.onerror = (error) => {
    console.error('[OBS Chat] TikTok WebSocket error:', error);
    updateConnectionStatus('tiktok', false);
  };
  
  tikWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('[OBS Chat] TikTok message:', data);
      
      if (data.event === 'chat' && data.data) {
        const { comment, uniqueId, nickname, profilePictureUrl } = data.data;
        addChat('tiktok', nickname || uniqueId, comment, profilePictureUrl, null, false, []);
      } else if (data.event === 'gift' && data.data) {
        const { giftName, diamond_count, uniqueId, nickname, profilePictureUrl } = data.data;
        const message = '🎁 ' + giftName + (diamond_count ? ' (' + diamond_count + ' diamonds)' : '');
        addChat('tiktok', nickname || uniqueId, message, profilePictureUrl, null, false, []);
      }
    } catch (error) {
      console.error('[OBS Chat] Error processing TikTok message:', error);
    }
  };
} catch (err) {
  console.error('[OBS Chat] Failed to connect to TikTok WebSocket:', err);
  updateConnectionStatus('tiktok', false);
}

console.log('[OBS Chat] Script initialization complete');
`;
}

// Default OBS Chat CSS
function getDefaultObsChatCss() {
  return `body { 
  margin: 0; 
  padding: 0; 
  background: #000; 
  color: #fff; 
  font-family: sans-serif; 
}

.chat-feed { 
  height: 100vh; 
  overflow-y: auto; 
  padding: 10px; 
  box-sizing: border-box; 
  font-size: 25px; 
  padding-top: 40px;
}

.chat-line { 
  display: flex; 
  align-items: center; 
  margin-bottom: 16px; 
}

.platform-icon, .avatar { 
  width: 28px; 
  height: 28px; 
  border-radius: 50%; 
  flex-shrink: 0; 
}

.platform-icon { 
  margin-right: 12px; 
}

.avatar { 
  margin-right: 10px; 
}

.username { 
  font-weight: bold; 
  color: #c47cff; 
  margin-right: 8px; 
}

.message { 
  flex: 1; 
  color: #fff; 
  word-break: break-word; 
}

.gift-icon, .emote { 
  vertical-align: middle; 
  max-height: 28px; 
}

.gift-icon {
  height: 20px;
  margin: 0 4px;
}

.emote {
  height: 24px;
  margin: 0 2px;
  display: inline-block;
}

/* Connection status indicators */
.status-bar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  display: flex;
  justify-content: flex-start;
  background: rgba(0,0,0,0.8);
  padding: 5px;
  z-index: 100;
}

.platform-indicator {
  position: relative;
  margin-right: 15px;
  display: flex;
  align-items: center;
}

.platform-icon-container {
  position: relative;
  width: 28px;
  height: 28px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-right: 8px;
}

.platform-icon-status {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  z-index: 2;
  margin: 0;
}

.connection-status {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  z-index: 1;
  transition: background-color 0.3s ease;
}

.status-connected {
  background-color: rgba(0, 255, 0, 0.3);
  box-shadow: 0 0 8px rgba(0, 255, 0, 0.5);
}

.status-disconnected {
  background-color: rgba(255, 0, 0, 0.3);
  box-shadow: 0 0 8px rgba(255, 0, 0, 0.5);
}

/* Badge styling */
.badge {
  font-size: 20px;
  height: 24px;
  vertical-align: middle;
  margin-right: 4px;
}

.badge img {
  height: 24px;
  width: auto;
  vertical-align: middle;
  margin-right: 4px;
}

.badges {
  margin-left: 0;
}`;
}

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

function getColorsPath() {
  if (!app || !app.getPath) {
    throw new Error('App not ready - cannot get colors path');
  }
  return path.join(app.getPath('userData'), 'colors.json');
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

function defaultColors() {
  return {
    TEXT_COLOR: "#FFFFFF",      // White text
    THEME_COLOR: "#9353ff",     // Purple theme
    BACKGROUND_COLOR: "#000000" // Black background
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

function loadColors() {
  try {
    const colorsPath = getColorsPath();
    if (fs.existsSync(colorsPath)) {
      const colorsData = fs.readFileSync(colorsPath, 'utf8');
      const colors = JSON.parse(colorsData);
      
      // Ensure all color properties exist with defaults
      const defaults = defaultColors();
      return {
        TEXT_COLOR: colors.TEXT_COLOR || defaults.TEXT_COLOR,
        THEME_COLOR: colors.THEME_COLOR || defaults.THEME_COLOR,
        BACKGROUND_COLOR: colors.BACKGROUND_COLOR || defaults.BACKGROUND_COLOR
      };
    }
  } catch (error) {
    console.error('Error loading colors:', error);
  }
  
  return defaultColors();
}

function saveColors(colors) {
  try {
    const colorsPath = getColorsPath();
    const colorsData = JSON.stringify(colors, null, 2);
    fs.writeFileSync(colorsPath, colorsData, 'utf8');
    console.log('Colors saved successfully:', colors);
    return true;
  } catch (error) {
    console.error('Error saving colors:', error);
    return false;
  }
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
  // Initialize Express API Server
  const apiApp = express();
  
  // Middleware
  apiApp.use(cors());
  apiApp.use(express.json());
  
  // Logging middleware
  apiApp.use((req, res, next) => {
    console.log(`[API] ${req.method} ${req.path}`);
    next();
  });
  
  // API Routes
  
  // Health check endpoint
  apiApp.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      eventCount: eventStorage.events.length,
      services: {
        twitch: twitchService ? twitchService.isRunning : false,
        youtube: youtubeService ? youtubeService.isRunning : false,
        tiktok: false // TikTok is handled via WebSocket in overlay
      }
    });
  });
  
  // Get all recent events
  apiApp.get('/api/events', (req, res) => {
    const events = eventStorage.getAllEvents();
    res.json({
      count: events.length,
      events: events
    });
  });
  
  // Get specific number of recent events
  apiApp.get('/api/events/recent/:count', (req, res) => {
    const count = parseInt(req.params.count) || 10;
    const events = eventStorage.getRecentEvents(count);
    res.json({
      count: events.length,
      events: events
    });
  });
  
  // Get events since timestamp
  apiApp.get('/api/events/since/:timestamp', (req, res) => {
    try {
      const timestamp = req.params.timestamp;
      const events = eventStorage.getEventsSince(timestamp);
      res.json({
        count: events.length,
        events: events
      });
    } catch (error) {
      res.status(400).json({
        error: 'Invalid timestamp format'
      });
    }
  });
  
  // Serve OBS chat dock page (modified chat.html)
  apiApp.get('/obs-chat', (req, res) => {
    // Always use our custom HTML with the clean script
    res.send(getObsChatHtml());
  });
  
  // Serve OBS chat CSS separately for customization
  apiApp.get('/obs-chat.css', (req, res) => {
    const cssPath = path.join(__dirname, 'obs-chat.css');
    if (fs.existsSync(cssPath)) {
      res.type('text/css').sendFile(cssPath);
    } else {
      // Return default CSS if file doesn't exist
      res.type('text/css').send(getDefaultObsChatCss());
    }
  });
  
  // Serve favicon to prevent 404 errors
  apiApp.get('/favicon.ico', (req, res) => {
    const iconPath = path.join(__dirname, 'icon.ico');
    if (fs.existsSync(iconPath)) {
      res.sendFile(iconPath);
    } else {
      // Return 204 No Content if no favicon
      res.status(204).end();
    }
  });
  
  // Server-Sent Events endpoint for OBS chat
  const obsChatClients = new Set();
  
  apiApp.get('/obs-chat-events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    // Add client to set
    obsChatClients.add(res);
    console.log(`[SSE] OBS chat client connected. Total clients: ${obsChatClients.size}`);
    
    // Send initial status
    const services = {
      twitch: twitchService ? twitchService.isRunning : false,
      youtube: youtubeService ? youtubeService.isRunning : false,
      tiktok: false // TikTok connects directly via WebSocket
    };
    res.write(`data: ${JSON.stringify({type: 'services-status', services})}\n\n`);
    
    // Remove client on disconnect
    req.on('close', () => {
      obsChatClients.delete(res);
      console.log(`[SSE] OBS chat client disconnected. Total clients: ${obsChatClients.size}`);
    });
  });
  
  // Function to broadcast to all OBS chat clients
  global.broadcastToObsChat = (eventData) => {
    if (obsChatClients.size === 0) return;
    
    console.log(`[SSE] Broadcasting to ${obsChatClients.size} OBS clients:`, eventData.type, eventData);
    const message = `data: ${JSON.stringify(eventData)}\n\n`;
    obsChatClients.forEach(client => {
      try {
        client.write(message);
      } catch (error) {
        // Remove broken connections
        obsChatClients.delete(client);
        console.log('[SSE] Removed broken client connection');
      }
    });
  };
  
  // Error handling middleware
  apiApp.use((err, req, res, next) => {
    console.error('[API] Error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message
    });
  });
  
  // Start API server
  apiServer = apiApp.listen(API_PORT, () => {
    console.log(`[API] HTTP API server listening on port ${API_PORT}`);
  });
  
  // Register IPC handlers
  ipcMain.handle('zoom-changed', (event, zoomFactor) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const key = win.getTitle().includes('Chat') ? 'chat' : 'overlay-ws';
      const bounds = win.getBounds();
      saveWindowState(key, { ...bounds, zoomLevel: zoomFactor });
    }
  });

  ipcMain.on('stream-event', (event, eventData) => {
    console.log('[Main] Received stream event:', eventData.type, 'from', eventData.platform);
    eventStorage.addEvent(eventData);
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
    
    // Stop Twitch Activity Scraper and cleanup
    if (twitchActivityScraper) {
      console.log('[Main] Stopping Twitch Activity Scraper from overlay close...');
      twitchActivityScraper.stop();
      twitchActivityScraper = null;
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
      
      // Load and apply saved colors after windows are ready
      setTimeout(() => {
        loadAndApplyColors();
      }, 10);
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
            
            // Stop Twitch Activity Scraper and cleanup
            if (twitchActivityScraper) {
              console.log('[Main] Stopping Twitch Activity Scraper for reload...');
              await twitchActivityScraper.stop();
              twitchActivityScraper = null;
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
            if (settingsWin) settingsWin.webContents.toggleDevTools();
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
  
  // Stop Twitch Activity Scraper and cleanup
  if (twitchActivityScraper) {
    console.log('[Main] Stopping Twitch Activity Scraper...');
    twitchActivityScraper.stop();
    twitchActivityScraper = null;
  }
  
  // Stop API server
  if (apiServer) {
    console.log('[Main] Stopping API server...');
    apiServer.close();
    apiServer = null;
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
  
  // Stop Twitch Activity Scraper and cleanup
  if (twitchActivityScraper) {
    console.log('[Main] Force stopping Twitch Activity Scraper...');
    twitchActivityScraper.stop();
    twitchActivityScraper = null;
  }
  
  // Stop API server
  if (apiServer) {
    console.log('[Main] Force stopping API server...');
    apiServer.close();
    apiServer = null;
  }
  
  console.log('[Main] All services force stopped');
});

// Load and apply saved colors to all windows
function loadAndApplyColors() {
  const colors = loadColors();
  console.log('Loading and applying saved colors:', colors);
  
  // Apply colors to chat window
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('text-color-update', colors.TEXT_COLOR);
    chatWin.webContents.send('background-color-update', colors.BACKGROUND_COLOR);
    chatWin.webContents.send('events-color-update', colors.THEME_COLOR);
  }
  
  // Apply colors to overlay window
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('background-color-update', colors.BACKGROUND_COLOR);
    overlayWin.webContents.send('events-color-update', colors.THEME_COLOR);
  }
}

ipcMain.handle('load-config', async () => loadConfig());
ipcMain.handle('save-config', async (e, data) => {
  saveConfig(data);
  
  // Broadcast font size changes to all windows
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(win => {
    win.webContents.send('font-size-update', {
      chatFontSize: data.CHAT_FONT_SIZE,
      overlayFontSize: data.OVERLAY_FONT_SIZE,
      statsFontSize: data.STATS_FONT_SIZE,
      usernameFontSize: data.USERNAME_FONT_SIZE
    });
  });
});

// Test event handlers for font size testing
ipcMain.on('test-overlay-events', (event, testEvents) => {
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(win => {
    // Find overlay window by checking if it has overlay-specific content
    win.webContents.executeJavaScript(`
      !!document.querySelector('.stats-wrapper') || !!document.querySelector('#youtube-status')
    `).then(isOverlay => {
      if (isOverlay) {
        // Send test events to overlay
        testEvents.forEach((testEvent, index) => {
          setTimeout(() => {
            // Handle TikTok gift events differently
            if (testEvent.type === 'tiktok-gift') {
              // Send as TikTok websocket data
              win.webContents.executeJavaScript(`
                if (window.handleTikTokMessage) {
                  window.handleTikTokMessage({
                    event: 'gift',
                    ...${JSON.stringify(testEvent)}
                  });
                }
              `);
            } else {
              // Send other events as YouTube data
              win.webContents.send('youtube-data-update', {
                events: [testEvent],
                connectionStatus: 'connected'
              });
            }
          }, index * 500); // Stagger the events
        });
      }
    }).catch(() => {
      // Ignore errors from checking window content
    });
  });
});

ipcMain.on('test-chat-messages', (event, testMessages) => {
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(win => {
    // Find chat window by checking if it has chat-specific content
    win.webContents.executeJavaScript(`
      !!document.querySelector('.chat-feed') || !!document.getElementById('chatFeed')
    `).then(isChat => {
      if (isChat) {
        // Send test messages to chat based on platform
        testMessages.forEach((testMessage, index) => {
          setTimeout(() => {
            switch(testMessage.platform) {
              case 'youtube':
                // Send as YouTube event
                win.webContents.send('youtube-data-update', {
                  events: [{
                    type: 'chat',
                    author: {
                      name: testMessage.displayName,
                      avatar: testMessage.avatar
                    },
                    message: testMessage.message,
                    displayName: testMessage.displayName,
                    avatar: testMessage.avatar
                  }],
                  connectionStatus: 'connected'
                });
                break;
              case 'tiktok':
                // Send as TikTok WebSocket message simulation
                win.webContents.executeJavaScript(`
                  if (window.handleTikTokMessage) {
                    window.handleTikTokMessage({
                      event: 'chat',
                      data: {
                        comment: '${testMessage.message.replace(/'/g, "\\'")}',
                        uniqueId: '${testMessage.username}',
                        nickname: '${testMessage.displayName}',
                        profilePictureUrl: '${testMessage.avatar}',
                        isModerator: false,
                        isSubscriber: false,
                        emotes: []
                      }
                    });
                  }
                `);
                break;
              case 'twitch':
              default:
                // Send as Twitch message
                win.webContents.send('twitch-chat-message', {
                  username: testMessage.username,
                  message: testMessage.message,
                  tags: { 'display-name': testMessage.displayName }
                });
                break;
            }
          }, index * 800); // Stagger the messages
        });
      }
    }).catch(() => {
      // Ignore errors from checking window content
    });
  });
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
          res.status(400).json({
            error: 'Invalid timestamp format'
          });
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

// Twitch Activity Scraper IPC handlers
ipcMain.handle('twitch-activity-scraper-start', async () => {
  try {
    if (!twitchActivityScraper) {
      twitchActivityScraper = new TwitchActivityScraper();
    }
    await twitchActivityScraper.start();
    
    // Small delay to ensure status is updated
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return { 
      success: true, 
      message: 'Twitch Activity Scraper started successfully' 
    };
  } catch (error) {
    console.error('[Main] Failed to start Twitch Activity Scraper:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('twitch-activity-scraper-stop', async () => {
  try {
    if (twitchActivityScraper) {
      await twitchActivityScraper.stop();
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('twitch-activity-scraper-get-events', async () => {
  try {
    if (!twitchActivityScraper) {
      return { events: [], isRunning: false };
    }
    
    // Get the latest scraped events
    const events = twitchActivityScraper.getLatestEvents();
    const isRunning = twitchActivityScraper.isRunning;
    
    return { events, isRunning };
  } catch (error) {
    console.error('[Main] Failed to get activity scraper events:', error);
    return { events: [], isRunning: false };
  }
});

ipcMain.handle('twitch-activity-scraper-navigate-manually', async () => {
  try {
    if (!twitchActivityScraper) {
      return { success: false, error: 'Scraper not initialized' };
    }
    
    const result = await twitchActivityScraper.navigateToActivityFeedManually();
    return { success: result };
  } catch (error) {
    console.error('[Main] Failed to navigate manually:', error);
    return { success: false, error: error.message };
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

// YouTube Jewel scraping IPC handlers
ipcMain.handle('youtube-start-jewel-scraping', async () => {
  try {
    // Verify YouTube service is available
    if (!youtubeService) {
      return { 
        success: false, 
        error: 'YouTube service not initialized. Please start YouTube service first.' 
      };
    }
    
    // Check if YouTube service is running
    if (!youtubeService.isRunning) {
      return { 
        success: false, 
        error: 'YouTube service is not running. Please start YouTube service first.' 
      };
    }
    
    // Start Jewel scraping
    youtubeService.emojiScraper.startJewelScraping();
    
    return { 
      success: true, 
      message: 'Jewel scraping started successfully' 
    };
  } catch (error) {
    console.error('[Main] Failed to start Jewel scraping:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('youtube-stop-jewel-scraping', async () => {
  try {
    // Verify YouTube service is available
    if (!youtubeService) {
      return { 
        success: false, 
        error: 'YouTube service not initialized' 
      };
    }
    
    // Stop Jewel scraping
    youtubeService.emojiScraper.stopJewelScraping();
    
    return { 
      success: true, 
      message: 'Jewel scraping stopped successfully' 
    };
  } catch (error) {
    console.error('[Main] Failed to stop Jewel scraping:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('youtube-get-jewel-stats', async () => {
  try {
    // Verify YouTube service is available
    if (!youtubeService) {
      return { 
        totalJewels: 0, 
        jewelEventCount: 0, 
        isScrapingActive: false,
        error: 'YouTube service not initialized' 
      };
    }
    
    // Get Jewel statistics from the service
    const serviceData = youtubeService.getCurrentData();
    const totalJewels = serviceData.totalJewels || 0;
    const jewelEventCount = youtubeService.jewelGiftEvents ? youtubeService.jewelGiftEvents.length : 0;
    const isScrapingActive = youtubeService.emojiScraper.jewelScrapingInterval !== null;
    
    return { 
      success: true,
      totalJewels: totalJewels,
      jewelEventCount: jewelEventCount,
      isScrapingActive: isScrapingActive,
      serviceRunning: youtubeService.isRunning
    };
  } catch (error) {
    console.error('[Main] Failed to get Jewel stats:', error);
    return { 
      totalJewels: 0, 
      jewelEventCount: 0, 
      isScrapingActive: false,
      error: error.message 
    };
  }
});

// Handle text color updates from settings and relay to chat window
ipcMain.on('update-text-color', (event, textColor) => {
  console.log('Relaying text color update to chat window:', textColor);
  
  // Save color
  const colors = loadColors();
  colors.TEXT_COLOR = textColor;
  saveColors(colors);
  
  // Send to chat window
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('text-color-update', textColor);
  }
});

// Handle background color updates from settings and relay to both windows
ipcMain.on('update-background-color', (event, backgroundColor) => {
  console.log('Relaying background color update to chat and overlay windows:', backgroundColor);
  
  // Save color
  const colors = loadColors();
  colors.BACKGROUND_COLOR = backgroundColor;
  saveColors(colors);
  
  // Send to chat window
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('background-color-update', backgroundColor);
  }
  
  // Send to overlay window
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('background-color-update', backgroundColor);
  }
});

// Handle events color updates from settings and relay to overlay and chat windows
ipcMain.on('update-events-color', (event, eventsColor) => {
  console.log('Relaying events color update to overlay and chat windows:', eventsColor);
  
  // Save color
  const colors = loadColors();
  colors.THEME_COLOR = eventsColor;
  saveColors(colors);
  
  // Send to overlay window
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('events-color-update', eventsColor);
  }
  
  // Send to chat window
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('events-color-update', eventsColor);
  }
});

// Get current colors for settings window
ipcMain.handle('get-colors', () => {
  return loadColors();
});

// Close settings window
ipcMain.on('close-settings', () => {
  if (settingsWin) {
    settingsWin.close();
  }
});

// Handle platform visibility updates from settings
ipcMain.on('update-platform-visibility', (event, data) => {
  console.log(`[Main] Platform visibility update: ${data.platform} = ${data.visible}`);
  
  // Forward to overlay window
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('update-platform-visibility', data);
  }
});

// IPC handler for stream events from renderer
ipcMain.on('stream-event', (event, eventData) => {
  console.log('[Main] Received stream event:', eventData.type, 'from', eventData.platform);
  
  // Validate event data
  if (!eventData.platform || !eventData.type) {
    console.error('[Main] Invalid event data - missing platform or type');
    return;
  }
  
  // Add event to storage
  eventStorage.addEvent(eventData);
});

// Handle test TikTok events
ipcMain.on('test-overlay-events', (event, testEvents) => {
  console.log('[Main] Received test TikTok events:', testEvents.length);
  testEvents.forEach(testEvent => {
    if (overlayWin && overlayWin.webContents) {
      overlayWin.webContents.executeJavaScript(`
        if (typeof handleTikTokMessage === 'function') {
          handleTikTokMessage(${JSON.stringify(testEvent)});
        }
      `);
    }
  });
});

// Handle test Twitch events
ipcMain.on('test-twitch-events', (event, testEvents) => {
  console.log('[Main] Received test Twitch events:', testEvents.length);
  testEvents.forEach(testEvent => {
    if (overlayWin && overlayWin.webContents) {
      const jsCode = `
        console.log('[Overlay] Executing Twitch test event:', '${testEvent.type}');
        if (typeof handleTwitchEvent === 'function') {
          console.log('[Overlay] handleTwitchEvent function found, calling with:', ${JSON.stringify(testEvent.data)});
          handleTwitchEvent('${testEvent.type}', ${JSON.stringify(testEvent.data)});
        } else {
          console.error('[Overlay] handleTwitchEvent function not found!');
        }
      `;
      overlayWin.webContents.executeJavaScript(jsCode).catch(err => {
        console.error('[Main] Error executing Twitch test event:', err);
      });
    }
  });
});

// Handle test YouTube events
ipcMain.on('test-youtube-events', (event, testEvents) => {
  console.log('[Main] Received test YouTube events:', testEvents.length);
  testEvents.forEach(testEvent => {
    if (overlayWin && overlayWin.webContents) {
      const jsCode = `
        console.log('[Overlay] Executing YouTube test event:', '${testEvent.type}');
        if (typeof handleYouTubeEvent === 'function') {
          console.log('[Overlay] handleYouTubeEvent function found, calling with:', ${JSON.stringify(testEvent.data)});
          handleYouTubeEvent('${testEvent.type}', ${JSON.stringify(testEvent.data)});
        } else {
          console.error('[Overlay] handleYouTubeEvent function not found!');
        }
      `;
      overlayWin.webContents.executeJavaScript(jsCode).catch(err => {
        console.error('[Main] Error executing YouTube test event:', err);
      });
    }
  });
});

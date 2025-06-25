const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const fetch = require('node-fetch');

// Import auth functions
const { ensureTwitchToken, loadTokens, loadConfig } = require('./auth.js');

class TwitchAPIService {
  constructor() {
    this.isRunning = false;
    this.ircSocket = null;
    this.reconnectInterval = null;
    this.viewerCountInterval = null;
    this.followerPollingInterval = null; // Add follower polling interval
    this.channelName = null;
    this.channelId = null;
    
    // Data stores
    this.chatMessages = [];
    this.events = [];
    this.viewerCount = 0;
    this.connectionStatus = false;
    
    // Avatar cache to reduce API calls
    this.avatarCache = new Map(); // Map of username -> { avatar, timestamp }
    
    // Badge cache for official Twitch badge images
    this.badgeCache = new Map(); // Map of set_id -> Map of id -> { image_url, title, description }
    this.badgeCacheTimestamp = null;
    this.BADGE_CACHE_TTL = 3600000; // 1 hour cache for badges
    
    // Gift subscription tracking (like YouTube gift memberships)
    this.giftQueue = new Map(); // Map of gifterUserId -> { name, avatar, remainingGifts, timestamp }
    
    // Follower tracking
    this.knownFollowers = new Set(); // Track known followers to detect new ones
    this.lastFollowerCheck = null; // Timestamp of last follower check
    this.isInitialFollowerLoad = true; // Flag to track if this is the first follower fetch
    
    // Configuration
    this.MAX_CHAT_HISTORY = 200; // Keep last 200 chat messages
    this.MAX_EVENT_HISTORY = 100; // Keep last 100 events
    this.AVATAR_CACHE_TTL = 3600000; // 1 hour cache for avatars
    this.GIFT_QUEUE_TTL = 300000; // 5 minutes for gift queue
    this.RECONNECT_DELAY = 5000; // 5 seconds
    this.FOLLOWER_POLL_INTERVAL = 30000; // 30 seconds for follower polling
    
    console.log('[Twitch API Service] Initialized');
  }

  // Start the service
  async start() {
    if (this.isRunning) {
      console.log('[Twitch API Service] Already running');
      return;
    }

    console.log('[Twitch API Service] Starting...');
    this.isRunning = true;
    this.connectionStatus = false;
    
    // Reset follower tracking on service start
    this.isInitialFollowerLoad = true;
    this.knownFollowers.clear();
  
    // Initialize events array if not already done
    if (!this.events) {
      this.events = [];
    }
  
    // Get channel name from OAuth token validation
    try {
      const hasToken = await ensureTwitchToken();
      if (!hasToken) {
        console.error('[Twitch API Service] No valid Twitch token available - stopping service');
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
        this.stop();
        return;
      }
      
      // Load tokens to get access token
      const tokens = loadTokens();
      if (!tokens?.twitch?.access_token) {
        console.error('[Twitch API Service] No Twitch access token found - stopping service');
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
        this.stop();
        return;
      }
      
      // Validate token and get username
      const validateResponse = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { 'Authorization': `OAuth ${tokens.twitch.access_token}` }
      });
      
      if (!validateResponse.ok) {
        console.error('[Twitch API Service] Token validation failed:', validateResponse.status);
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
        this.stop();
        return;
      }
      
      const validateData = await validateResponse.json();
      this.channelName = validateData.login; // This is the username from token validation
      
      if (!this.channelName) {
        console.error('[Twitch API Service] No channel name found in token validation');
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
        this.stop();
        return;
      }
      
      console.log(`[Twitch API Service] Channel name from OAuth: ${this.channelName}`);
      
      // Get channel ID for follower API
      const userResponse = await fetch(
        `https://api.twitch.tv/helix/users?login=${this.channelName}`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.twitch.access_token}`,
            'Client-Id': loadConfig().TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID || 'o2z2j4tesfnnq8l3ygjvsf9xu7ngdm'
          }
        }
      );
      
      if (userResponse.ok) {
        const userData = await userResponse.json();
        if (userData.data && userData.data.length > 0) {
          this.channelId = userData.data[0].id;
          console.log(`[Twitch API Service] Channel ID: ${this.channelId}`);
          
          // Fetch badge data now that we have channel ID
          await this.fetchBadges();
        }
      } else {
        console.warn('[Twitch API Service] Failed to get channel ID - follower detection may not work');
      }
      
    } catch (error) {
      console.error('[Twitch API Service] Error during token validation:', error);
      this.connectionStatus = false;
      this.broadcastConnectionStatus();
      this.stop();
      return;
    }
    
    // Connect to Twitch IRC
    await this.connectToIRC();
    
    console.log('[Twitch API Service] Started');
  }

  // Fetch viewer count from Twitch API
  async fetchViewerCount() {
    try {
      if (!this.channelName) {
        return;
      }

      const tokens = loadTokens();
      const config = loadConfig();
      
      if (!tokens?.twitch?.access_token) {
        return;
      }

      const response = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${this.channelName}`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.twitch.access_token}`,
            'Client-Id': config.TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID || 'o2z2j4tesfnnq8l3ygjvsf9xu7ngdm'
          }
        }
      );

      if (!response.ok) {
        console.warn(`[Twitch API Service] Failed to fetch viewer count: ${response.status}`);
        return;
      }

      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        // Stream is live
        this.viewerCount = data.data[0].viewer_count || 0;
        console.log(`[Twitch API Service] Updated viewer count: ${this.viewerCount}`);
      } else {
        // Stream is offline
        this.viewerCount = 0;
      }

    } catch (error) {
      console.error('[Twitch API Service] Error fetching viewer count:', error);
    }
  }

  // Start polling for viewer count updates
  startViewerCountPolling() {
    // Poll every 30 seconds for viewer count
    this.viewerCountInterval = setInterval(async () => {
      if (this.isRunning && this.connectionStatus) {
        await this.fetchViewerCount();
        // Broadcast viewer count update (without events)
        this.broadcastViewerCountUpdate();
      }
    }, 30000); // 30 seconds

    // Initial fetch
    this.fetchViewerCount();
  }

  // Stop viewer count polling
  stopViewerCountPolling() {
    if (this.viewerCountInterval) {
      clearInterval(this.viewerCountInterval);
      this.viewerCountInterval = null;
    }
  }

  // Broadcast viewer count update only
  broadcastViewerCountUpdate() {
    const data = {
      events: [], // No events, just viewer count update
      viewerCount: this.viewerCount || 0,
      connectionStatus: this.connectionStatus,
      lastUpdate: new Date().toISOString()
    };

    console.log(`[Twitch API Service] Broadcasting viewer count update: ${data.viewerCount}`);

    // Broadcast to all windows
    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    
    allWindows.forEach(win => {
      if (win && win.webContents && !win.isDestroyed()) {
        try {
          win.webContents.send('twitch-data-update', data);
        } catch (error) {
          console.error(`[Twitch API Service] Failed to send viewer count to window ${win.id}:`, error);
        }
      }
    });
  }

  // Stop the service
  stop() {
    if (!this.isRunning) {
      console.log('[Twitch API Service] Not running');
      return;
    }

    console.log('[Twitch API Service] Stopping...');
    this.isRunning = false;
    this.connectionStatus = false;
    
    // Close IRC connection
    if (this.ircSocket) {
      this.ircSocket.close();
      this.ircSocket = null;
    }
    
    // Clear reconnect timer
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    
    // Stop viewer count polling
    this.stopViewerCountPolling();
    
    // Stop follower polling
    this.stopFollowerPolling();
    
    // Broadcast final status
    this.broadcastConnectionStatus();
    
    console.log('[Twitch API Service] Stopped');
  }

  // Connect to Twitch IRC WebSocket
  async connectToIRC() {
    try {
      // Ensure we have a valid token
      console.log('[Twitch API Service] Checking token validity...');
      const tokenValid = await ensureTwitchToken();
      if (!tokenValid) {
        console.log('[Twitch API Service] Token validation failed - no credentials available');
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
        // Don't schedule reconnect if we have no credentials
        console.log('[Twitch API Service] Stopping service - no OAuth credentials configured');
        this.stop();
        return;
      }

      const tokens = loadTokens();
      const twitchToken = tokens.twitch?.access_token;
      
      if (!twitchToken) {
        console.error('[Twitch API Service] No Twitch access token available');
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
        // Don't schedule reconnect if we have no token
        console.log('[Twitch API Service] Stopping service - no access token available');
        this.stop();
        return;
      }

      console.log('[Twitch API Service] Connecting to Twitch IRC...');
      
      // Close existing connection if any
      if (this.ircSocket) {
        this.ircSocket.close();
      }

      // Create WebSocket connection
      this.ircSocket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

      this.ircSocket.onopen = () => {
        console.log('[Twitch API Service] IRC WebSocket connected');
        
        // Request capabilities for rich message data
        this.ircSocket.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
        
        // Authenticate
        this.ircSocket.send(`PASS oauth:${twitchToken}`);
        this.ircSocket.send(`NICK ${this.channelName}`);
        
        // Join channel
        this.ircSocket.send(`JOIN #${this.channelName}`);
        
        this.connectionStatus = true;
        this.broadcastConnectionStatus();
        
        console.log(`[Twitch API Service] Joined channel: #${this.channelName}`);
        
        // Start viewer count polling
        this.startViewerCountPolling();
        
        // Start follower polling
        this.startFollowerPolling();
      };

      this.ircSocket.onmessage = (event) => {
        this.handleIRCMessage(event.data);
      };

      this.ircSocket.onclose = () => {
        console.log('[Twitch API Service] IRC WebSocket closed');
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
        
        if (this.isRunning) {
          this.scheduleReconnect();
        }
      };

      this.ircSocket.onerror = (error) => {
        console.error('[Twitch API Service] IRC WebSocket error:', error);
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
      };

    } catch (error) {
      console.error('[Twitch API Service] Error connecting to IRC:', error);
      this.connectionStatus = false;
      this.broadcastConnectionStatus();
      // Only schedule reconnect for network errors, not credential errors
      if (this.isRunning) {
        this.scheduleReconnect();
      }
    }
  }

  // Schedule reconnection
  scheduleReconnect() {
    if (!this.isRunning) return;
    
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
    }
    
    console.log(`[Twitch API Service] Scheduling reconnect in ${this.RECONNECT_DELAY}ms`);
    this.reconnectInterval = setTimeout(() => {
      this.connectToIRC();
    }, this.RECONNECT_DELAY);
  }

  // Handle IRC messages
  handleIRCMessage(rawMessage) {
    try {
      // Handle PING/PONG to keep connection alive
      if (rawMessage.startsWith('PING')) {
        this.ircSocket.send('PONG :tmi.twitch.tv');
        return;
      }

      // Parse IRC message with tags
      const message = this.parseIRCMessage(rawMessage);
      if (!message) return;

      console.log('[Twitch API Service] Parsed IRC message:', message);

      // Handle different message types
      switch (message.command) {
        case 'PRIVMSG':
          this.handleChatMessage(message);
          break;
        case 'USERNOTICE':
          this.handleUserNotice(message);
          break;
        case 'CLEARCHAT':
        case 'CLEARMSG':
          // Handle moderation actions if needed
          break;
        case 'ROOMSTATE':
        case 'USERSTATE':
        case 'GLOBALUSERSTATE':
          // Handle state changes if needed
          break;
        case 'NOTICE':
          console.log('[Twitch API Service] Notice:', message.params);
          break;
        case 'RECONNECT':
          console.log('[Twitch API Service] Server requested reconnect');
          this.connectToIRC();
          break;
      }
    } catch (error) {
      console.error('[Twitch API Service] Error handling IRC message:', error);
    }
  }

  // Parse IRC message with IRCv3 tags
  parseIRCMessage(rawMessage) {
    const message = {
      tags: {},
      prefix: null,
      command: null,
      params: []
    };

    let position = 0;

    // Parse tags (if present)
    if (rawMessage[0] === '@') {
      const nextSpace = rawMessage.indexOf(' ');
      const rawTags = rawMessage.slice(1, nextSpace);
      
      rawTags.split(';').forEach(tag => {
        const [key, value] = tag.split('=');
        message.tags[key] = value || null;
      });
      
      position = nextSpace + 1;
    }

    // Parse prefix (if present)
    if (rawMessage[position] === ':') {
      const nextSpace = rawMessage.indexOf(' ', position);
      message.prefix = rawMessage.slice(position + 1, nextSpace);
      position = nextSpace + 1;
    }

    // Parse command
    const nextSpace = rawMessage.indexOf(' ', position);
    if (nextSpace === -1) {
      message.command = rawMessage.slice(position);
      return message;
    }
    
    message.command = rawMessage.slice(position, nextSpace);
    position = nextSpace + 1;

    // Parse parameters
    while (position < rawMessage.length) {
      if (rawMessage[position] === ':') {
        message.params.push(rawMessage.slice(position + 1));
        break;
      }
      
      const nextSpace = rawMessage.indexOf(' ', position);
      if (nextSpace === -1) {
        message.params.push(rawMessage.slice(position));
        break;
      }
      
      message.params.push(rawMessage.slice(position, nextSpace));
      position = nextSpace + 1;
    }

    return message;
  }

  // Handle chat messages
  async handleChatMessage(message) {
    const username = message.prefix.split('!')[0];
    const displayName = message.tags['display-name'] || username;
    const text = message.params[1];
    
    if (!username || !text) return;

    // Get user avatar
    const avatar = await this.getUserAvatar(username);

    // Parse emotes
    const emotesTag = message.tags.emotes;
    const parsedText = this.parseEmotes(text, emotesTag);

    // Check for bits/cheers in the message
    const bits = parseInt(message.tags.bits) || 0;
    if (bits > 0) {
      // This is a bits/cheer event
      this.events.push({
        type: 'bits',
        username: username,
        displayName: username,
        avatar: avatar,
        amount: bits,
        message: parsedText,
        timestamp: new Date().toISOString(),
        author: {
          name: username,
          avatar: avatar
        }
      });
      
      console.log(`[Twitch API Service] Bits event: ${username} cheered ${bits} bits`);
      
      // Broadcast the bits event to overlay
      this.broadcastUpdates();
    }

    // Add to chat messages
    this.chatMessages.push({
      username: username,
      displayName: displayName,
      message: parsedText,
      avatar: avatar,
      timestamp: new Date().toISOString(),
      bits: bits
    });

    // Trim chat history
    if (this.chatMessages.length > this.MAX_CHAT_HISTORY) {
      this.chatMessages = this.chatMessages.slice(-this.MAX_CHAT_HISTORY);
    }

    // Broadcast chat message to chat window
    this.broadcastChatMessage({
      username,
      message: parsedText, // Send the actual text content, not the message object
      tags: message.tags,
      badgeData: this.extractBadgeData(message.tags) // Add badge data
    });
  }

  // Handle user notices (subs, gifts, raids, etc.)
  async handleUserNotice(message) {
    const msgId = message.tags['msg-id'];
    const username = message.tags['display-name'] || message.tags.login;
    const systemMsg = message.tags['system-msg']?.replace(/\\s/g, ' ');
    
    console.log(`[Twitch API Service] User notice: ${msgId} from ${username}`);
    console.log(`[Twitch API Service] System message: ${systemMsg}`);

    const avatar = await this.getUserAvatar(username);

    switch (msgId) {
      case 'sub':
      case 'resub':
        // Regular subscription
        this.events.push({
          type: 'subscriber',
          username: username,
          displayName: username,
          avatar: avatar,
          months: parseInt(message.tags['msg-param-cumulative-months']) || 1,
          tier: message.tags['msg-param-sub-plan'] || '1000',
          message: message.params[1] || '',
          timestamp: new Date().toISOString(),
          author: {
            name: username,
            avatar: avatar
          }
        });
        break;

      case 'subgift':
        // Gift subscription
        const recipient = message.tags['msg-param-recipient-display-name'] || message.tags['msg-param-recipient-user-name'];
        const recipientAvatar = await this.getUserAvatar(recipient);
        
        // Track gifter in gift queue
        const gifterId = message.tags['user-id'];
        if (gifterId) {
          const existingGift = this.giftQueue.get(gifterId);
          if (existingGift) {
            existingGift.remainingGifts += 1;
          } else {
            this.giftQueue.set(gifterId, {
              name: username,
              avatar: avatar,
              remainingGifts: 1,
              timestamp: Date.now()
            });
          }
        }

        // Add gift received event for recipient
        this.events.push({
          type: 'gift_subscription',
          username: recipient,
          displayName: recipient,
          avatar: recipientAvatar,
          gifter: username,
          gifterAvatar: avatar,
          tier: message.tags['msg-param-sub-plan'] || '1000',
          timestamp: new Date().toISOString(),
          author: {
            name: recipient,
            avatar: recipientAvatar
          }
        });
        break;

      case 'submysterygift':
        // Mystery gift purchase (like YouTube membershipGiftingEvent)
        const giftCount = parseInt(message.tags['msg-param-mass-gift-count']) || 1;
        
        // Store in gift queue for matching recipients
        const mysteryGifterId = message.tags['user-id'];
        if (mysteryGifterId) {
          this.giftQueue.set(mysteryGifterId, {
            name: username,
            avatar: avatar,
            remainingGifts: giftCount,
            timestamp: Date.now()
          });
        }

        // Add gifting summary event
        this.events.push({
          type: 'gift_purchase',
          username: username,
          displayName: username,
          avatar: avatar,
          giftCount: giftCount,
          tier: message.tags['msg-param-sub-plan'] || '1000',
          timestamp: new Date().toISOString(),
          author: {
            name: username,
            avatar: avatar
          }
        });
        break;

      case 'raid':
        // Raid event
        const viewerCount = parseInt(message.tags['msg-param-viewerCount']) || 0;
        this.events.push({
          type: 'raid',
          username: username,
          displayName: username,
          avatar: avatar,
          viewerCount: viewerCount,
          timestamp: new Date().toISOString(),
          author: {
            name: username,
            avatar: avatar
          }
        });
        break;

      default:
        console.log(`[Twitch API Service] Unhandled user notice: ${msgId}`);
        break;
    }

    // Clean up expired gift queue entries
    this.cleanupGiftQueue();
    
    // Broadcast the new event to overlay
    this.broadcastUpdates();
  }

  // Clean up expired gift queue entries
  cleanupGiftQueue() {
    const now = Date.now();
    for (const [key, gift] of this.giftQueue.entries()) {
      if (now - gift.timestamp > this.GIFT_QUEUE_TTL) {
        this.giftQueue.delete(key);
      }
    }
  }

  // Get user avatar with caching
  async getUserAvatar(username) {
    if (!username) return '';

    // Check cache first
    const cached = this.avatarCache.get(username.toLowerCase());
    if (cached && (Date.now() - cached.timestamp) < this.AVATAR_CACHE_TTL) {
      return cached.avatar;
    }

    try {
      // Ensure we have a valid token
      const tokenValid = await ensureTwitchToken();
      if (!tokenValid) {
        return '';
      }

      const tokens = loadTokens();
      const config = loadConfig();
      const clientId = config.TWITCH_CLIENT_ID;
      const accessToken = tokens.twitch?.access_token;

      if (!clientId || !accessToken) {
        console.error('[Twitch API Service] Missing client ID or access token for avatar fetch');
        return '';
      }

      const response = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': clientId
        }
      });

      if (!response.ok) {
        console.error(`[Twitch API Service] Failed to fetch avatar for ${username}:`, response.status);
        return '';
      }

      const data = await response.json();
      const avatar = data.data?.[0]?.profile_image_url || '';

      // Cache the result
      this.avatarCache.set(username.toLowerCase(), {
        avatar: avatar,
        timestamp: Date.now()
      });

      return avatar;
    } catch (error) {
      console.error(`[Twitch API Service] Error fetching avatar for ${username}:`, error);
      return '';
    }
  }

  // Broadcast updates to all renderer processes (like YouTube service)
  broadcastUpdates() {
    console.log('=== TWITCH BROADCAST UPDATES CALLED ===');
    
    // Ensure events array is always defined
    if (!this.events) {
      this.events = [];
    }

    const data = {
      events: this.events.slice(), // Send copy of current events
      viewerCount: this.viewerCount || 0,
      connectionStatus: this.connectionStatus,
      lastUpdate: new Date().toISOString()
    };

    console.log('=== TWITCH DATA TO BROADCAST ===', JSON.stringify(data, null, 2));

    // Only broadcast if we have actual events OR this is a connection status update
    if (data.events.length === 0 && !data.connectionStatus) {
      console.log('[Twitch API Service] Skipping broadcast - no events and not connected');
      return;
    }

    console.log(`[Twitch API Service] Broadcasting ${data.events.length} events, viewerCount: ${data.viewerCount}, connected: ${data.connectionStatus}`);
    if (data.events.length > 0) {
      console.log('[Twitch API Service] Events:', data.events.map(e => `${e.type}: ${e.displayName || e.username}`));
    }

    // Clear events after broadcasting to avoid duplicates
    this.events = [];

    // Broadcast to all windows
    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    
    if (allWindows.length === 0) {
      console.log('[Twitch API Service] No windows available for broadcast');
      return;
    }

    allWindows.forEach(win => {
      if (win && win.webContents && !win.isDestroyed()) {
        try {
          // CRITICAL: Validate data before sending
          if (!data || typeof data !== 'object') {
            console.error(`[Twitch API Service] INVALID DATA for window ${win.id}:`, data);
            return;
          }
          
          console.log(`[Twitch API Service] Sending to window ${win.id}:`, data);
          win.webContents.send('twitch-data-update', data);
          console.log(`[Twitch API Service] Successfully sent to window ${win.id}`);
        } catch (error) {
          console.error(`[Twitch API Service] Failed to send to window ${win.id}:`, error);
        }
      }
    });
  }

  // Broadcast connection status
  broadcastConnectionStatus() {
    const data = {
      connectionStatus: this.connectionStatus
    };

    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    
    if (allWindows.length === 0) {
      console.log('[Twitch API Service] No windows available for broadcast');
      return;
    }

    allWindows.forEach(win => {
      if (win && win.webContents && !win.isDestroyed()) {
        try {
          win.webContents.send('twitch-connection-status', data);
          console.log(`[Twitch API Service] Sent connection status to window ${win.id}`);
        } catch (error) {
          console.error(`[Twitch API Service] Failed to send connection status to window ${win.id}:`, error);
        }
      }
    });
  }

  // Broadcast chat message to chat window
  broadcastChatMessage(data) {
    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    
    allWindows.forEach(win => {
      if (win && win.webContents && !win.isDestroyed()) {
        try {
          win.webContents.send('twitch-chat-message', data);
          console.log(`[Twitch API Service] Sent chat message to window ${win.id}`);
        } catch (error) {
          console.error(`[Twitch API Service] Failed to send chat message to window ${win.id}:`, error);
        }
      }
    });
  }

  // Parse Twitch emotes from IRC tags
  parseEmotes(messageText, emotesTag) {
    if (!emotesTag || !messageText) {
      return messageText;
    }

    console.log(`[Twitch API Service] Parsing emotes: ${emotesTag} for message: ${messageText}`);

    // Parse emotes tag format: "25:0-4,12-16/1902:6-10"
    const emoteReplacements = [];
    
    emotesTag.split('/').forEach(emoteData => {
      const [emoteId, positions] = emoteData.split(':');
      if (!emoteId || !positions) return;
      
      positions.split(',').forEach(position => {
        const [start, end] = position.split('-').map(Number);
        if (isNaN(start) || isNaN(end)) return;
        
        const emoteName = messageText.substring(start, end + 1);
        const emoteUrl = `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/1.0`;
        
        emoteReplacements.push({
          start,
          end: end + 1,
          emoteName,
          emoteUrl,
          emoteId
        });
      });
    });

    // Sort by start position (descending) to replace from end to beginning
    emoteReplacements.sort((a, b) => b.start - a.start);

    // Replace emotes with HTML img tags
    let parsedMessage = messageText;
    emoteReplacements.forEach(emote => {
      const emoteHtml = `<img src="${emote.emoteUrl}" alt="${emote.emoteName}" title="${emote.emoteName}" class="twitch-emote" style="height: 1.5em; vertical-align: middle;">`;
      parsedMessage = parsedMessage.substring(0, emote.start) + emoteHtml + parsedMessage.substring(emote.end);
    });

    console.log(`[Twitch API Service] Parsed message with emotes: ${parsedMessage}`);
    return parsedMessage;
  }

  // Extract badge data from IRC tags for chat window
  extractBadgeData(tags) {
    const badgeData = [];
    
    // Parse badges tag (format: "moderator/1,subscriber/12,vip/1")
    const badgesTag = tags.badges || '';
    const badgesList = badgesTag.split(',').filter(b => b.trim());
    
    badgesList.forEach(badgeStr => {
      const [setId, id] = badgeStr.split('/');
      if (setId && id) {
        const imageUrl = this.getBadgeImageUrl(setId, id, '2x');
        const badgeInfo = this.getBadgeInfo(setId, id);
        
        if (imageUrl && badgeInfo) {
          badgeData.push({
            setId: setId,
            id: id,
            imageUrl: imageUrl,
            title: badgeInfo.title,
            description: badgeInfo.description
          });
        }
      }
    });
    
    console.log(`[Twitch API Service] Extracted ${badgeData.length} badge images for user`);
    return badgeData;
  }

  // Get current data (for IPC requests)
  getCurrentData() {
    return {
      chatMessages: this.chatMessages,
      events: this.events,
      viewerCount: this.viewerCount,
      connectionStatus: this.connectionStatus,
      lastUpdate: new Date(),
      isRunning: this.isRunning
    };
  }

  // Start polling for follower updates
  startFollowerPolling() {
    // Poll every 30 seconds for followers
    this.followerPollingInterval = setInterval(async () => {
      if (this.isRunning && this.connectionStatus) {
        await this.fetchFollowers();
      }
    }, this.FOLLOWER_POLL_INTERVAL); // 30 seconds

    // Initial fetch
    this.fetchFollowers();
  }

  // Stop follower polling
  stopFollowerPolling() {
    if (this.followerPollingInterval) {
      clearInterval(this.followerPollingInterval);
      this.followerPollingInterval = null;
    }
  }

  // Fetch followers from Twitch API
  async fetchFollowers() {
    try {
      if (!this.channelName || !this.channelId) {
        return;
      }

      const tokens = loadTokens();
      const config = loadConfig();
      
      if (!tokens?.twitch?.access_token) {
        return;
      }

      // Use the correct Helix API endpoint for followers
      const response = await fetch(
        `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${this.channelId}&first=20`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.twitch.access_token}`,
            'Client-Id': config.TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID || 'o2z2j4tesfnnq8l3ygjvsf9xu7ngdm'
          }
        }
      );

      if (!response.ok) {
        console.warn(`[Twitch API Service] Failed to fetch followers: ${response.status} ${response.statusText}`);
        return;
      }

      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        // On initial load, just populate known followers without creating events
        if (this.isInitialFollowerLoad) {
          console.log('[Twitch API Service] Initial follower load - populating known followers without events');
          for (const follower of data.data) {
            this.knownFollowers.add(follower.user_id);
          }
          this.isInitialFollowerLoad = false;
          console.log(`[Twitch API Service] Populated ${this.knownFollowers.size} existing followers`);
          return;
        }
        
        // Process followers - only add new ones we haven't seen before
        const newFollowers = [];
        
        for (const follower of data.data) {
          if (!this.knownFollowers.has(follower.user_id)) {
            this.knownFollowers.add(follower.user_id);
            
            // Get user avatar
            const avatar = await this.getUserAvatar(follower.user_name);
            
            newFollowers.push({
              type: 'follower',
              username: follower.user_name,
              displayName: follower.user_name,
              avatar: avatar,
              timestamp: new Date().toISOString(),
              author: {
                name: follower.user_name,
                avatar: avatar
              }
            });
          }
        }
        
        // Add new follower events
        if (newFollowers.length > 0) {
          this.events.push(...newFollowers);
          console.log(`[Twitch API Service] Added ${newFollowers.length} new followers`);
          
          // Broadcast follower updates
          this.broadcastUpdates();
        }
        
        console.log(`[Twitch API Service] Total known followers: ${this.knownFollowers.size}`);
      } else {
        console.log('[Twitch API Service] No followers found in response');
      }

    } catch (error) {
      console.error('[Twitch API Service] Error fetching followers:', error);
    }
  }

  // Fetch and cache Twitch badge images
  async fetchBadges() {
    try {
      const now = Date.now();
      
      // Check if cache is still valid
      if (this.badgeCacheTimestamp && (now - this.badgeCacheTimestamp) < this.BADGE_CACHE_TTL) {
        console.log('[Twitch API Service] Using cached badges');
        return;
      }

      console.log('[Twitch API Service] Fetching fresh badge data...');
      
      const tokens = loadTokens();
      if (!tokens?.twitch?.access_token) {
        console.warn('[Twitch API Service] No access token for badge fetching');
        return;
      }

      const headers = {
        'Authorization': `Bearer ${tokens.twitch.access_token}`,
        'Client-Id': loadConfig().TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID || 'o2z2j4tesfnnq8l3ygjvsf9xu7ngdm'
      };

      // Fetch global badges
      const globalResponse = await fetch('https://api.twitch.tv/helix/chat/badges/global', { headers });
      if (globalResponse.ok) {
        const globalData = await globalResponse.json();
        this.processBadgeData(globalData.data, 'global');
      }

      // Fetch channel-specific badges if we have a channel ID
      if (this.channelId) {
        const channelResponse = await fetch(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${this.channelId}`, { headers });
        if (channelResponse.ok) {
          const channelData = await channelResponse.json();
          this.processBadgeData(channelData.data, 'channel');
        }
      }

      this.badgeCacheTimestamp = now;
      console.log(`[Twitch API Service] Badge cache updated with ${this.badgeCache.size} badge sets`);

    } catch (error) {
      console.error('[Twitch API Service] Error fetching badges:', error);
    }
  }

  // Process badge data from API response
  processBadgeData(badgeData, source) {
    if (!badgeData || !Array.isArray(badgeData)) return;

    badgeData.forEach(badgeSet => {
      const setId = badgeSet.set_id;
      
      if (!this.badgeCache.has(setId)) {
        this.badgeCache.set(setId, new Map());
      }
      
      const versionMap = this.badgeCache.get(setId);
      
      badgeSet.versions.forEach(version => {
        versionMap.set(version.id, {
          image_url_1x: version.image_url_1x,
          image_url_2x: version.image_url_2x,
          image_url_4x: version.image_url_4x,
          title: version.title,
          description: version.description,
          source: source
        });
      });
      
      console.log(`[Twitch API Service] Cached ${badgeSet.versions.length} versions for ${setId} badge (${source})`);
    });
  }

  // Get badge image URL for a specific badge
  getBadgeImageUrl(setId, id, size = '2x') {
    const badgeSet = this.badgeCache.get(setId);
    if (!badgeSet) return null;
    
    const badge = badgeSet.get(id);
    if (!badge) return null;
    
    // Return the appropriate size image URL
    switch (size) {
      case '1x': return badge.image_url_1x;
      case '4x': return badge.image_url_4x;
      default: return badge.image_url_2x;
    }
  }

  // Get badge info for a specific badge
  getBadgeInfo(setId, id) {
    const badgeSet = this.badgeCache.get(setId);
    if (!badgeSet) return null;
    
    return badgeSet.get(id) || null;
  }
}

// Export the service class
module.exports = TwitchAPIService;

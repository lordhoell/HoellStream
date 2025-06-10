const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Import auth functions
const { ensureYouTubeToken, getYouTubeLiveChatId, loadTokens, loadConfig } = require('./auth.js');

// Import YouTube emoji scraper
const YouTubeEmojiScraper = require('./youtube-emoji-scraper.js');

class YouTubeAPIService {
  constructor() {
    this.isRunning = false;
    this.pollingInterval = null;
    this.liveChatId = null;
    this.nextPageToken = null;
    this.processedMessageIds = new Set();
    this.lastPollTime = null;
    
    // Data stores
    this.chatMessages = [];
    this.events = [];
    this.viewerCount = 0;
    this.connectionStatus = false;
    
    // Gift membership tracking
    this.giftQueue = new Map(); // Map of gifterChannelId -> { name, avatar, remainingGifts, timestamp }
    
    // YouTube emoji scraper
    this.emojiScraper = new YouTubeEmojiScraper();
    
    // Set up callback for when new emojis are found
    this.emojiScraper.setEmojiCacheUpdateCallback((newEmojiCount) => {
      this.handleEmojiCacheUpdate(newEmojiCount);
    });
    
    // Polling configuration
    this.POLL_INTERVAL = 10000; // 10 seconds
    this.MAX_CHAT_HISTORY = 200; // Keep last 200 chat messages
    this.MAX_EVENT_HISTORY = 100; // Keep last 100 events
    
    console.log('[YouTube API Service] Initialized');
  }

  // Start the polling service
  async start() {
    if (this.isRunning) {
      console.log('[YouTube API Service] Already running');
      return;
    }

    console.log('[YouTube API Service] Starting...');
    this.isRunning = true;
    this.connectionStatus = false;
    
    // Initialize events array if not already done
    if (!this.events) {
      this.events = [];
    }
    
    // Start periodic emoji scraping
    this.emojiScraper.startPeriodicScraping();
    
    // Start polling immediately
    await this.pollYouTubeData();
    
    // Set up interval for continuous polling
    this.pollingInterval = setInterval(() => {
      this.pollYouTubeData();
    }, this.POLL_INTERVAL);
    
    console.log('[YouTube API Service] Started with polling interval:', this.POLL_INTERVAL);
  }

  // Stop the polling service
  stop() {
    console.log('[YouTube API Service] STOP CALLED');
    if (!this.isRunning) {
      console.log('[YouTube API Service] Not running');
      return;
    }

    console.log('[YouTube API Service] Stopping...');
    this.isRunning = false;
    this.connectionStatus = false;
    
    // Stop periodic emoji scraping
    this.emojiScraper.stopPeriodicScraping();
    
    // Cleanup scraping window
    this.emojiScraper.destroy();
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    // Clear data
    this.liveChatId = null;
    this.nextPageToken = null;
    this.processedMessageIds.clear();
    this.chatMessages = [];
    this.events = [];
    this.viewerCount = 0;
    
    // Broadcast final disconnected status
    this.broadcastConnectionStatus();
    this.broadcastUpdates();
    
    console.log('[YouTube API Service] Stopped');
  }

  // Main polling function
  async pollYouTubeData() {
    console.log('=== [YouTube API Service] STARTING POLL CYCLE ===');
    console.log('[YouTube API Service] Current state:', {
      isRunning: this.isRunning,
      connectionStatus: this.connectionStatus,
      liveChatId: this.liveChatId,
      eventsCount: this.events?.length || 0
    });
    
    // Exit early if service is not running
    if (!this.isRunning) {
      console.log('[YouTube API Service] ❌ Service is not running - skipping poll cycle');
      return;
    }
    
    try {
      // Ensure we have a valid token
      console.log('[YouTube API Service] Checking token validity...');
      const tokenValid = await ensureYouTubeToken();
      if (!tokenValid) {
        console.log('[YouTube API Service] ❌ Token validation failed - no credentials available');
        this.connectionStatus = false;
        this.broadcastConnectionStatus();
        
        // Check if we have any tokens at all (not just expired)
        const tokens = loadTokens();
        if (!tokens?.youtube?.access_token && !tokens?.youtube?.refresh_token) {
          console.log('[YouTube API Service] No OAuth credentials configured - stopping service');
          this.stop();
          return;
        }
        
        // If we have tokens but validation failed, continue polling (might be network issue)
        console.log('[YouTube API Service] Have tokens but validation failed - will retry next cycle');
        return;
      }
      console.log('[YouTube API Service] ✅ Token is valid');

      // Set connection status to true immediately after successful authentication
      const wasDisconnected = !this.connectionStatus;
      this.connectionStatus = true;
      
      // Broadcast connection status immediately if we just connected
      if (wasDisconnected) {
        console.log('[YouTube API Service] ✅ Successfully authenticated - broadcasting connected status immediately');
        this.broadcastConnectionStatus();
      }

      // Get live chat ID if we don't have one
      if (!this.liveChatId) {
        console.log('[YouTube API Service] Getting live chat ID...');
        const liveChatResult = await getYouTubeLiveChatId();
        
        // Check if the stream has ended (special return value)
        if (liveChatResult && liveChatResult.ended) {
          console.log('[YouTube API Service] ❌ Stream has ended - stopping polling to save API quota');
          this.stop(); // Stop the service entirely
          return;
        }
        
        // Check if this is a scheduled stream without chat ID yet
        if (liveChatResult && liveChatResult.scheduled) {
          console.log('[YouTube API Service] ✅ Found scheduled stream:', liveChatResult.scheduledTime);
          console.log('[YouTube API Service] Stream is scheduled but chat not available yet - will continue polling until stream starts and chat becomes available...');
          return; // Skip message fetching but maintain connected status
        }
        
        this.liveChatId = liveChatResult;
        if (!this.liveChatId) {
          console.log('[YouTube API Service] ❌ No live chat ID available - not currently live streaming');
          console.log('[YouTube API Service] Will continue polling to check for live status...');
        } else {
          console.log(`[YouTube API Service] ✅ Using live chat ID: ${this.liveChatId}`);
        }
      }

      // Only fetch messages and stats if we have a live chat ID
      if (this.liveChatId) {
        // Fetch live chat messages and events
        console.log('[YouTube API Service] Fetching live chat messages...');
        await this.fetchLiveChatMessages();
        
        // Fetch viewer statistics
        console.log('[YouTube API Service] Fetching viewer stats...');
        await this.fetchViewerStats();
        
        this.lastPollTime = new Date();
        
        console.log('=== [YouTube API Service] POLL CYCLE COMPLETED SUCCESSFULLY ===');
      } else {
        console.log('=== [YouTube API Service] POLL CYCLE COMPLETED (NO ACTIVE STREAM) ===');
      }
      
      console.log('[YouTube API Service] Final state:', {
        eventsCount: this.events?.length || 0,
        viewerCount: this.viewerCount,
        connectionStatus: this.connectionStatus
      });
      
      // Broadcast updates to renderer processes
      console.log('[YouTube API Service] About to broadcast updates...');
      this.broadcastUpdates();
      
    } catch (error) {
      console.error('=== [YouTube API Service] ERROR DURING POLLING ===', error);
      this.connectionStatus = false;
      this.broadcastConnectionStatus();
    }
  }

  // Fetch live chat messages and process events
  async fetchLiveChatMessages() {
    try {
      console.log('[YouTube API Service] Loading tokens...');
      const tokens = loadTokens();
      if (!tokens?.youtube?.access_token) {
        throw new Error('No YouTube access token available');
      }
      console.log('[YouTube API Service] YouTube token found');

      const url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${this.liveChatId}&part=snippet,authorDetails&maxResults=200${this.nextPageToken ? `&pageToken=${this.nextPageToken}` : ''}`;
      console.log('[YouTube API Service] Fetching from URL:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${tokens.youtube.access_token}`
        }
      });

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json();
          if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
            console.warn('[YouTube API Service] Quota exceeded, backing off');
            return;
          }
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[YouTube API Service] Received ${data.items?.length || 0} messages`);
      this.nextPageToken = data.nextPageToken;

      if (data.items && data.items.length > 0) {
        this.processMessages(data.items);
      } else {
        console.log('[YouTube API Service] No new messages to process');
      }

    } catch (error) {
      console.error('[YouTube API Service] Error fetching live chat messages:', error);
      throw error;
    }
  }

  // Process individual messages and categorize them
  processMessages(messages) {
    console.log(`[YouTube API Service] Processing ${messages.length} messages`);
    const newChatMessages = [];
    const newEvents = [];

    for (const message of messages) {
      // Skip if we've already processed this message
      if (this.processedMessageIds.has(message.id)) {
        continue;
      }
      
      console.log(`[YouTube API Service] Processing new message: ${message.id}, type: ${message.snippet.type}`);
      this.processedMessageIds.add(message.id);
      
      const messageType = message.snippet.type;
      const authorDetails = message.authorDetails;
      const snippet = message.snippet;

      switch (messageType) {
        case 'textMessageEvent':
          console.log(`[YouTube API Service] Processing text message from ${authorDetails.displayName}`);
          console.log(`[YouTube API Service] Message details:`, {
            displayMessage: snippet.displayMessage,
            textMessageDetails: snippet.textMessageDetails
          });
          
          // Add detailed logging for emoji debugging
          console.log(`[YouTube API Service] 🔍 EMOJI DEBUG - Full textMessageDetails:`, JSON.stringify(snippet.textMessageDetails, null, 2));
          
          // Process message with emoji/emote support
          const messageText = this.processMessageRuns(snippet.textMessageDetails) || snippet.displayMessage || '';
          
          console.log(`[YouTube API Service] 📝 Final processed message: "${messageText}"`);
          console.log(`[YouTube API Service] 📝 Original displayMessage: "${snippet.displayMessage}"`);
          console.log(`[YouTube API Service] 📝 Original messageText: "${snippet.textMessageDetails?.messageText}"`);
          
          if (!messageText) {
            console.warn(`[YouTube API Service] No message text found for message ${message.id}`);
            continue;
          }
          
          const textMessage = {
            id: message.id,
            timestamp: snippet.publishedAt,
            displayName: authorDetails.displayName,
            username: authorDetails.displayName,
            avatar: authorDetails.profileImageUrl,
            message: messageText,
            channelId: authorDetails.channelId,
            isChatOwner: authorDetails.isChatOwner,
            isChatSponsor: authorDetails.isChatSponsor,
            isChatModerator: authorDetails.isChatModerator
          };
          
          newChatMessages.push(textMessage);
          
          // Also add as event so it shows in overlay/chat
          newEvents.push({
            id: message.id,
            type: 'chat',
            timestamp: snippet.publishedAt,
            displayName: authorDetails.displayName,
            username: authorDetails.displayName,
            avatar: authorDetails.profileImageUrl,
            message: messageText,
            channelId: authorDetails.channelId,
            isChatOwner: authorDetails.isChatOwner,
            isChatSponsor: authorDetails.isChatSponsor,
            isChatModerator: authorDetails.isChatModerator
          });
          console.log(`[YouTube API Service] Created chat event:`, newEvents[newEvents.length - 1]);
          break;

        case 'superChatEvent':
          // Super Chat event
          const superChatDetails = snippet.superChatDetails;
          newEvents.push({
            id: message.id,
            type: 'superchat',
            timestamp: snippet.publishedAt,
            author: {
              name: authorDetails.displayName,
              channelId: authorDetails.channelId,
              avatar: authorDetails.profileImageUrl
            },
            amount: superChatDetails.amountDisplayString,
            amountMicros: superChatDetails.amountMicros,
            currency: superChatDetails.currency,
            message: superChatDetails.userComment || '',
            tier: superChatDetails.tier
          });
          break;

        case 'superStickerEvent':
          // Super Sticker event
          const superStickerDetails = snippet.superStickerDetails;
          newEvents.push({
            id: message.id,
            type: 'supersticker',
            timestamp: snippet.publishedAt,
            author: {
              name: authorDetails.displayName,
              channelId: authorDetails.channelId,
              avatar: authorDetails.profileImageUrl
            },
            amount: superStickerDetails.amountDisplayString,
            amountMicros: superStickerDetails.amountMicros,
            currency: superStickerDetails.currency,
            sticker: {
              id: superStickerDetails.superStickerMetadata.stickerId,
              altText: superStickerDetails.superStickerMetadata.altText,
              language: superStickerDetails.superStickerMetadata.language
            },
            tier: superStickerDetails.tier
          });
          break;

        case 'newSponsorEvent':
          // New membership event
          const newSponsorDetails = snippet.newSponsorDetails;
          newEvents.push({
            id: message.id,
            type: 'sponsor',
            timestamp: snippet.publishedAt,
            author: {
              name: authorDetails.displayName,
              channelId: authorDetails.channelId,
              avatar: authorDetails.profileImageUrl
            },
            memberLevelName: newSponsorDetails.memberLevelName,
            isUpgrade: newSponsorDetails.isUpgrade
          });
          break;

        case 'memberMilestoneChatEvent':
          // Membership milestone event
          const milestoneDetails = snippet.memberMilestoneChatDetails;
          newEvents.push({
            id: message.id,
            type: 'milestone',
            timestamp: snippet.publishedAt,
            author: {
              name: authorDetails.displayName,
              channelId: authorDetails.channelId,
              avatar: authorDetails.profileImageUrl
            },
            memberMonth: milestoneDetails.memberMonth,
            memberLevelName: milestoneDetails.memberLevelName,
            message: milestoneDetails.userComment || ''
          });
          break;

        case 'membershipGiftingEvent':
          // Gift membership purchase event
          const giftingDetails = snippet.membershipGiftingDetails;
          
          // Store gifter info in queue for matching with recipients
          this.giftQueue.set(authorDetails.channelId, {
            name: authorDetails.displayName,
            avatar: authorDetails.profileImageUrl,
            remainingGifts: giftingDetails.giftMembershipsCount,
            timestamp: Date.now()
          });
          
          // Clean up old gift queue entries (older than 5 minutes)
          const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
          for (const [channelId, giftInfo] of this.giftQueue.entries()) {
            if (giftInfo.timestamp < fiveMinutesAgo) {
              this.giftQueue.delete(channelId);
            }
          }
          
          newEvents.push({
            id: message.id,
            type: 'gift_membership_purchase',
            timestamp: snippet.publishedAt,
            author: {
              name: authorDetails.displayName,
              channelId: authorDetails.channelId,
              avatar: authorDetails.profileImageUrl
            },
            giftCount: giftingDetails.giftMembershipsCount,
            memberLevelName: giftingDetails.giftMembershipsLevelName,
            gifted: true
          });
          break;

        case 'giftMembershipReceivedEvent':
          // Gift membership received event
          const receivedDetails = snippet.giftMembershipReceivedDetails;
          
          // Try to match with a gifter from the queue
          let gifterInfo = null;
          if (receivedDetails.gifterChannelId && this.giftQueue.has(receivedDetails.gifterChannelId)) {
            gifterInfo = this.giftQueue.get(receivedDetails.gifterChannelId);
            
            // Decrement remaining gifts
            gifterInfo.remainingGifts--;
            
            // Remove from queue if no more gifts remaining
            if (gifterInfo.remainingGifts <= 0) {
              this.giftQueue.delete(receivedDetails.gifterChannelId);
            }
          }
          
          newEvents.push({
            id: message.id,
            type: 'gift_membership_received',
            timestamp: snippet.publishedAt,
            author: {
              name: authorDetails.displayName,
              channelId: authorDetails.channelId,
              avatar: authorDetails.profileImageUrl
            },
            memberLevelName: receivedDetails.memberLevelName,
            gifterChannelId: receivedDetails.gifterChannelId,
            associatedGiftMessageId: receivedDetails.associatedMembershipGiftingMessageId,
            gifted: true,
            // Include gifter info if available
            gifter: gifterInfo ? gifterInfo.name : 'Anonymous Gifter',
            gifterAvatar: gifterInfo ? gifterInfo.avatar : ''
          });
          break;

        case 'pollEvent':
          // Poll event (if needed)
          const pollDetails = snippet.pollDetails;
          newEvents.push({
            id: message.id,
            type: 'poll',
            timestamp: snippet.publishedAt,
            author: {
              name: authorDetails.displayName,
              channelId: authorDetails.channelId,
              avatar: authorDetails.profileImageUrl
            },
            question: pollDetails.metadata.questionText,
            options: pollDetails.metadata.options,
            status: pollDetails.metadata.status
          });
          break;

        default:
          // Log unknown message types for debugging
          console.log(`[YouTube API Service] Unknown message type: ${messageType}`);
          break;
      }
    }

    // Add new messages and events to our stores
    if (newChatMessages.length > 0) {
      this.chatMessages.push(...newChatMessages);
      // Keep only the most recent messages
      if (this.chatMessages.length > this.MAX_CHAT_HISTORY) {
        this.chatMessages = this.chatMessages.slice(-this.MAX_CHAT_HISTORY);
      }
      console.log(`[YouTube API Service] Added ${newChatMessages.length} new chat messages`);
    }

    if (newEvents.length > 0) {
      this.events.push(...newEvents);
      // Keep only the most recent events
      if (this.events.length > this.MAX_EVENT_HISTORY) {
        this.events = this.events.slice(-this.MAX_EVENT_HISTORY);
      }
      console.log(`[YouTube API Service] Added ${newEvents.length} new events`);
    }
    
    console.log(`[YouTube API Service] Total events in store: ${this.events.length}, Total chat messages: ${this.chatMessages.length}`);
  }

  // Process message runs with emoji/emote support
  processMessageRuns(textMessageDetails) {
    console.log(`[YouTube API Service] 🔍 processMessageRuns called with:`, textMessageDetails);
    
    if (!textMessageDetails || !textMessageDetails.runs) {
      console.log(`[YouTube API Service] ⚠️ No runs array found, using fallback. textMessageDetails:`, !!textMessageDetails, 'runs:', !!textMessageDetails?.runs);
      // Fallback to plain messageText if runs array is not available
      let fallback = textMessageDetails?.messageText || null;
      
      // Process emoji shortcodes in fallback text
      if (fallback) {
        fallback = this.emojiScraper.processMessage(fallback);
      }
      
      console.log(`[YouTube API Service] 📝 Fallback result: "${fallback}"`);
      return fallback;
    }

    console.log(`[YouTube API Service] ✅ Processing ${textMessageDetails.runs.length} runs:`, textMessageDetails.runs);
    
    let processedMessage = '';
    
    for (let i = 0; i < textMessageDetails.runs.length; i++) {
      const run = textMessageDetails.runs[i];
      console.log(`[YouTube API Service] 🔍 Processing run ${i}:`, run);
      
      if (run.text) {
        // Regular text run - process for emoji shortcodes
        console.log(`[YouTube API Service] 📝 Text run: "${run.text}"`);
        const processedText = this.emojiScraper.processMessage(run.text);
        processedMessage += processedText;
      } else if (run.emoji) {
        // Emoji run - use shortcode and let scraper handle it
        const emoji = run.emoji;
        console.log(`[YouTube API Service] 😀 Emoji run:`, emoji);
        
        if (emoji.shortcuts && emoji.shortcuts.length > 0) {
          // Use shortcode and let emoji scraper process it
          const shortcode = emoji.shortcuts[0];
          console.log(`[YouTube API Service] 🎯 Processing emoji shortcode: "${shortcode}"`);
          const processedEmoji = this.emojiScraper.processMessage(shortcode);
          processedMessage += processedEmoji;
        } else if (emoji.image && emoji.image.thumbnails && emoji.image.thumbnails.length > 0) {
          // Fallback to API image if no shortcode
          const imageUrl = emoji.image.thumbnails[0].url;
          const imgTag = `<img src="${imageUrl}" alt="emoji" class="youtube-emoji" style="width: 36px; height: 36px; vertical-align: middle; display: inline-block;">`;
          console.log(`[YouTube API Service] 🖼️ Using API image fallback: ${imgTag}`);
          processedMessage += imgTag;
        } else {
          console.log(`[YouTube API Service] ⚠️ Emoji run has no image or shortcuts:`, emoji);
        }
      } else {
        console.log(`[YouTube API Service] ❓ Unknown run type:`, run);
      }
    }
    
    console.log(`[YouTube API Service] ✅ Final processed message: "${processedMessage}"`);
    return processedMessage;
  }

  // Fetch viewer statistics
  async fetchViewerStats() {
    try {
      const config = loadConfig();
      const tokens = loadTokens();
      
      if (!config.YT_STREAM_ID || !tokens?.youtube?.access_token) {
        return;
      }

      const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${config.YT_STREAM_ID}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${tokens.youtube.access_token}`
        }
      });

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json();
          if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
            console.warn('[YouTube API Service] Quota exceeded for viewer stats');
            return;
          }
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.items && data.items.length > 0) {
        const liveDetails = data.items[0].liveStreamingDetails;
        if (liveDetails && liveDetails.concurrentViewers) {
          this.viewerCount = parseInt(liveDetails.concurrentViewers, 10);
        }
      }

    } catch (error) {
      console.error('[YouTube API Service] Error fetching viewer stats:', error);
    }
  }

  // Reset live chat ID (useful when stream changes)
  resetLiveChatId() {
    this.liveChatId = null;
    this.nextPageToken = null;
    this.processedMessageIds.clear();
    console.log('[YouTube API Service] Live chat ID reset');
  }

  // Broadcast updates to all renderer processes
  broadcastUpdates() {
    console.log('=== BROADCAST UPDATES CALLED ===');
    
    // Ensure events array is always defined
    if (!this.events) {
      this.events = [];
    }

    const data = {
      events: this.events.slice(), // Send copy of current events
      viewerCount: this.viewerCount || 0,
      connectionStatus: this.connectionStatus, // Use actual connection status
      lastUpdate: new Date().toISOString() // Convert Date to string for IPC serialization
    };

    console.log('=== DATA TO BROADCAST ===', JSON.stringify(data, null, 2));

    // Only broadcast if we have actual events OR this is a connection status update
    if (data.events.length === 0 && !data.connectionStatus) {
      console.log('[YouTube API Service] Skipping broadcast - no events and not connected');
      return;
    }

    console.log(`[YouTube API Service] Broadcasting ${data.events.length} events, viewerCount: ${data.viewerCount}, connected: ${data.connectionStatus}`);
    if (data.events.length > 0) {
      console.log('[YouTube API Service] Events:', data.events.map(e => `${e.type}: ${e.displayName || e.username}`));
    }

    // Clear events after broadcasting to avoid duplicates
    this.events = [];

    // Broadcast to all windows
    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    
    if (allWindows.length === 0) {
      console.log('[YouTube API Service] No windows available for broadcast');
      return;
    }

    allWindows.forEach(win => {
      if (win && win.webContents && !win.isDestroyed()) {
        try {
          // CRITICAL: Validate data before sending
          if (!data || typeof data !== 'object') {
            console.error(`[YouTube API Service] INVALID DATA for window ${win.id}:`, data);
            return;
          }
          
          console.log(`[YouTube API Service] Sending to window ${win.id}:`, data);
          win.webContents.send('youtube-data-update', data);
          console.log(`[YouTube API Service] Successfully sent to window ${win.id}`);
        } catch (error) {
          console.error(`[YouTube API Service] Failed to send to window ${win.id}:`, error);
        }
      }
    });
  }

  // Broadcast connection status
  broadcastConnectionStatus() {
    const data = {
      connectionStatus: this.connectionStatus
    };
    console.log('🔴 [YouTube API Service] *** BROADCASTING CONNECTION STATUS ***:', this.connectionStatus);
    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    console.log(`[YouTube API Service] Found ${allWindows.length} windows to broadcast to`);
    allWindows.forEach((win, index) => {
      if (win && win.webContents && !win.isDestroyed()) {
        try {
          const title = win.getTitle();
          console.log(`[YouTube API Service] Sending connection status to window ${win.id} (${title})`);
          win.webContents.send('youtube-connection-status', data);
          console.log(`[YouTube API Service] ✅ Sent connection status to window ${win.id}`);
        } catch (error) {
          console.error(`❌ Failed to send connection status to window ${win.id}:`, error);
        }
      } else {
        console.log(`[YouTube API Service] ⚠️ Skipping destroyed/invalid window ${index}`);
      }
    });
  }

  // Get current data (for IPC requests)
  getCurrentData() {
    return {
      chatMessages: this.chatMessages,
      events: this.events,
      viewerCount: this.viewerCount,
      connectionStatus: this.connectionStatus,
      lastUpdate: this.lastPollTime,
      isRunning: this.isRunning
    };
  }

  // Handle emoji cache updates and broadcast to all windows
  handleEmojiCacheUpdate(newEmojiCount) {
    console.log(`[YouTube API Service] 🎉 Emoji cache updated with ${newEmojiCount} new emojis!`);
    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win, index) => {
      if (win && win.webContents && !win.isDestroyed()) {
        try {
          const title = win.getTitle();
          console.log(`[YouTube API Service] Sending emoji cache update to window ${win.id} (${title})`);
          win.webContents.send('youtube-emoji-cache-update', newEmojiCount);
          console.log(`[YouTube API Service] ✅ Sent emoji cache update to window ${win.id}`);
        } catch (error) {
          console.error(`❌ Failed to send emoji cache update to window ${win.id}:`, error);
        }
      } else {
        console.log(`[YouTube API Service] ⚠️ Skipping destroyed/invalid window ${index}`);
      }
    });
  }
}

// Export the service class
module.exports = YouTubeAPIService;

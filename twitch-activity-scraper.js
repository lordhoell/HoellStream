const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./auth.js');

class TwitchActivityScraper {
  constructor() {
    this.scrapingWindow = null;
    this.eventCache = new Set(); // Track processed event IDs to avoid duplicates
    this.isRunning = false;
    this.pollInterval = null;
    this.onEventFound = null; // Callback for when new events are found
    this.pollIntervalMs = 15000; // Poll every 15 seconds
    this.lastScrapeTime = null;
    
    // Start with main dashboard instead of direct activity feed URL
    this.dashboardUrl = 'https://dashboard.twitch.tv/u/lordhoell/content';
    this.activityFeedUrl = 'https://dashboard.twitch.tv/popout/u/lordhoell/stream-manager/activity-feed?uuid=8c4337b70873c5d9eeb6d9945f878154';
    
    console.log('[Twitch Activity Scraper] Initialized');
  }

  // Initialize hidden scraping window
  async initializeScrapingWindow() {
    if (this.scrapingWindow && !this.scrapingWindow.isDestroyed()) {
      return; // Already initialized
    }

    this.scrapingWindow = new BrowserWindow({
      show: true, // Make window visible for testing
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
        // Removed custom partition to use default session with existing auth
      }
    });

    // Set Chrome user agent to bypass Twitch browser detection
    const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.scrapingWindow.webContents.setUserAgent(chromeUserAgent);
    console.log('[Twitch Activity Scraper] Set Chrome user agent to bypass browser detection');

    // Open DevTools for debugging
    this.scrapingWindow.webContents.openDevTools();

    // Add console message handler for debugging
    this.scrapingWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Twitch Scraping Window] ${message}`);
    });

    // Handle navigation errors
    this.scrapingWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[Twitch Activity Scraper] Failed to load ${validatedURL}: ${errorDescription}`);
    });

    console.log('[Twitch Activity Scraper] Scraping window initialized');
  }

  // Navigate to activity feed and wait for load
  async navigateToActivityFeed() {
    try {
      console.log('[Twitch Activity Scraper] Attempting to navigate to activity feed...');
      
      // Try to inject OAuth token before loading the page
      await this.injectAuthToken();
      
      // Try to load the activity feed URL
      try {
        await this.scrapingWindow.loadURL(this.activityFeedUrl);
        console.log('[Twitch Activity Scraper] Successfully loaded activity feed URL');
      } catch (urlError) {
        console.warn('[Twitch Activity Scraper] Direct activity feed URL failed, staying on dashboard');
        console.log('[Twitch Activity Scraper] You can manually navigate to the activity feed in the browser window');
        return true; // Don't fail, just stay on dashboard
      }
      
      // Wait for page to load
      await this.waitForPageLoad();
      
      console.log('[Twitch Activity Scraper] Activity feed loaded successfully');
      return true;
    } catch (error) {
      console.error('[Twitch Activity Scraper] Failed to navigate to activity feed:', error);
      return false;
    }
  }

  // Helper method to manually navigate to activity feed
  async navigateToActivityFeedManually() {
    try {
      console.log('[Twitch Activity Scraper] Attempting manual navigation to activity feed...');
      await this.scrapingWindow.loadURL(this.activityFeedUrl);
      await this.waitForPageLoad();
      console.log('[Twitch Activity Scraper] Manual navigation successful');
      return true;
    } catch (error) {
      console.error('[Twitch Activity Scraper] Manual navigation failed:', error);
      return false;
    }
  }

  // Inject OAuth token into the browser session
  async injectAuthToken() {
    try {
      console.log('[Twitch Activity Scraper] Attempting to inject OAuth token...');
      
      // Load stored tokens
      const tokens = this.loadStoredTokens();
      
      if (tokens && tokens.twitch && tokens.twitch.access_token) {
        console.log('[Twitch Activity Scraper] Found Twitch OAuth token, injecting...');
        
        // Simplified approach: Just set cookies without navigation
        try {
          await this.scrapingWindow.webContents.session.cookies.set({
            url: 'https://twitch.tv',
            name: 'auth-token',
            value: tokens.twitch.access_token,
            domain: '.twitch.tv',
            path: '/',
            secure: true,
            httpOnly: false
          });
          
          console.log('[Twitch Activity Scraper] OAuth token set as cookie');
        } catch (cookieError) {
          console.warn('[Twitch Activity Scraper] Failed to set cookie:', cookieError.message);
        }
        
        console.log('[Twitch Activity Scraper] OAuth token injection completed');
      } else {
        console.warn('[Twitch Activity Scraper] No OAuth token found - manual login required');
      }
    } catch (error) {
      console.error('[Twitch Activity Scraper] Failed to inject OAuth token:', error.message);
      console.log('[Twitch Activity Scraper] Continuing without token injection - manual login required');
    }
  }

  // Load stored tokens (similar to auth.js)
  loadStoredTokens() {
    try {
      const { app, safeStorage } = require('electron');
      const tokenPath = path.join(app.getPath('userData'), 'tokens.secure');
      
      if (fs.existsSync(tokenPath)) {
        const encrypted = fs.readFileSync(tokenPath);
        const decrypted = safeStorage.decryptString(encrypted);
        return JSON.parse(decrypted);
      }
    } catch (error) {
      console.error('[Twitch Activity Scraper] Error loading tokens:', error);
    }
    return null;
  }

  // Wait for page to fully load
  async waitForPageLoad() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.warn('[Twitch Activity Scraper] Page load timeout - continuing anyway');
        resolve(); // Don't reject, just continue
      }, 30000); // 30 second timeout

      const checkReady = async () => {
        try {
          const isReady = await this.scrapingWindow.webContents.executeJavaScript(`
            // Check if the page is loaded (more flexible check)
            document.readyState === 'complete' && 
            (document.querySelector('[data-a-target="activity-feed"]') || 
             document.querySelector('.activity-feed') ||
             document.querySelector('[class*="activity"]') ||
             document.querySelector('[class*="dashboard"]') ||
             document.body.textContent.includes('Activity Feed') ||
             document.body.textContent.includes('Dashboard') ||
             document.title.includes('Twitch'))
          `);

          if (isReady) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkReady, 1000);
          }
        } catch (error) {
          console.warn('[Twitch Activity Scraper] Page check error, continuing anyway:', error.message);
          clearTimeout(timeout);
          resolve(); // Don't reject, just continue
        }
      };

      checkReady();
    });
  }

  // Main scraping method to extract activity events
  async scrapeActivityEvents() {
    try {
      console.log('[Twitch Activity Scraper] Extracting activity events...');
      
      const events = await this.scrapingWindow.webContents.executeJavaScript(`
        (() => {
          const events = [];
          
          // Target the actual activity feed items using the correct class
          const activityItems = document.querySelectorAll('.activity-base-list-item');
          console.log('Found', activityItems.length, 'activity items');
          
          activityItems.forEach((item, index) => {
            try {
              const eventText = item.textContent.trim();
              if (!eventText) return;
              
              // Extract event data from the text content
              let eventType = 'unknown';
              let username = '';
              let displayName = '';
              let amount = 0;
              let message = '';
              let redemptionName = '';
              let timestamp = '';
              
              // Parse different event types based on text patterns
              if (eventText.includes('HYDRATE') || (eventText.includes('•') && eventText.includes('hours ago'))) {
                // Channel Points Redemption
                const match = eventText.match(/^(.+?)\\s*•\\s*(.+?)\\s*•\\s*(.+?)$/);
                if (match) {
                  username = match[1].trim();
                  displayName = username;
                  timestamp = match[3].trim();
                  
                  if (eventText.includes('HYDRATE')) {
                    eventType = 'channel_points';
                    redemptionName = 'HYDRATE';
                  }
                }
              } else if (eventText.includes('Cheered') && eventText.includes('Bits')) {
                // Bits/Cheer event
                eventType = 'bits';
                const match = eventText.match(/^(.+?)\\s*•\\s*Cheered\\s+(\\d+)\\s+Bits/);
                if (match) {
                  username = match[1].trim();
                  displayName = username;
                  amount = parseInt(match[2]);
                  
                  // Extract message after the bits amount
                  const messageMatch = eventText.match(/\\d+\\s+Bits\\.\\s*•\\s*(.+?)\\s*•\\s*(.+)$/);
                  if (messageMatch) {
                    message = messageMatch[1].trim();
                    timestamp = messageMatch[2].trim();
                  }
                }
              } else if (eventText.includes('followed')) {
                // Follow event
                eventType = 'follow';
                const match = eventText.match(/^(.+?)\\s*•\\s*followed\\s+you\\s*•\\s*(.+)$/);
                if (match) {
                  username = match[1].trim();
                  displayName = username;
                  timestamp = match[2].trim();
                }
              } else if (eventText.includes('subscribed')) {
                // Subscription event
                eventType = 'subscription';
                const match = eventText.match(/^(.+?)\\s*•\\s*subscribed\\s*•\\s*(.+)$/);
                if (match) {
                  username = match[1].trim();
                  displayName = username;
                  timestamp = match[2].trim();
                }
              } else if (eventText.includes('raid')) {
                // Raid event
                eventType = 'raid';
                const match = eventText.match(/^(.+?)\\s*•\\s*raid.*?(\\d+).*?•\\s*(.+)$/);
                if (match) {
                  username = match[1].trim();
                  displayName = username;
                  amount = parseInt(match[2]);
                  timestamp = match[3].trim();
                }
              }
              
              // Try to extract avatar from any img elements in the item
              let avatar = '';
              const imgElement = item.querySelector('img[src*="twitch"]');
              if (imgElement) {
                avatar = imgElement.src;
              }
              
              // Generate unique event ID
              const eventId = eventType + '_' + username + '_' + timestamp + '_' + Date.now();
              
              const eventData = {
                eventId: eventId,
                type: eventType,
                username: username,
                displayName: displayName,
                userId: '', // Not available from activity feed
                avatar: avatar,
                amount: amount,
                message: message,
                redemptionName: redemptionName,
                timestamp: timestamp,
                rawText: eventText,
                source: 'activity_feed'
              };
              
              events.push(eventData);
              
            } catch (error) {
              console.error('Error parsing activity item:', error);
            }
          });
          
          console.log('Extracted', events.length, 'events from activity feed');
          return events;
        })()
      `);
      
      console.log('[Twitch Activity Scraper] Found ' + events.length + ' events');
      return events;
      
    } catch (error) {
      console.error('[Twitch Activity Scraper] Error extracting events:', error);
      return [];
    }
  }

  // Process and filter new events
  processNewEvents(events) {
    const newEvents = [];
    
    for (const event of events) {
      // Skip if we've already processed this event
      if (this.eventCache.has(event.eventId)) {
        continue;
      }
      
      // Add to cache
      this.eventCache.add(event.eventId);
      
      // Clean up cache if it gets too large (keep last 1000 events)
      if (this.eventCache.size > 1000) {
        const cacheArray = Array.from(this.eventCache);
        this.eventCache = new Set(cacheArray.slice(-500)); // Keep last 500
      }
      
      newEvents.push(event);
    }
    
    return newEvents;
  }

  // Main scraping method
  async scrapeActivity() {
    try {
      console.log('[Twitch Activity Scraper] Starting activity scraping...');
      
      // Initialize scraping window
      await this.initializeScrapingWindow();
      
      // Navigate to dashboard
      await this.scrapingWindow.loadURL(this.dashboardUrl);
      
      // Wait for page to load
      await this.waitForPageLoad();
      
      // Navigate to activity feed
      const navigationSuccess = await this.navigateToActivityFeed();
      if (!navigationSuccess) {
        throw new Error('Failed to navigate to activity feed');
      }
      
      // Extract events
      const events = await this.scrapeActivityEvents();
      
      // Process new events
      const newEvents = this.processNewEvents(events);
      
      this.lastScrapeTime = new Date();
      
      console.log(`[Twitch Activity Scraper] Scraping complete. Found ${newEvents.length} new events`);
      
      // Notify callback of new events
      if (newEvents.length > 0 && this.onEventFound) {
        for (const event of newEvents) {
          this.onEventFound(event);
        }
      }
      
      return {
        success: true,
        totalEvents: events.length,
        newEvents: newEvents.length,
        events: newEvents
      };
    } catch (error) {
      console.error('[Twitch Activity Scraper] Scraping failed:', error);
      return {
        success: false,
        error: error.message,
        totalEvents: 0,
        newEvents: 0,
        events: []
      };
    }
  }

  // Start periodic scraping
  startPeriodicScraping() {
    if (this.pollInterval) {
      return; // Already started
    }
    
    this.isRunning = true;
    console.log(`[Twitch Activity Scraper] Starting periodic scraping every ${this.pollIntervalMs / 1000} seconds`);
    
    // Initial scrape
    this.scrapeActivity();
    
    // Set up periodic scraping
    this.pollInterval = setInterval(() => {
      if (this.isRunning) {
        this.scrapeActivity();
      }
    }, this.pollIntervalMs);
  }

  // Stop periodic scraping
  stopPeriodicScraping() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    this.isRunning = false;
    console.log('[Twitch Activity Scraper] Stopped periodic scraping');
  }

  // Set callback for when new events are found
  setEventCallback(callback) {
    this.onEventFound = callback;
  }

  // Get scraper status
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastScrapeTime: this.lastScrapeTime,
      cacheSize: this.eventCache.size,
      pollIntervalMs: this.pollIntervalMs
    };
  }

  // Manual scrape trigger
  async manualScrape() {
    console.log('[Twitch Activity Scraper] Manual scrape triggered');
    return await this.scrapeActivity();
  }

  // Clear event cache
  clearCache() {
    this.eventCache.clear();
    console.log('[Twitch Activity Scraper] Event cache cleared');
  }

  // Get latest events from cache
  getLatestEvents() {
    // Convert cache values to array and return recent events
    const events = Array.from(this.eventCache.values());
    
    // Sort by timestamp (most recent first) and limit to last 50 events
    return events
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 50);
  }

  // Cleanup resources
  destroy() {
    console.log('[Twitch Activity Scraper] Destroying scraper and cleaning up resources...');
    
    // Stop periodic scraping
    this.stopPeriodicScraping();
    
    // Close and destroy scraping window
    if (this.scrapingWindow && !this.scrapingWindow.isDestroyed()) {
      console.log('[Twitch Activity Scraper] Closing scraping window...');
      this.scrapingWindow.close();
      this.scrapingWindow.destroy();
      this.scrapingWindow = null;
    }
    
    // Clear cache and callback
    this.eventCache.clear();
    this.onEventFound = null;
    
    console.log('[Twitch Activity Scraper] Cleanup complete');
  }

  // Start the scraper
  async start() {
    console.log('[Twitch Activity Scraper] Starting scraper...');
    
    try {
      // Initialize the scraping window
      await this.initializeScrapingWindow();
      
      // Navigate to dashboard
      await this.scrapingWindow.loadURL(this.dashboardUrl);
      
      // Wait for page to load
      await this.waitForPageLoad();
      
      // Start periodic scraping
      this.startPeriodicScraping();
      
      console.log('[Twitch Activity Scraper] Started successfully (manual login may be required)');
      return { success: true, message: 'Scraper started - check browser window for login status' };
    } catch (error) {
      console.error('[Twitch Activity Scraper] Failed to start:', error);
      this.isRunning = false;
      
      // Clean up on failure
      if (this.scrapingWindow && !this.scrapingWindow.isDestroyed()) {
        try {
          this.scrapingWindow.close();
          this.scrapingWindow.destroy();
          this.scrapingWindow = null;
        } catch (cleanupError) {
          console.error('[Twitch Activity Scraper] Error during cleanup:', cleanupError);
        }
      }
      
      return { success: false, error: error.message };
    }
  }

  // Stop the scraper
  async stop() {
    console.log('[Twitch Activity Scraper] Stopping scraper...');
    
    try {
      // Stop periodic scraping
      this.stopPeriodicScraping();
      
      // Close scraping window
      if (this.scrapingWindow && !this.scrapingWindow.isDestroyed()) {
        this.scrapingWindow.close();
        this.scrapingWindow.destroy();
        this.scrapingWindow = null;
      }
      
      console.log('[Twitch Activity Scraper] Stopped successfully');
      return { success: true };
    } catch (error) {
      console.error('[Twitch Activity Scraper] Error stopping:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = TwitchActivityScraper;

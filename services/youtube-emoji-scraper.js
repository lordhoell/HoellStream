const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadConfig } = require('./auth.js');

class YouTubeEmojiScraper {
  constructor() {
    this.scrapingWindow = null;
    this.emojiCache = new Map(); // shortcode -> local file path
    this.badgeCache = new Map(); // badge type -> local file path
    this.cacheDir = path.join(app.getPath('userData'), 'emoji-cache');
    this.badgeCacheDir = path.join(app.getPath('userData'), 'badge-cache');
    this.mappingFile = path.join(this.cacheDir, 'emoji-mapping.json');
    this.badgeMappingFile = path.join(this.badgeCacheDir, 'badge-mapping.json');
    this.backfillTimer = null;
    this.periodicTimer = null;
    this.onEmojiCacheUpdated = null; // Callback for when new emojis are found
    this.onBadgeCacheUpdated = null; // Callback for when new badges are found
    
    // Jewel gift detection properties
    this.jewelGiftCache = new Map(); // Gift ID -> gift data to prevent duplicates
    this.onJewelDetected = null; // Callback for when Jewel gifts are detected
    this.jewelScrapingInterval = null; // Timer for periodic Jewel detection
    
    // Ensure cache directories exist
    this.initializeCacheDirectory();
    
    // Load existing emoji mappings
    this.loadEmojiMappings();
    
    // Load existing badge mappings
    this.loadBadgeMappings();
    
    console.log('[YouTube Emoji Scraper] Initialized with cache directory:', this.cacheDir);
    console.log('[YouTube Emoji Scraper] Badge cache directory:', this.badgeCacheDir);
  }

  // Initialize cache directory and load existing mappings
  initializeCacheDirectory() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        console.log('[YouTube Emoji Scraper] Created cache directory:', this.cacheDir);
      }
      if (!fs.existsSync(this.badgeCacheDir)) {
        fs.mkdirSync(this.badgeCacheDir, { recursive: true });
        console.log('[YouTube Emoji Scraper] Created badge cache directory:', this.badgeCacheDir);
      }
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Failed to create cache directory:', error);
    }
  }

  // Load existing emoji mappings from disk
  loadEmojiMappings() {
    try {
      if (fs.existsSync(this.mappingFile)) {
        const mappingData = fs.readFileSync(this.mappingFile, 'utf8');
        const mappings = JSON.parse(mappingData);
        
        // Convert to Map and verify files still exist
        for (const [shortcode, filePath] of Object.entries(mappings)) {
          if (fs.existsSync(filePath)) {
            this.emojiCache.set(shortcode, filePath);
          }
        }
        
        console.log(`[YouTube Emoji Scraper] Loaded ${this.emojiCache.size} cached emojis`);
      }
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Failed to load emoji mappings:', error);
    }
  }

  // Load existing badge mappings from disk
  loadBadgeMappings() {
    try {
      if (fs.existsSync(this.badgeMappingFile)) {
        const mappingData = fs.readFileSync(this.badgeMappingFile, 'utf8');
        const mappings = JSON.parse(mappingData);
        
        // Convert to Map and verify files still exist
        for (const [badgeType, filePath] of Object.entries(mappings)) {
          if (fs.existsSync(filePath)) {
            this.badgeCache.set(badgeType, filePath);
          }
        }
        
        console.log(`[YouTube Emoji Scraper] Loaded ${this.badgeCache.size} cached badges`);
      }
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Failed to load badge mappings:', error);
    }
  }

  // Save emoji mappings to disk
  saveEmojiMappings() {
    try {
      const mappings = Object.fromEntries(this.emojiCache);
      fs.writeFileSync(this.mappingFile, JSON.stringify(mappings, null, 2));
      console.log(`[YouTube Emoji Scraper] Saved ${this.emojiCache.size} emoji mappings`);
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Failed to save emoji mappings:', error);
    }
  }

  // Save badge mappings to disk
  saveBadgeMappings() {
    try {
      const mappings = Object.fromEntries(this.badgeCache);
      fs.writeFileSync(this.badgeMappingFile, JSON.stringify(mappings, null, 2));
      console.log(`[YouTube Emoji Scraper] Saved ${this.badgeCache.size} badge mappings`);
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Failed to save badge mappings:', error);
    }
  }

  // Initialize hidden scraping window
  async initializeScrapingWindow() {
    if (this.scrapingWindow && !this.scrapingWindow.isDestroyed()) {
      return; // Already initialized
    }

    this.scrapingWindow = new BrowserWindow({
      show: false, // Keep window hidden during scraping
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        // Allow access to YouTube
        allowRunningInsecureContent: false
      }
    });

    // Add console message handler for debugging
    this.scrapingWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Scraping Window Console] ${message}`);
    });

    console.log('[YouTube Emoji Scraper] Scraping window initialized');
  }

  // Get stream URL from user configuration
  async getStreamUrl() {
    const config = loadConfig();
    const videoId = config.YT_STREAM_ID;
    
    if (!videoId) {
      throw new Error('No YouTube Stream ID configured. Please set it in Settings.');
    }
    
    // Use popout format to get full chat with all messages including gifts
    const chatUrl = `https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`;
    return { videoId, chatUrl };
  }

  // Main scraping method
  async scrapeEmojis() {
    try {
      console.log('[YouTube Emoji Scraper] Starting emoji scraping...');
      
      // Initialize scraping window
      await this.initializeScrapingWindow();
      console.log('[YouTube Emoji Scraper] Scraping window initialized');
      
      // Get stream URL
      const { videoId, chatUrl } = await this.getStreamUrl();
      console.log(`[YouTube Emoji Scraper] Targeting stream: ${videoId}`);
      console.log(`[YouTube Emoji Scraper] Chat URL: ${chatUrl}`);
      
      // Navigate to live chat
      console.log(`[YouTube Emoji Scraper] Loading URL: ${chatUrl}`);
      await this.scrapingWindow.loadURL(chatUrl);
      console.log(`[YouTube Emoji Scraper] URL loaded successfully`);
      
      // Wait for page to load
      console.log('[YouTube Emoji Scraper] Waiting for page to load...');
      await this.waitForPageLoad();
      console.log('[YouTube Emoji Scraper] Page loaded');
      
      // Check if page loaded correctly
      const pageTitle = await this.scrapingWindow.webContents.getTitle();
      console.log(`[YouTube Emoji Scraper] Page title: "${pageTitle}"`);
      
      // Extract emoji data
      console.log('[YouTube Emoji Scraper] Starting emoji extraction...');
      const emojiData = await this.extractEmojiData();
      console.log(`[YouTube Emoji Scraper] Extraction complete. Found ${emojiData.length} emojis:`, emojiData);
      
      // Extract badge data
      console.log('[YouTube Emoji Scraper] Starting badge extraction...');
      const badgeData = await this.extractBadgeData();
      console.log(`[YouTube Emoji Scraper] Badge extraction complete. Found ${badgeData.length} badges:`, badgeData);
      
      if (emojiData.length === 0) {
        console.warn('[YouTube Emoji Scraper] No emojis found - this might indicate the emoji picker could not be opened or found');
        return {
          success: false,
          error: 'No emojis found. Make sure the stream is live and has custom emojis.',
          emojisFound: 0,
          emojisNew: 0,
          badgesFound: badgeData.length,
          badgesNew: badgeData.filter(b => !this.badgeCache.has(b.type)).length,
          totalCached: this.emojiCache.size,
          totalBadgesCached: this.badgeCache.size
        };
      }
      
      // Download and cache emojis
      console.log('[YouTube Emoji Scraper] Starting emoji caching...');
      await this.cacheEmojis(emojiData);
      console.log('[YouTube Emoji Scraper] Emoji caching complete');
      
      // Download and cache badges
      if (badgeData.length > 0) {
        console.log('[YouTube Emoji Scraper] Starting badge caching...');
        await this.cacheBadges(badgeData);
        console.log('[YouTube Emoji Scraper] Badge caching complete');
        
        // Notify callback if provided
        if (this.onBadgeCacheUpdated) {
          this.onBadgeCacheUpdated(badgeData);
        }
      }
      
      // Save mappings
      this.saveEmojiMappings();
      
      console.log('[YouTube Emoji Scraper] Scraping completed successfully');
      return {
        success: true,
        emojisFound: emojiData.length,
        emojisNew: emojiData.filter(e => !this.emojiCache.has(e.shortcode)).length,
        badgesFound: badgeData.length,
        badgesNew: badgeData.filter(b => !this.badgeCache.has(b.type)).length,
        totalCached: this.emojiCache.size,
        totalBadgesCached: this.badgeCache.size
      };
      
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Scraping failed:', error);
      console.error('[YouTube Emoji Scraper] Error stack:', error.stack);
      return {
        success: false,
        error: error.message,
        totalCached: this.emojiCache.size,
        totalBadgesCached: this.badgeCache.size
      };
    }
  }

  // Wait for page to fully load
  async waitForPageLoad() {
    return new Promise((resolve) => {
      const checkReady = async () => {
        try {
          const isReady = await this.scrapingWindow.webContents.executeJavaScript(`
            document.readyState === 'complete' && 
            document.querySelector('yt-live-chat-app') !== null
          `);
          
          if (isReady) {
            // Additional wait for chat to initialize
            setTimeout(resolve, 3000);
          } else {
            setTimeout(checkReady, 1000);
          }
        } catch (error) {
          setTimeout(checkReady, 1000);
        }
      };
      
      checkReady();
    });
  }

  // Extract emoji data from the page
  async extractEmojiData() {
    return await this.scrapingWindow.webContents.executeJavaScript(`
      (async () => {
        console.log('[Scraper Script] Starting emoji extraction...');
        
        // Wait a bit more for the page to fully load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Function to find and click emoji picker
        const openEmojiPicker = () => {
          console.log('[Scraper Script] Looking for emoji picker button...');
          
          // Try multiple selectors for emoji picker button
          const selectors = [
            // Common YouTube chat emoji button selectors
            'button[aria-label*="emoji" i]',
            'button[aria-label*="Choose an emoji"]',
            'button[aria-label*="Select an emoji"]',
            'button[aria-label*="emoji" i]',
            'yt-icon-button[aria-label*="emoji" i]',
            'yt-icon-button[title*="emoji" i]',
            '#emoji-button',
            '.emoji-picker-button',
            '[data-tooltip*="emoji" i]',
            'button[data-a-target="emotes-button"]',
            // Look for emoji/smiley icons
            'button svg[d*="M12,2C6.486,2,2,6.486,2,12s4.486,10,10,10s10-4.486,10-10S17.514,2,12,2z"]',
            'button yt-icon[icon="emoji"]',
            'button yt-icon[class*="emoji"]'
          ];
          
          for (const selector of selectors) {
            console.log('[Scraper Script] Trying selector:', selector);
            const buttons = document.querySelectorAll(selector);
            console.log('[Scraper Script] Found', buttons.length, 'buttons with selector:', selector);
            
            for (const button of buttons) {
              console.log('[Scraper Script] Button details:', {
                tagName: button.tagName,
                className: button.className,
                ariaLabel: button.getAttribute('aria-label'),
                title: button.getAttribute('title'),
                textContent: button.textContent?.trim(),
                innerHTML: button.innerHTML
              });
              
              // Click the button
              try {
                button.click();
                console.log('[Scraper Script] Clicked emoji button:', selector);
                return true;
              } catch (e) {
                console.log('[Scraper Script] Failed to click button:', e);
              }
            }
          }
          
          // Try to find any clickable element that might be the emoji picker
          console.log('[Scraper Script] Trying generic approach...');
          const allButtons = document.querySelectorAll('button, yt-icon-button, [role="button"]');
          console.log('[Scraper Script] Found', allButtons.length, 'total clickable elements');
          
          for (const button of allButtons) {
            const text = (button.textContent || '').toLowerCase();
            const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
            const title = (button.getAttribute('title') || '').toLowerCase();
            
            if (text.includes('emoji') || ariaLabel.includes('emoji') || title.includes('emoji') ||
                text.includes('emote') || ariaLabel.includes('emote') || title.includes('emote')) {
              console.log('[Scraper Script] Found potential emoji button:', {
                text, ariaLabel, title, className: button.className
              });
              try {
                button.click();
                console.log('[Scraper Script] Clicked potential emoji button');
                return true;
              } catch (e) {
                console.log('[Scraper Script] Failed to click potential button:', e);
              }
            }
          }
          
          console.log('[Scraper Script] Could not find emoji picker button');
          return false;
        };
        
        // Try to open emoji picker
        const pickerOpened = openEmojiPicker();
        if (!pickerOpened) {
          console.log('[Scraper Script] Could not find or click emoji picker button');
          // Don't return empty array yet, maybe emojis are already visible
        }
        
        // Wait for picker to load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Extract emoji data with multiple approaches
        const emojis = [];
        
        console.log('[Scraper Script] Looking for emoji images...');
        
        // Try multiple selectors for emoji images
        const emojiSelectors = [
          // Standard emoji image selectors
          'img[alt^=":"][alt$=":"]',
          'img[data-emoji-id]',
          'img[src*="emoji"]',
          'img[src*="yt3.ggpht.com"]', // YouTube emoji CDN
          'img[src*="googleusercontent.com"]', // Google CDN
          '.emoji img',
          'yt-emoji img',
          'yt-formatted-string img',
          // Look in emoji picker containers
          '[role="dialog"] img',
          '[role="menu"] img',
          '.emoji-picker img',
          '.emote-picker img',
          // Look for any small images that might be emojis
          'img[width="24"]',
          'img[height="24"]',
          'img[style*="24px"]'
        ];
        
        for (const selector of emojiSelectors) {
          console.log('[Scraper Script] Trying emoji selector:', selector);
          const emojiElements = document.querySelectorAll(selector);
          console.log('[Scraper Script] Found', emojiElements.length, 'images with selector:', selector);
          
          emojiElements.forEach((img, index) => {
            console.log('[Scraper Script] Image', index, 'properties:');
            console.log('  src:', img.src);
            console.log('  alt:', img.alt);
            console.log('  title:', img.title);
            console.log('  width:', img.width);
            console.log('  height:', img.height);
            console.log('  className:', img.className);
            console.log('  ariaLabel:', img.getAttribute('aria-label'));
            console.log('  id:', img.id);
            console.log('  data-emoji-id:', img.getAttribute('data-emoji-id'));
            console.log('  outerHTML:', img.outerHTML.substring(0, 200) + '...');
            
            // Try to get shortcode from various sources
            let shortcode = null;
            const url = img.src;
            
            // Check aria-label first (this is where YouTube puts the shortcode)
            const ariaLabel = img.getAttribute('aria-label');
            console.log('[Scraper Script] Checking aria-label:', ariaLabel);
            
            if (ariaLabel && ariaLabel.startsWith(':') && ariaLabel.endsWith(':')) {
              shortcode = ariaLabel;
              console.log('[Scraper Script] Found shortcode in aria-label:', shortcode);
            }
            // Check alt attribute - YouTube stores emoji names here (not in :name: format)
            else if (img.alt && img.alt.trim()) {
              shortcode = ':' + img.alt.trim() + ':';
              console.log('[Scraper Script] Found shortcode in alt:', shortcode);
            }
            // Check title attribute
            else if (img.title && img.title.startsWith(':') && img.title.endsWith(':')) {
              shortcode = img.title;
              console.log('[Scraper Script] Found shortcode in title:', shortcode);
            }
            else {
              console.log('[Scraper Script] No shortcode found in aria-label, alt, or title');
            }
            
            // Validate emoji data - be more flexible with validation
            if (url && (
              (shortcode && shortcode.startsWith(':') && shortcode.endsWith(':')) ||
              url.includes('emoji') ||
              url.includes('yt3.ggpht.com') ||
              url.includes('googleusercontent.com')
            )) {
              const emojiShortcode = shortcode && shortcode.startsWith(':') ? shortcode : ':unknown_emoji_' + index + ':';
              emojis.push({
                shortcode: emojiShortcode,
                url: url,
                title: img.title || emojiShortcode
              });
              console.log('[Scraper Script] Added emoji:', emojiShortcode, url);
            }
          });
          
          if (emojis.length > 0) {
            console.log('[Scraper Script] Found emojis with selector:', selector);
            break; // Found emojis, no need to try other selectors
          }
        }
        
        // If still no emojis, try to look at the page structure
        if (emojis.length === 0) {
          console.log('[Scraper Script] No emojis found, analyzing page structure...');
          console.log('[Scraper Script] Page URL:', window.location.href);
          console.log('[Scraper Script] Page title:', document.title);
          console.log('[Scraper Script] Body classes:', document.body.className);
          
          // Look for any images on the page
          const allImages = document.querySelectorAll('img');
          console.log('[Scraper Script] Total images on page:', allImages.length);
          
          allImages.forEach((img, index) => {
            if (index < 10) { // Log first 10 images
              console.log('[Scraper Script] Image', index, ':', {
                src: img.src?.substring(0, 100),
                alt: img.alt,
                className: img.className
              });
            }
          });
        }
        
        // Remove duplicates
        const uniqueEmojis = emojis.filter((emoji, index, self) => 
          index === self.findIndex(e => e.shortcode === emoji.shortcode)
        );
        
        console.log('[Scraper Script] Final result:', uniqueEmojis.length, 'unique emojis');
        return uniqueEmojis;
      })()
    `);
  }

  // Extract badge data from the page
  async extractBadgeData() {
    return await this.scrapingWindow.webContents.executeJavaScript(`
      (async () => {
        console.log('[Badge Scraper] Starting badge extraction...');
        
        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const badges = [];
        const seenBadges = new Set();
        
        // Look for badge containers
        const badgeContainers = document.querySelectorAll('yt-live-chat-author-badge-renderer');
        console.log('[Badge Scraper] Found ' + badgeContainers.length + ' badge containers');
        
        for (const container of badgeContainers) {
          // Check for image badges (membership)
          const imgBadges = container.querySelectorAll('img');
          for (const img of imgBadges) {
            const src = img.src;
            const alt = img.alt || '';
            
            if (src && !seenBadges.has(src)) {
              seenBadges.add(src);
              
              // Determine badge type from alt text
              let badgeType = 'unknown';
              const altLower = alt.toLowerCase();
              
              if (altLower.includes('member') || altLower.includes('sponsor')) {
                badgeType = 'member';
              }
              
              badges.push({
                type: badgeType,
                format: 'image',
                url: src,
                alt: alt,
                width: img.width || 16,
                height: img.height || 16
              });
              
              console.log('[Badge Scraper] Found image badge: ' + badgeType + ' - ' + src);
            }
          }
          
          // Check for SVG badges (moderator)
          const svgBadges = container.querySelectorAll('svg');
          for (const svg of svgBadges) {
            const viewBox = svg.getAttribute('viewBox');
            const pathElement = svg.querySelector('path');
            
            if (pathElement && viewBox === '0 0 16 16') {
              const pathData = pathElement.getAttribute('d');
              
              // Create unique identifier for this SVG
              const svgId = 'svg_' + pathData.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
              
              if (!seenBadges.has(svgId)) {
                seenBadges.add(svgId);
                
                // Determine badge type from path data
                let badgeType = 'unknown';
                if (pathData && pathData.includes('M9.64589146')) {
                  badgeType = 'moderator';
                }
                
                badges.push({
                  type: badgeType,
                  format: 'svg',
                  svgData: svg.outerHTML,
                  pathData: pathData,
                  viewBox: viewBox,
                  id: svgId
                });
                
                console.log('[Badge Scraper] Found SVG badge: ' + badgeType + ' - ' + svgId);
              }
            }
          }
        }
        
        console.log('[Badge Scraper] Extraction complete. Found ' + badges.length + ' unique badges');
        return badges;
      })();
    `);
  }

  // Download and cache emojis locally
  async cacheEmojis(emojiData) {
    const downloadPromises = emojiData.map(async (emoji) => {
      try {
        // Skip if already cached
        if (this.emojiCache.has(emoji.shortcode)) {
          return;
        }
        
        // Sanitize filename
        const filename = this.sanitizeFilename(emoji.shortcode) + '.png';
        const localPath = path.join(this.cacheDir, filename);
        
        // Download emoji
        await this.downloadEmoji(emoji.url, localPath);
        
        // Add to cache
        this.emojiCache.set(emoji.shortcode, localPath);
        console.log(`[YouTube Emoji Scraper] Cached emoji: ${emoji.shortcode}`);
        
      } catch (error) {
        console.error(`[YouTube Emoji Scraper] Failed to cache emoji ${emoji.shortcode}:`, error);
      }
    });
    
    await Promise.all(downloadPromises);
  }

  // Download emoji image from URL
  downloadEmoji(url, localPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
        
        file.on('error', (error) => {
          fs.unlink(localPath, () => {}); // Delete partial file
          reject(error);
        });
        
      }).on('error', reject);
    });
  }

  // Download and cache badges locally
  async cacheBadges(badgeData) {
    const downloadPromises = badgeData.map(async (badge) => {
      try {
        // Skip if already cached
        if (this.badgeCache.has(badge.type)) {
          return;
        }
        
        const filename = `${badge.type}.png`;
        const localPath = path.join(this.badgeCacheDir, filename);
        
        if (badge.format === 'image') {
          // Download image badge
          await this.downloadBadge(badge.url, localPath);
        } else if (badge.format === 'svg') {
          // Convert SVG to PNG
          await this.convertSvgToPng(badge.svgData, localPath);
        }
        
        // Add to cache
        this.badgeCache.set(badge.type, localPath);
        console.log(`[YouTube Emoji Scraper] Cached badge: ${badge.type} -> ${localPath}`);
        
      } catch (error) {
        console.error(`[YouTube Emoji Scraper] Failed to cache badge ${badge.type}:`, error);
      }
    });
    
    await Promise.all(downloadPromises);
    
    // Save mappings
    this.saveBadgeMappings();
    
    console.log(`[YouTube Emoji Scraper] Cached ${downloadPromises.length} badges`);
  }

  // Download badge image from URL
  async downloadBadge(url, localPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
        
        file.on('error', (error) => {
          fs.unlink(localPath, () => {}); // Delete partial file
          reject(error);
        });
        
      }).on('error', reject);
    });
  }

  // Convert SVG data to PNG file
  async convertSvgToPng(svgData, localPath) {
    return new Promise((resolve, reject) => {
      try {
        // Create a simple SVG to PNG conversion using canvas
        // Since we're in Node.js, we'll use a simple approach
        // For now, save the SVG data as a file and convert later
        
        // Extract the SVG content and create a proper SVG file
        const svgContent = svgData.includes('<svg') ? svgData : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">${svgData}</svg>`;
        
        // For now, save as SVG and we'll convert to PNG using the browser
        const svgPath = localPath.replace('.png', '.svg');
        fs.writeFileSync(svgPath, svgContent);
        
        // Use the scraping window to convert SVG to PNG
        this.convertSvgToPngInBrowser(svgContent, localPath)
          .then(resolve)
          .catch(reject);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  // Convert SVG to PNG using browser canvas
  async convertSvgToPngInBrowser(svgContent, localPath) {
    if (!this.scrapingWindow || this.scrapingWindow.isDestroyed()) {
      throw new Error('Scraping window not available for SVG conversion');
    }
    
    return await this.scrapingWindow.webContents.executeJavaScript(`
      (async () => {
        const svgContent = \`${svgContent.replace(/`/g, '\\`')}\`;
        
        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        
        // Create image from SVG
        const img = new Image();
        const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svgBlob);
        
        return new Promise((resolve, reject) => {
          img.onload = () => {
            // Draw SVG to canvas
            ctx.drawImage(img, 0, 0, 16, 16);
            
            // Convert to PNG data URL
            const pngDataUrl = canvas.toDataURL('image/png');
            URL.revokeObjectURL(url);
            
            resolve(pngDataUrl);
          };
          
          img.onerror = reject;
          img.src = url;
        });
      })();
    `).then(pngDataUrl => {
      // Convert data URL to buffer and save
      const base64Data = pngDataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(localPath, buffer);
    });
  }

  // Sanitize filename for safe storage
  sanitizeFilename(shortcode) {
    return shortcode
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 50); // Limit length
  }

  // Process message and replace emoji shortcodes with images
  processMessage(message) {
    if (!message || typeof message !== 'string') {
      return message;
    }
    
    return message.replace(/:([^:]+):/g, (match, shortcode) => {
      const fullShortcode = `:${shortcode}:`;
      let localPath = this.emojiCache.get(fullShortcode);
      
      // If not found and shortcode starts with underscore, try without underscore
      if (!localPath && shortcode.startsWith('_')) {
        const withoutUnderscore = `:${shortcode.substring(1)}:`;
        localPath = this.emojiCache.get(withoutUnderscore);
        console.log(`[YouTube Emoji Scraper] Trying without underscore: ${withoutUnderscore} -> ${localPath ? 'found' : 'not found'}`);
      }
      
      if (localPath && fs.existsSync(localPath)) {
        return `<img src="file://${localPath}" alt="${fullShortcode}" class="youtube-emoji" style="width: 36px; height: 36px; vertical-align: middle; display: inline-block;">`;
      }
      
      // If emoji not found, trigger background scraping to find it
      this.scheduleBackfillScraping();
      
      return match; // Return original shortcode if not cached
    });
  }

  // Schedule background scraping to find missing emojis
  scheduleBackfillScraping() {
    // Debounce: only schedule if not already scheduled
    if (this.backfillTimer) {
      return;
    }
    
    console.log('[YouTube Emoji Scraper] Scheduling backfill scraping in 30 seconds...');
    this.backfillTimer = setTimeout(() => {
      this.backfillTimer = null;
      this.performBackfillScraping();
    }, 30000); // Wait 30 seconds before scraping
  }

  // Perform background scraping to find missing emojis
  async performBackfillScraping() {
    try {
      console.log('[YouTube Emoji Scraper] Starting backfill scraping...');
      const currentCacheSize = this.emojiCache.size;
      const currentBadgeCacheSize = this.badgeCache.size;
      
      // Perform scraping
      await this.scrapeEmojis();
      
      const newCacheSize = this.emojiCache.size;
      const newBadgeCacheSize = this.badgeCache.size;
      const newEmojis = newCacheSize - currentCacheSize;
      const newBadges = newBadgeCacheSize - currentBadgeCacheSize;
      
      if (newEmojis > 0 || newBadges > 0) {
        console.log(`[YouTube Emoji Scraper] Backfill scraping found ${newEmojis} new emojis and ${newBadges} new badges`);
        // Notify that new emojis were found
        if (this.onEmojiCacheUpdated && newEmojis > 0) {
          this.onEmojiCacheUpdated(newEmojis);
        }
        // Notify that new badges were found
        if (this.onBadgeCacheUpdated && newBadges > 0) {
          this.onBadgeCacheUpdated(newBadges);
        }
      } else {
        console.log('[YouTube Emoji Scraper] Backfill scraping completed - no new emojis or badges found');
      }
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Backfill scraping failed:', error);
    }
  }

  // Set callback for when emoji cache is updated
  setEmojiCacheUpdateCallback(callback) {
    this.onEmojiCacheUpdated = callback;
  }

  // Get cached emoji path
  getCachedEmoji(shortcode) {
    return this.emojiCache.get(shortcode);
  }

  // Get cached badge path
  getCachedBadge(badgeType) {
    return this.badgeCache.get(badgeType);
  }

  // Get badge URL for use in HTML
  getBadgeUrl(badgeType) {
    const localPath = this.badgeCache.get(badgeType);
    if (localPath && fs.existsSync(localPath)) {
      // Convert to file:// URL for use in HTML
      return `file://${localPath.replace(/\\/g, '/')}`;
    }
    return null;
  }

  // Set callback for when badge cache is updated
  setBadgeCacheUpdateCallback(callback) {
    this.onBadgeCacheUpdated = callback;
  }

  // Set callback for Jewel gift detection
  setJewelDetectionCallback(callback) {
    this.onJewelDetected = callback;
    console.log('[YouTube Emoji Scraper] Jewel detection callback set');
  }

  // Start Jewel gift scraping (every 15 seconds)
  startJewelScraping() {
    if (this.jewelScrapingInterval) {
      console.log('[YouTube Emoji Scraper] Jewel scraping already running');
      return;
    }
    
    console.log('[YouTube Emoji Scraper] Starting Jewel gift scraping (15-second intervals)');
    
    // Perform initial scrape
    this.scrapeJewels();
    
    // Set up interval for periodic scraping
    this.jewelScrapingInterval = setInterval(() => {
      this.scrapeJewels();
    }, 15000); // 15 seconds
  }

  // Stop Jewel gift scraping
  stopJewelScraping() {
    if (this.jewelScrapingInterval) {
      clearInterval(this.jewelScrapingInterval);
      this.jewelScrapingInterval = null;
      console.log('[YouTube Emoji Scraper] Stopped Jewel gift scraping');
    }
  }

  // Main Jewel gift scraping method
  async scrapeJewels() {
    try {
      // Check if we need to initialize or refresh the scraping window
      let needsRefresh = false;
      
      if (!this.scrapingWindow || this.scrapingWindow.isDestroyed()) {
        console.log('[YouTube Emoji Scraper] Scraping window not available - initializing...');
        await this.initializeScrapingWindow();
        
        // Verify window was created successfully
        if (!this.scrapingWindow) {
          throw new Error('Failed to initialize scraping window');
        }
        
        needsRefresh = true;
      } else {
        // Check if window is on the correct URL
        try {
          const currentUrl = await this.scrapingWindow.webContents.executeJavaScript('window.location.href');
          const { chatUrl } = await this.getStreamUrl();
          
          if (!currentUrl.includes('live_chat') || !currentUrl.includes('youtube.com')) {
            console.log('[YouTube Emoji Scraper] Window on wrong URL, needs refresh');
            needsRefresh = true;
          }
        } catch (error) {
          console.log('[YouTube Emoji Scraper] Unable to check current URL, assuming needs refresh');
          needsRefresh = true;
        }
      }
      
      // Only load URL if window needs refresh
      if (needsRefresh) {
        const { chatUrl } = await this.getStreamUrl();
        console.log('[YouTube Emoji Scraper] Loading chat URL:', chatUrl);
        await this.scrapingWindow.loadURL(chatUrl);
        await this.waitForPageLoad();
      }
      
      console.log('[YouTube Emoji Scraper] Scanning for Jewel gifts...');
      
      // First, debug what page we're actually on
      const debugInfo = await this.scrapingWindow.webContents.executeJavaScript(`
        ({
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          hasYtLiveChat: !!document.querySelector('yt-live-chat-app'),
          totalElements: document.querySelectorAll('*').length,
          giftElements: document.querySelectorAll('yt-gift-message-view-model').length,
          chatItems: document.querySelectorAll('yt-live-chat-item-list-renderer > *').length
        })
      `);
      
      console.log('[YouTube Emoji Scraper] Debug info:', debugInfo);
      
      // Extract Jewel gift data from DOM
      const jewelGifts = await this.scrapingWindow.webContents.executeJavaScript(`
        (async () => {
          console.log('[Jewel Scraper] Current URL:', window.location.href);
          console.log('[Jewel Scraper] Page title:', document.title);
          console.log('[Jewel Scraper] Document ready state:', document.readyState);
          
          // Target specific DOM selector for gift messages
          const giftElements = document.querySelectorAll('yt-gift-message-view-model');
          console.log('[Jewel Scraper] Found ' + giftElements.length + ' gift message elements');
          
          // If no gift elements, let's see what we do have
          if (giftElements.length === 0) {
            console.log('[Jewel Scraper] No gift elements found. Checking page structure...');
            console.log('[Jewel Scraper] Total elements on page:', document.querySelectorAll('*').length);
            console.log('[Jewel Scraper] Has yt-live-chat-app:', !!document.querySelector('yt-live-chat-app'));
            console.log('[Jewel Scraper] Chat items found:', document.querySelectorAll('yt-live-chat-item-list-renderer > *').length);
            
            // Look for any elements containing "Jewels"
            const jewelElements = Array.from(document.querySelectorAll('*')).filter(el => 
              el.textContent && el.textContent.includes('Jewels')
            );
            console.log('[Jewel Scraper] Elements containing "Jewels":', jewelElements.length);
            jewelElements.forEach((el, i) => {
              console.log('[Jewel Scraper] Jewel element ' + (i + 1) + ':', el.tagName, el.textContent.trim());
            });
            
            return []; // Return empty if no gift elements
          }
          
          const gifts = [];
          
          for (let i = 0; i < giftElements.length; i++) {
            const giftElement = giftElements[i];
            try {
              console.log('[Jewel Scraper] Processing gift element ' + (i + 1));
              
              // Extract sender name - look for the span with role="text" directly
              const authorElement = giftElement.querySelector('#author-name span[role="text"]');
              const senderName = authorElement ? authorElement.textContent.trim() : 'Unknown';
              console.log('[Jewel Scraper] Sender name:', senderName);
              
              // Extract gift message - look for the span with role="text" directly
              const messageElement = giftElement.querySelector('#message span[role="text"]');
              const giftMessage = messageElement ? messageElement.textContent.trim() : '';
              console.log('[Jewel Scraper] Gift message:', giftMessage);
              
              // Create unique gift ID based on message content (not timestamp)
              const messageHash = giftMessage.replace(/\\s+/g, '').toLowerCase();
              const giftId = senderName + '_' + messageHash;
              
              // Updated regex pattern to handle both formats:
              // Format 1: "sent 100 for 2 Jewels" (numeric gifts)
              // Format 2: "sent Party hat for 20 Jewels" (named gifts)
              const match = giftMessage.match(/sent\\s+(.+?)\\s+for\\s+([\\d,]+)\\s+Jewels?/i);
              
              if (match) {
                const giftName = match[1].trim(); // Could be number (100) or name (Party hat)
                const jewelCount = parseInt(match[2].replace(/,/g, '')); // Jewel cost to track
                console.log('[Jewel Scraper] Parsed - Gift:', giftName, 'Jewels:', jewelCount);
                
                // Determine if this is a monetary gift or named gift
                const isMonetaryGift = /^[\\d,]+$/.test(giftName);
                const displayGiftName = isMonetaryGift ? \`$\${giftName}\` : giftName;
                
                // Get gift icon - handle both SVG and CSS mask formats
                let iconData = null;
                
                // Try SVG first - updated selector to match actual DOM structure
                const svgElement = giftElement.querySelector('#icon svg');
                if (svgElement) {
                  // Also get the color from the parent yt-icon element
                  const ytIconElement = giftElement.querySelector('#icon yt-icon');
                  const iconColor = ytIconElement ? ytIconElement.style.color : 'rgb(255, 0, 0)';
                  iconData = { 
                    type: 'svg', 
                    data: svgElement.outerHTML,
                    color: iconColor
                  };
                  console.log('[Jewel Scraper] Found SVG icon with color:', iconColor);
                } else {
                  // Try CSS mask format (older format)
                  const maskElement = giftElement.querySelector('#icon yt-icon .yt-icon-shape div');
                  if (maskElement) {
                    const style = maskElement.style;
                    const maskUrl = style.mask || style.webkitMask;
                    if (maskUrl && maskUrl.includes('gift')) {
                      iconData = { 
                        type: 'mask', 
                        data: maskUrl,
                        color: giftElement.querySelector('#icon yt-icon').style.color || 'rgb(255, 0, 0)'
                      };
                      console.log('[Jewel Scraper] Found CSS mask icon:', maskUrl);
                    }
                  }
                }
                
                // Try to find sender avatar from parent chat elements
                let senderAvatar = null;
                
                // Look in multiple possible parent containers
                const parentContainers = [
                  giftElement.closest('yt-live-chat-paid-message-renderer'),
                  giftElement.closest('yt-live-chat-item-list-renderer'),
                  giftElement.parentElement,
                  giftElement.parentElement?.parentElement
                ];
                
                for (const container of parentContainers) {
                  if (container) {
                    const avatarImg = container.querySelector('img[id*="img"], img[id*="avatar"], img[src*="photo"]');
                    if (avatarImg && avatarImg.src) {
                      senderAvatar = avatarImg.src;
                      console.log('[Jewel Scraper] Found avatar:', senderAvatar.substring(0, 50) + '...');
                      break;
                    }
                  }
                }
                
                const giftData = {
                  id: giftId,
                  senderName: senderName,
                  giftName: giftName, // Raw gift name/amount
                  displayGiftName: displayGiftName, // Formatted for display
                  jewelCount: jewelCount, // The jewel cost (what we track)
                  isMonetaryGift: isMonetaryGift, // Whether this is a $ amount or named gift
                  message: giftMessage,
                  iconData: iconData, // Updated to handle both SVG and mask
                  senderAvatar: senderAvatar,
                  timestamp: Date.now()
                };
                
                gifts.push(giftData);
                
                console.log('[Jewel Scraper] Successfully processed gift:', {
                  sender: senderName,
                  giftName: displayGiftName,
                  jewels: jewelCount,
                  type: isMonetaryGift ? 'monetary' : 'named',
                  hasIcon: !!iconData,
                  hasAvatar: !!senderAvatar
                });
              } else {
                console.log('[Jewel Scraper] Could not parse gift message:', giftMessage);
                console.log('[Jewel Scraper] Regex test result:', /sent\\s+(.+?)\\s+for\\s+([\\d,]+)\\s+Jewels?/i.test(giftMessage));
              }
            } catch (error) {
              console.error('[Jewel Scraper] Error processing gift element ' + (i + 1) + ':', error);
            }
          }
          
          console.log('[Jewel Scraper] Processing complete. Found ' + gifts.length + ' valid gifts');
          return gifts;
        })();
      `);
      
      // Process detected Jewel gifts
      if (jewelGifts && jewelGifts.length > 0) {
        console.log(`[YouTube Emoji Scraper] Found ${jewelGifts.length} Jewel gifts`);
        
        // Filter out duplicates using cache
        const newGifts = jewelGifts.filter(gift => !this.jewelGiftCache.has(gift.id));
        
        if (newGifts.length > 0) {
          console.log(`[YouTube Emoji Scraper] ${newGifts.length} new Jewel gifts detected`);
          
          // Add to cache
          newGifts.forEach(gift => {
            this.jewelGiftCache.set(gift.id, gift);
          });
          
          // Notify callback with new gifts
          if (this.onJewelDetected) {
            this.onJewelDetected(newGifts);
          }
          
          // Clean up old entries from cache (keep last 100)
          if (this.jewelGiftCache.size > 100) {
            const entries = Array.from(this.jewelGiftCache.entries());
            const toRemove = entries.slice(0, entries.length - 100);
            toRemove.forEach(([id]) => this.jewelGiftCache.delete(id));
          }
        } else {
          console.log('[YouTube Emoji Scraper] All gifts were duplicates (already processed)');
        }
      } else {
        console.log('[YouTube Emoji Scraper] No Jewel gifts found in current scan');
      }
      
      return jewelGifts || [];
      
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Jewel scraping failed:', error);
      return [];
    }
  }

  // Get cache statistics
  getCacheStats() {
    return {
      totalEmojis: this.emojiCache.size,
      totalBadges: this.badgeCache.size,
      cacheDirectory: this.cacheDir,
      badgeCacheDirectory: this.badgeCacheDir,
      mappingFile: this.mappingFile,
      badgeMappingFile: this.badgeMappingFile
    };
  }

  // Clear emoji cache
  clearCache() {
    try {
      // Remove all cached emoji files
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
      }
      
      // Remove all cached badge files
      if (fs.existsSync(this.badgeCacheDir)) {
        const files = fs.readdirSync(this.badgeCacheDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.badgeCacheDir, file));
        }
      }
      
      // Clear memory caches
      this.emojiCache.clear();
      this.badgeCache.clear();
      
      console.log('[YouTube Emoji Scraper] Emoji and badge caches cleared');
      return { success: true };
    } catch (error) {
      console.error('[YouTube Emoji Scraper] Failed to clear cache:', error);
      return { success: false, error: error.message };
    }
  }

  // Start periodic scraping every 5 minutes
  startPeriodicScraping() {
    if (this.periodicTimer) {
      return; // Already started
    }
    
    console.log('[YouTube Emoji Scraper] Starting periodic scraping every 5 minutes');
    this.periodicTimer = setInterval(() => {
      this.performBackfillScraping();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  // Stop periodic scraping
  stopPeriodicScraping() {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
      console.log('[YouTube Emoji Scraper] Stopped periodic scraping');
    }
    
    if (this.backfillTimer) {
      clearTimeout(this.backfillTimer);
      this.backfillTimer = null;
    }
  }


  // Cleanup resources
  destroy() {
    console.log('[YouTube Emoji Scraper] Destroying scraper and cleaning up resources...');
    
    // Stop all timers
    this.stopPeriodicScraping();
    
    // Stop Jewel scraping
    this.stopJewelScraping();
    
    // Close and destroy scraping window
    if (this.scrapingWindow && !this.scrapingWindow.isDestroyed()) {
      console.log('[YouTube Emoji Scraper] Closing scraping window...');
      this.scrapingWindow.close();
      this.scrapingWindow.destroy();
      this.scrapingWindow = null;
    }
    
    // Clear callbacks
    this.onEmojiCacheUpdated = null;
    this.onBadgeCacheUpdated = null;
    this.onJewelDetected = null;
    
    console.log('[YouTube Emoji Scraper] Cleanup complete');
  }
}

module.exports = YouTubeEmojiScraper;

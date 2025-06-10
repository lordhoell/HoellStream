// auth.js - Central authentication module for HoellStream
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const fetch = require('node-fetch');

// Helper functions to get paths (lazy-loaded)
function getTokensPath() {
  return path.join(app.getPath('userData'), 'tokens.secure');
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Load configuration
function loadConfig() {
  try {
    // Check if app is ready before trying to access userData path
    if (!app || !app.getPath) {
      console.warn('App not ready yet, returning empty config');
      return {};
    }
    return JSON.parse(fs.readFileSync(getConfigPath()));
  } catch (error) {
    console.error('Error loading config:', error);
    return {};
  }
}

// Save configuration
function saveConfig(config) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

// Load OAuth tokens
function loadTokens() {
  try {
    const tokenPath = getTokensPath();
    if (fs.existsSync(tokenPath)) {
      const encrypted = fs.readFileSync(tokenPath);
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted);
    }
    return {};
  } catch (error) {
    console.error('Error loading tokens:', error);
    return {};
  }
}

// Save OAuth tokens
function saveTokens(tokens) {
  try {
    const tokenPath = getTokensPath();
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens, null, 2));
    fs.writeFileSync(tokenPath, encrypted);
    return true;
  } catch (error) {
    console.error('Error saving tokens:', error);
    return false;
  }
}

// Ensure Twitch token is valid and refresh if needed
async function ensureTwitchToken() {
  console.log('[Auth] ensureTwitchToken() called');
  const tokens = loadTokens();
  
  if (!tokens?.twitch?.access_token) {
    console.error('[Auth] No Twitch OAuth token available');
    return false;
  }
  
  console.log('[Auth] Twitch token found, checking expiry...');
  console.log('[Auth] Token expires at:', tokens.twitch.expires_at);
  console.log('[Auth] Current time:', new Date().toISOString());
  
  // Check if token is expired or has no expiry date (treat as expired)
  const hasExpiry = tokens.twitch.expires_at;
  const isExpired = hasExpiry ? new Date(tokens.twitch.expires_at) <= new Date() : true;
  
  if (!hasExpiry) {
    console.log('[Auth] Twitch token has no expiry date - treating as expired and refreshing...');
  } else if (isExpired) {
    console.log('[Auth] Twitch token expired, refreshing...');
  }
  
  if (isExpired) {
    if (!tokens.twitch.refresh_token) {
      console.error('[Auth] No Twitch refresh token available');
      return false;
    }
    
    try {
      const config = loadConfig();
      const TWITCH_CLIENT_ID = config.TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID;
      const TWITCH_CLIENT_SECRET = config.TWITCH_CLIENT_SECRET || process.env.TWITCH_CLIENT_SECRET;
      
      console.log('[Auth] Client ID available:', !!TWITCH_CLIENT_ID);
      console.log('[Auth] Client Secret available:', !!TWITCH_CLIENT_SECRET);
      
      if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
        console.error('[Auth] Missing Twitch client credentials for token refresh. Please configure them in Settings.');
        return false;
      }
      
      console.log('[Auth] Attempting token refresh...');
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: TWITCH_CLIENT_ID,
          client_secret: TWITCH_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: tokens.twitch.refresh_token
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Auth] Twitch token refresh failed:', response.status, errorText);
        return false;
      }
      
      const data = await response.json();
      console.log('[Auth] Token refresh response received');
      
      // Update token with new values
      tokens.twitch.access_token = data.access_token;
      tokens.twitch.refresh_token = data.refresh_token;
      tokens.twitch.expires_at = new Date(Date.now() + data.expires_in * 1000).toISOString();
      
      const saved = saveTokens(tokens);
      console.log('[Auth] Tokens saved:', saved);
      console.log('[Auth] New expiry time:', tokens.twitch.expires_at);
      console.log('[Auth] Twitch token refreshed successfully');
    } catch (error) {
      console.error('[Auth] Error refreshing Twitch token:', error);
      return false;
    }
  } else {
    console.log('[Auth] Twitch token is still valid, no refresh needed');
  }
  
  return true;
}

// Ensure YouTube token is valid and refresh if needed
async function ensureYouTubeToken() {
  console.log('[Auth] ensureYouTubeToken() called');
  const tokens = loadTokens();
  
  if (!tokens?.youtube?.access_token) {
    console.error('[Auth] No YouTube OAuth token available');
    return false;
  }
  
  console.log('[Auth] YouTube token found, checking expiry...');
  console.log('[Auth] YouTube token expires at:', tokens.youtube.expires_at);
  console.log('[Auth] Current time:', new Date().toISOString());
  
  // Check if token is expired
  if (tokens.youtube.expires_at && new Date(tokens.youtube.expires_at) <= new Date()) {
    console.log('[Auth] YouTube token expired, refreshing...');
    
    if (!tokens.youtube.refresh_token) {
      console.error('[Auth] No YouTube refresh token available');
      return false;
    }
    
    try {
      const config = loadConfig();
      const YOUTUBE_CLIENT_ID = config.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID;
      const YOUTUBE_CLIENT_SECRET = config.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET;
      
      console.log('[Auth] YouTube Client ID available:', !!YOUTUBE_CLIENT_ID);
      console.log('[Auth] YouTube Client Secret available:', !!YOUTUBE_CLIENT_SECRET);
      
      if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
        console.error('[Auth] Missing YouTube client credentials for token refresh. Please configure them in Settings.');
        return false;
      }
      
      console.log('[Auth] Attempting YouTube token refresh...');
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: YOUTUBE_CLIENT_ID,
          client_secret: YOUTUBE_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: tokens.youtube.refresh_token
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Auth] YouTube token refresh failed:', response.status, errorText);
        return false;
      }
      
      const data = await response.json();
      console.log('[Auth] YouTube token refresh response received');
      
      // Update token with new values
      tokens.youtube.access_token = data.access_token;
      tokens.youtube.scope = data.scope;
      tokens.youtube.token_type = data.token_type;
      if (data.refresh_token) {
        tokens.youtube.refresh_token = data.refresh_token;
      }
      if (data.expires_in) {
        tokens.youtube.expires_at = new Date(Date.now() + data.expires_in * 1000).toISOString();
      }
      console.log('[Auth] YouTube token refreshed successfully');
      console.log('[Auth] New YouTube token expires at:', tokens.youtube.expires_at);
      saveTokens(tokens);
    } catch (error) {
      console.error('[Auth] Error refreshing YouTube token:', error);
      return false;
    }
  } else {
    console.log('[Auth] YouTube token is still valid, no refresh needed');
  }
  
  return true;
}

// Get Twitch stream info
async function getTwitchStreamInfo() {
  try {
    const valid = await ensureTwitchToken();
    if (!valid) {
      return { success: false, error: 'No valid Twitch token' };
    }
    
    const tokens = loadTokens();
    const config = loadConfig();
    
    // Get the channel name from tokens or config
    const channelName = tokens.twitch.username || config.TWITCH_CHANNEL;
    if (!channelName) {
      return { success: false, error: 'No Twitch channel name available' };
    }
    
    console.log(`Fetching Twitch stream info for channel: ${channelName}`);
    
    const response = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${channelName}`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID || config.TWITCH_CLIENT_ID || 'o2z2j4tesfnnq8l3ygjvsf9xu7ngdm',
          'Authorization': `Bearer ${tokens.twitch.access_token}`
        }
      }
    );
    
    if (!response.ok) {
      return { 
        success: false, 
        error: `Twitch API returned status ${response.status}` 
      };
    }
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      // Stream is live
      return {
        success: true,
        live: true,
        viewerCount: data.data[0].viewer_count,
        title: data.data[0].title,
        startedAt: data.data[0].started_at
      };
    } else {
      // Stream is offline
      return {
        success: true,
        live: false
      };
    }
  } catch (error) {
    console.error('Error fetching Twitch stream info:', error);
    return { success: false, error: error.message };
  }
}

// Get YouTube stream info
async function getYouTubeStreamInfo() {
  try {
    const valid = await ensureYouTubeToken();
    if (!valid) {
      return { success: false, error: 'No valid YouTube token' };
    }
    
    const tokens = loadTokens();
    const config = loadConfig();
    
    if (!config.YT_STREAM_ID) {
      return { success: false, error: 'No YouTube stream ID available' };
    }
    
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${config.YT_STREAM_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.youtube.access_token}`
        }
      }
    );
    
    if (!response.ok) {
      return { 
        success: false, 
        error: `YouTube API returned status ${response.status}` 
      };
    }
    
    const data = await response.json();
    
    if (data.items && data.items.length > 0 && data.items[0].liveStreamingDetails) {
      const details = data.items[0].liveStreamingDetails;
      return {
        success: true,
        live: true,
        viewerCount: details.concurrentViewers || '0',
        scheduledStartTime: details.scheduledStartTime,
        actualStartTime: details.actualStartTime
      };
    } else {
      return {
        success: true,
        live: false
      };
    }
  } catch (error) {
    console.error('Error fetching YouTube stream info:', error);
    return { success: false, error: error.message };
  }
}

// Get YouTube live chat ID based on Stack Overflow approach
async function getYouTubeLiveChatId() {
  try {
    // First check if there's a manually entered YouTube Live ID in the config
    const config = loadConfig();
    
    // If there's a manually entered stream ID in the settings, use it directly
    if (config.YT_STREAM_ID && config.YT_STREAM_ID.trim() !== '') {
      console.log('[YT] Using manually entered YouTube Stream ID from settings');
      console.log('[YT] Manual Stream ID:', config.YT_STREAM_ID);
      
      // Get the live chat ID for this stream ID
      const valid = await ensureYouTubeToken();
      if (valid) {
        const tokens = loadTokens();
        console.log('[YT] Loaded tokens, YouTube token exists:', !!tokens.youtube?.access_token);
        
        const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${config.YT_STREAM_ID}&mine=true`;
        console.log('[YT] Fetching video details from:', videoUrl);
        
        const videoResponse = await fetch(videoUrl, {
          headers: {
            'Authorization': `Bearer ${tokens.youtube.access_token}`
          }
        });
        
        console.log('[YT] Video API response status:', videoResponse.status);
        
        if (videoResponse.ok) {
          const videoData = await videoResponse.json();
          console.log('[YT] Video API response:', JSON.stringify(videoData, null, 2));
          
          if (videoData.items && videoData.items.length > 0) {
            const video = videoData.items[0];
            console.log('[YT] Video title:', video.snippet?.title);
            console.log('[YT] Video live streaming details:', JSON.stringify(video.liveStreamingDetails, null, 2));
            
            // Check if the stream has ended
            if (video.liveStreamingDetails?.actualEndTime) {
              console.log('[YT] Stream has ended (actualEndTime found):', video.liveStreamingDetails.actualEndTime);
              console.log('[YT] Manual stream ID provided - stopping here');
              return { ended: true }; // Special return value to indicate ended stream
            }
            
            // Check for both activeLiveChatId (live streams) and liveChatId (scheduled streams)
            const liveChatId = video.liveStreamingDetails?.activeLiveChatId || video.liveStreamingDetails?.liveChatId;
            
            // If we have any live chat ID, the stream is ready (regardless of timing)
            if (liveChatId) {
              console.log(`[YT] Found live chat ID: ${liveChatId}`);
              
              // Check if stream is currently live
              if (video.liveStreamingDetails?.actualStartTime && !video.liveStreamingDetails?.actualEndTime) {
                console.log('[YT] Stream is currently live');
                return liveChatId;
              }
              
              // Check if stream is scheduled (has scheduledStartTime but no actualStartTime)
              if (video.liveStreamingDetails?.scheduledStartTime && !video.liveStreamingDetails?.actualStartTime) {
                const scheduledTime = new Date(video.liveStreamingDetails.scheduledStartTime);
                const now = new Date();
                console.log('[YT] Stream is scheduled for:', scheduledTime);
                console.log('[YT] Current time:', now);
                
                // If scheduled time has passed but no actualStartTime, stream is likely ready to start
                if (scheduledTime <= now) {
                  console.log('[YT] Scheduled time has passed and chat is available - stream is ready');
                  return liveChatId;
                } else {
                  console.log('[YT] Stream is scheduled for the future but chat is already available');
                  return liveChatId;
                }
              }
              
              // Fallback: if we have liveChatId but unclear timing, assume it's ready
              console.log('[YT] Live chat ID available - assuming stream is ready');
              return liveChatId;
            }
            
            // No live chat ID available - check if it's a future scheduled stream
            if (video.liveStreamingDetails?.scheduledStartTime && !video.liveStreamingDetails?.actualStartTime) {
              const scheduledTime = new Date(video.liveStreamingDetails.scheduledStartTime);
              const now = new Date();
              console.log('[YT] Stream is scheduled for:', scheduledTime);
              console.log('[YT] Current time:', now);
              
              if (scheduledTime > now) {
                console.log('[YT] Stream is scheduled for the future but no chat ID yet');
                console.log('[YT] Returning special scheduled indicator to maintain connection');
                return { scheduled: true, scheduledTime: scheduledTime.toISOString() };
              }
            }
            
            // Check if the stream is currently live
            if (video.liveStreamingDetails?.actualStartTime && !video.liveStreamingDetails?.actualEndTime) {
              console.log('[YT] Stream is currently live but no live chat ID found');
              console.log('[YT] This usually means chat is not enabled for this stream');
            } else {
              console.log('[YT] Stream is not currently live and not scheduled for the future');
            }
          } else {
            console.log('[YT] No video found with the manually entered stream ID');
            console.log('[YT] The stream ID may be incorrect or the video may not exist');
          }
        } else {
          const errorText = await videoResponse.text();
          console.log('[YT] Video API error response status:', videoResponse.status);
          console.log('[YT] Video API error response:', errorText);
        }
      }
      
      // Manual stream ID was provided - don't fall through to automatic detection
      console.log('[YT] Manual stream ID provided - stopping here');
      return null;
    }
    
    // DISABLED: Auto-detection to prevent expensive API quota usage
    // The search API costs 100 quota units per call - too expensive!
    // Always use manual stream ID instead.
    console.log('[YT] Auto-detection disabled - manual stream ID required');
    return null;
    
    /*
    // If no manual ID or it didn't work, proceed with the automatic detection
    const valid = await ensureYouTubeToken();
    if (!valid) {
      console.error('[YT] No valid YouTube token');
      return null;
    }
    
    const tokens = loadTokens();
    
    if (!tokens.youtube.channelId) {
      console.error('[YT] No YouTube channel ID found in tokens');
      return null;
    }
    
    console.log('[YT] Looking for live streams for channel:', tokens.youtube.channelId);
    
    // APPROACH 1: Direct search for live streams (most reliable according to Stack Overflow)
    console.log('[YT] CHECKING: Looking for LIVE streams...');
    const searchResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${tokens.youtube.channelId}&eventType=live&type=video&mine=true`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.youtube.access_token}`
        }
      }
    );
    
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      console.log('[YT] Live search results:', searchData.items?.length || 0);
      
      if (searchData.items && searchData.items.length > 0) {
        // Found a live stream via search, now get its details to get the liveChatId
        const videoId = searchData.items[0].id.videoId;
        console.log(`[YT] Found live video ID: ${videoId}`);
        
        const videoResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${videoId}`,
          {
            headers: {
              'Authorization': `Bearer ${tokens.youtube.access_token}`
            }
          }
        );
        
        if (videoResponse.ok) {
          const videoData = await videoResponse.json();
          
          if (videoData.items && videoData.items.length > 0) {
            const video = videoData.items[0];
            const liveChatId = video.liveStreamingDetails?.activeLiveChatId;
            
            if (liveChatId) {
              console.log(`[YT] Found live chat ID: ${liveChatId}`);
              config.YT_STREAM_ID = videoId;
              saveConfig(config);
              return liveChatId;
            } else {
              console.log('[YT] No liveChatId found for this live video');
            }
          }
        }
      }
    }
    
    // APPROACH 2: Try liveBroadcasts API with mine=true (requires proper scopes)
    console.log('[YT] No live streams found, checking for broadcasts...');
    console.log('[YT] CHECKING: Looking for ACTIVE broadcasts...');
    const broadcastResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,contentDetails,status&broadcastStatus=active&broadcastType=all&mine=true`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.youtube.access_token}`
        }
      }
    );
    
    if (broadcastResponse.ok) {
      const broadcastData = await broadcastResponse.json();
      console.log('[YT] Active broadcasts found:', broadcastData.items?.length || 0);
      
      if (broadcastData.items && broadcastData.items.length > 0) {
        // Filter to ensure we only get broadcasts from our channel
        const userBroadcasts = broadcastData.items.filter(broadcast => 
          broadcast.snippet?.channelId === tokens.youtube.channelId
        );
        
        if (userBroadcasts.length > 0) {
          const broadcast = userBroadcasts[0];
          const liveChatId = broadcast.snippet?.liveChatId;
          
          if (liveChatId) {
            console.log(`[YT] Found live chat ID from broadcast: ${liveChatId}`);
            config.YT_STREAM_ID = broadcast.id;
            saveConfig(config);
            return liveChatId;
          }
        }
      }
    }
    
    // APPROACH 3: Check for upcoming broadcasts as fallback
    console.log('[YT] No active broadcasts found, checking for upcoming...');
    console.log('[YT] CHECKING: Looking for SCHEDULED/UPCOMING broadcasts...');
    const upcomingResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,contentDetails,status&broadcastStatus=upcoming&broadcastType=all&mine=true`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.youtube.access_token}`
        }
      }
    );
    
    if (upcomingResponse.ok) {
      const upcomingData = await upcomingResponse.json();
      console.log('[YT] Upcoming broadcasts API response:', JSON.stringify(upcomingData, null, 2));
      console.log('[YT] Upcoming broadcasts found:', upcomingData.items?.length || 0);
      
      if (upcomingData.items && upcomingData.items.length > 0) {
        // Filter to ensure we only get broadcasts from our channel
        const userBroadcasts = upcomingData.items.filter(broadcast => 
          broadcast.snippet?.channelId === tokens.youtube.channelId
        );
        
        console.log('[YT] Found', userBroadcasts.length, 'upcoming broadcasts for this channel');
        
        if (userBroadcasts.length > 0) {
          const upcomingBroadcast = userBroadcasts[0];
          
          // Simple logging for scheduled streams
          console.log('[YT] SCHEDULED STREAM FOUND:', upcomingBroadcast.snippet?.title);
          console.log('[YT] Scheduled for:', upcomingBroadcast.snippet?.scheduledStartTime);
          console.log('[YT] Stream ID:', upcomingBroadcast.id);
          
          // Check if there's a liveChatId available for this scheduled stream
          const liveChatId = upcomingBroadcast.snippet?.liveChatId;
          
          if (liveChatId) {
            console.log('[YT] Found live chat ID for scheduled stream:', liveChatId);
            config.YT_STREAM_ID = upcomingBroadcast.id;
            saveConfig(config);
            return liveChatId;
          } else {
            console.log('[YT] No liveChatId found for this scheduled stream. Chat may not be enabled yet.');
            
            // Save the stream ID for future use
            config.YT_STREAM_ID = upcomingBroadcast.id;
            saveConfig(config);
            
            // Return a special object to indicate an upcoming stream was found
            // This allows the UI to show "Scheduled" instead of "Disconnected"
            return {
              status: 'upcoming',
              id: upcomingBroadcast.id,
              title: upcomingBroadcast.snippet?.title,
              scheduledStartTime: upcomingBroadcast.snippet?.scheduledStartTime,
              privacyStatus: upcomingBroadcast.status?.privacyStatus,
              lifeCycleStatus: upcomingBroadcast.status?.lifeCycleStatus
            };
          }
        }
      }
    }
    
    console.log('[YT] RESULT: No YouTube streams found (live, active, or scheduled)');
    console.log('[YT] ====== YOUTUBE STREAM CHECK COMPLETE ======');
    return null;
    */
  } catch (error) {
    console.error('Error getting YouTube live chat ID:', error);
    return null;
  }
}

// Export all functions
module.exports = {
  loadConfig,
  saveConfig,
  loadTokens,
  saveTokens,
  ensureTwitchToken,
  ensureYouTubeToken,
  getTwitchStreamInfo,
  getYouTubeStreamInfo,
  getYouTubeLiveChatId
};

    // Font size slider handlers
    function setupFontSizeSliders() {
      const sliders = [
        { id: 'chat-font-size', displayId: 'chat-font-size-display', unit: 'px' },
        { id: 'overlay-font-size', displayId: 'overlay-font-size-display', unit: 'em' },
        { id: 'stats-font-size', displayId: 'stats-font-size-display', unit: 'em' },
        { id: 'username-font-size', displayId: 'username-font-size-display', unit: 'em' }
      ];
      
      sliders.forEach(({ id, displayId, unit }) => {
        const slider = document.getElementById(id);
        const display = document.getElementById(displayId);
        
        slider.addEventListener('input', () => {
          display.textContent = slider.value + unit;
        });
      });
    }

    // Load existing config values when the window loads
    window.addEventListener('load', async () => {
      try {
        const config = await window.electron.ipcRenderer.invoke('load-config') || {};
        
        // Populate YouTube Live ID
        if (config.YT_STREAM_ID) {
          document.getElementById('youtube-live-id').value = config.YT_STREAM_ID;
        }
        
        // Populate YouTube bypass selector checkbox
        if (config.youtubeBypassSelector !== undefined) {
          document.getElementById('youtube-bypass-selector').checked = config.youtubeBypassSelector;
        }
        
        // Populate OAuth credentials
        if (config.TWITCH_CLIENT_ID) {
          document.getElementById('twitch-client-id').value = config.TWITCH_CLIENT_ID;
        }
        if (config.TWITCH_CLIENT_SECRET) {
          document.getElementById('twitch-client-secret').value = config.TWITCH_CLIENT_SECRET;
        }
        if (config.YOUTUBE_CLIENT_ID) {
          document.getElementById('youtube-client-id').value = config.YOUTUBE_CLIENT_ID;
        }
        if (config.YOUTUBE_CLIENT_SECRET) {
          document.getElementById('youtube-client-secret').value = config.YOUTUBE_CLIENT_SECRET;
        }
        
        // Load font size settings
        if (config.CHAT_FONT_SIZE) {
          document.getElementById('chat-font-size').value = config.CHAT_FONT_SIZE;
          document.getElementById('chat-font-size-display').textContent = config.CHAT_FONT_SIZE + 'px';
        }
        if (config.OVERLAY_FONT_SIZE) {
          document.getElementById('overlay-font-size').value = config.OVERLAY_FONT_SIZE;
          document.getElementById('overlay-font-size-display').textContent = config.OVERLAY_FONT_SIZE + 'em';
        }
        if (config.STATS_FONT_SIZE) {
          document.getElementById('stats-font-size').value = config.STATS_FONT_SIZE;
          document.getElementById('stats-font-size-display').textContent = config.STATS_FONT_SIZE + 'em';
        }
        if (config.USERNAME_FONT_SIZE) {
          document.getElementById('username-font-size').value = config.USERNAME_FONT_SIZE;
          document.getElementById('username-font-size-display').textContent = config.USERNAME_FONT_SIZE + 'em';
        }
        
        // Set up font size sliders
        setupFontSizeSliders();
        
        // Load platform visibility settings
        loadPlatformVisibilitySettings(config);
        
        // Set up platform toggle button event listeners
        setupPlatformToggleListeners();
        
        // Load saved colors and update preview squares
        try {
          const colors = await window.electron.ipcRenderer.invoke('get-colors');
          console.log('Colors loaded:', colors);
          updateColorPreviews(colors);
        } catch (error) {
          console.error('Error loading colors:', error);
        }
      } catch (error) {
        console.error('Error loading config:', error);
      }
    });

    // Save all settings when the save button is clicked
    document.getElementById('save-all-settings').addEventListener('click', async () => {
      try {
        const ytLiveId = document.getElementById('youtube-live-id').value.trim();
        const twitchClientId = document.getElementById('twitch-client-id').value.trim();
        const twitchClientSecret = document.getElementById('twitch-client-secret').value.trim();
        const youtubeClientId = document.getElementById('youtube-client-id').value.trim();
        const youtubeClientSecret = document.getElementById('youtube-client-secret').value.trim();
        
        // Get font size values
        const chatFontSize = document.getElementById('chat-font-size').value;
        const overlayFontSize = document.getElementById('overlay-font-size').value;
        const statsFontSize = document.getElementById('stats-font-size').value;
        const usernameFontSize = document.getElementById('username-font-size').value;
        
        const config = await window.electron.ipcRenderer.invoke('load-config') || {};
        
        // Update config with new values
        config.YT_STREAM_ID = ytLiveId;
        config.youtubeStreamId = ytLiveId; // Also save as youtubeStreamId for overlay.js
        config.youtubeBypassSelector = document.getElementById('youtube-bypass-selector').checked;
        config.TWITCH_CLIENT_ID = twitchClientId;
        config.TWITCH_CLIENT_SECRET = twitchClientSecret;
        config.YOUTUBE_CLIENT_ID = youtubeClientId;
        config.YOUTUBE_CLIENT_SECRET = youtubeClientSecret;
        
        // Update font size settings
        config.CHAT_FONT_SIZE = chatFontSize;
        config.OVERLAY_FONT_SIZE = overlayFontSize;
        config.STATS_FONT_SIZE = statsFontSize;
        config.USERNAME_FONT_SIZE = usernameFontSize;
        
        // Update platform visibility settings
        config.PLATFORM_VISIBILITY = {
          tiktok: getPlatformVisibility('tiktok'),
          twitch: getPlatformVisibility('twitch'),
          youtube: getPlatformVisibility('youtube')
        };
        
        await window.electron.ipcRenderer.invoke('save-config', config);
        
        // Show brief success message
        const status = document.getElementById('status');
        status.textContent = 'All settings saved! Refreshing authentication...';
        status.className = 'status success';
        
        // Trigger auth refresh in overlay and chat
        await window.electron.ipcRenderer.invoke('refresh-overlay-auth');
        
        // Close the window after a short delay
        setTimeout(() => {
          window.electron.ipcRenderer.send('close-settings');
        }, 1500);
      } catch (error) {
        const status = document.getElementById('status');
        status.textContent = `Error saving settings: ${error.message}`;
        status.className = 'status error';
      }
    });

    // Save font sizes only when the font size save button is clicked
    document.getElementById('save-font-sizes').addEventListener('click', async () => {
      try {
        // Get font size values
        const chatFontSize = document.getElementById('chat-font-size').value;
        const overlayFontSize = document.getElementById('overlay-font-size').value;
        const statsFontSize = document.getElementById('stats-font-size').value;
        const usernameFontSize = document.getElementById('username-font-size').value;
        
        const config = await window.electron.ipcRenderer.invoke('load-config') || {};
        
        // Update only font size settings
        config.CHAT_FONT_SIZE = chatFontSize;
        config.OVERLAY_FONT_SIZE = overlayFontSize;
        config.STATS_FONT_SIZE = statsFontSize;
        config.USERNAME_FONT_SIZE = usernameFontSize;
        
        await window.electron.ipcRenderer.invoke('save-config', config);
        
        // Show brief success message
        const status = document.getElementById('status');
        status.textContent = 'Font sizes saved and applied!';
        status.className = 'status success';
        
        // Clear the status message after 3 seconds
        setTimeout(() => {
          status.textContent = '';
          status.className = 'status';
        }, 3000);
      } catch (error) {
        const status = document.getElementById('status');
        status.textContent = `Error saving font sizes: ${error.message}`;
        status.className = 'status error';
      }
    });

    // Test font sizes button - simulate events in overlay and chat
    document.getElementById('test-font-sizes').addEventListener('click', async () => {
      try {
        // Show status message
        const status = document.getElementById('status');
        status.textContent = 'Sending test events to overlay and chat for font size testing...';
        status.className = 'status success';
        
        // Send test data to overlay-ws.html (simulate events via IPC)
        window.electron.ipcRenderer.send('test-overlay-events', [
          // TikTok Gift Event (Real format)
          {
            event: 'gift',
            data: {
              giftName: 'Rose',
              giftId: 'rose',
              diamondCount: 1,
              repeatCount: 1,
              giftType: 1,
              repeatEnd: true,
              profilePictureUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0ZGMDA0NCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPlQ8L3RleHQ+PC9zdmc+',
              giftPictureUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZjAwNDQiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0ibTEyIDNjLTEuMiAwLTIuNCAwLTMuNiAwLTEuMiAwLTIuNCAwLTMuNiAwdjZjMCAxLjIgMCAyLjQgMCAzLjYgMCAxLjIgMCAyLjQgMCAzLjZoMThjMC0xLjIgMC0yLjQgMC0zLjYgMC0xLjIgMC0yLjQgMC0zLjZ2LTZjLTEuMiAwLTIuNCAwLTMuNiAwLTEuMiAwLTIuNCAwLTMuNiAweiIvPjwvc3ZnPg==',
              uniqueId: 'testtiktoker',
              nickname: 'TestTikToker'
            }
          },
          // TikTok Follow Event (Real format)
          {
            event: 'follow',
            data: {
              profilePictureUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0ZGMDA0NCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPlQ8L3RleHQ+PC9zdmc+',
              uniqueId: 'testfollower',
              nickname: 'TestFollower'
            }
          }
        ]);

        // Send test Twitch events (Real format)
        window.electron.ipcRenderer.send('test-twitch-events', [
          // Twitch Follow
          {
            type: 'follow',
            data: {
              displayName: 'TestTwitchFollower',
              username: 'testtwitchfollower',
              avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIiBmaWxsPSJub25lIiBzdHJva2U9IiNmZjAwNDQiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0ibTEyIDNjLTEuMiAwLTIuNCAwLTMuNiAwLTEuMiAwLTIuNCAwLTMuNiAwdjZjMCAxLjIgMCAyLjQgMCAzLjYgMCAxLjIgMCAyLjQgMCAzLjZoMThjMC0xLjIgMC0yLjQgMC0zLjYgMC0xLjIgMC0yLjQgMC0zLjZ2LTZjLTEuMiAwLTIuNCAwLTMuNiAwLTEuMiAwLTIuNCAwLTMuNiAweiIvPjwvc3ZnPg==',
              uniqueId: 'testtwitchfollower',
              nickname: 'TestTwitchFollower'
            }
          },
          // Twitch Bits
          {
            type: 'bits',
            data: {
              displayName: 'TestTwitchBits',
              username: 'testtwitchbits',
              avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzk0NmZmZiIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPkI8L3RleHQ+PC9zdmc+',
              amount: 100,
              bits: 100
            }
          }
        ]);

        // Send test YouTube events (Real format)
        window.electron.ipcRenderer.send('test-youtube-events', [
          // YouTube Super Chat
          {
            type: 'superchat',
            data: {
              displayName: 'TestYouTubeSuperChat',
              username: 'testyoutubesuperchat',
              avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIiBmaWxsPSJub25lIiBzdHJva2U9IiNmZjAwNDQiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0ibTEyIDNjLTEuMiAwLTIuNCAwLTMuNiAwLTEuMiAwLTIuNCAwLTMuNiAwdjZjMCAxLjIgMCAyLjQgMCAzLjYgMCAxLjIgMCAyLjQgMCAzLjZoMThjMC0xLjIgMC0yLjQgMC0zLjYgMC0xLjIgMC0yLjQgMC0zLjZ2LTZjLTEuMiAwLTIuNCAwLTMuNiAwLTEuMiAwLTIuNCAwLTMuNiAweiIvPjwvc3ZnPg==',
              amount: '$5.00',
              message: 'Great stream!'
            }
          },
          // YouTube Membership
          {
            type: 'sponsor',
            data: {
              displayName: 'TestYouTubeMember',
              username: 'testyoutubemember',
              avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI2ZmMDAwMCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPk08L3RleHQ+PC9zdmc+',
              memberLevelName: 'Member',
              gifted: false
            }
          },
          // YouTube Jewel Gift
          {
            type: 'jewel_gift',
            data: {
              displayName: 'TestJewelGifter',
              username: 'testjewelgifter',
              avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI2ZmMDAwMCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPko8L3RleHQ+PC9zdmc+',
              giftName: '100',
              jewelCount: 2,
              message: 'sent 100 for 2 Jewels'
            }
          }
        ]);

        // Send test chat messages to chat.html (regular user messages for font testing)
        window.electron.ipcRenderer.send('test-chat-messages', [
          {
            platform: 'tiktok',
            username: 'TikTokTester',
            displayName: 'TikTokTester',
            message: 'Hi from TikTok! Short message test.',
            avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0ZGMDA0NCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPlQ8L3RleHQ+PC9zdmc+'
          },
          {
            platform: 'twitch',
            username: 'TwitchViewer',
            displayName: 'TwitchViewer',
            message: 'This is a medium length Twitch message to test how the font looks in different sizes.',
            avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzk0NmZmZiIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPlQ8L3RleHQ+PC9zdmc+'
          },
          {
            platform: 'youtube',
            username: 'YouTubeWatcher',
            displayName: 'YouTubeWatcher',
            message: 'Here is a very long YouTube message that should help test how the chat handles word wrapping and font sizing when messages span multiple lines in the chat window!',
            avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI2ZmMDAwMCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPlk8L3RleHQ+PC9zdmc+'
          },
          {
            platform: 'tiktok',
            username: 'EmojiTikToker',
            displayName: 'EmojiTikToker',
            message: 'Testing emojis from TikTok 😀 🎮 🎉 with different font sizes!',
            avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0ZGMDA0NCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPkU8L3RleHQ+PC9zdmc+'
          },
          {
            platform: 'twitch',
            username: 'URLTwitchUser',
            displayName: 'URLTwitchUser',
            message: 'Check out this Twitch link: https://twitch.tv/very-long-url-to-test-wrapping',
            avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzk0NmZmZiIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPlU8L3RleHQ+PC9zdmc+'
          },
          {
            platform: 'youtube',
            username: 'YOUTUBECAPS',
            displayName: 'YOUTUBECAPS',
            message: 'TESTING HOW ALL CAPS YOUTUBE MESSAGES LOOK WITH THE FONT SIZE!',
            avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI2ZmMDAwMCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPkM8L3RleHQ+PC9zdmc+'
          },
          {
            platform: 'tiktok',
            username: 'numbertiktoker123',
            displayName: 'numbertiktoker123',
            message: '123 456 789 Testing numbers and special chars from TikTok !@#$%',
            avatar: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0ZGMDA0NCIvPjx0ZXh0IHg9IjE2IiB5PSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTQiPk48L3RleHQ+PC9zdmc+'
          }
        ]);
        
        // Clear status after 2 seconds
        setTimeout(() => {
          status.textContent = '';
          status.className = 'status';
        }, 2000);
        
      } catch (error) {
        const status = document.getElementById('status');
        status.textContent = `Error sending test events: ${error.message}`;
        status.className = 'status error';
      }
    });

    // Handle button clicks
    document.getElementById('login-twitch').addEventListener('click', async () => {
      const status = document.getElementById('status');
      status.textContent = 'Initiating Twitch login...';
      status.className = 'status';
      
      try {
        window.electron.ipcRenderer.send('oauth-login', 'twitch');
      } catch (error) {
        status.textContent = `Error: ${error.message}`;
        status.className = 'status error';
      }
    });
    
    document.getElementById('login-youtube').addEventListener('click', async () => {
      const status = document.getElementById('status');
      status.textContent = 'Initiating YouTube login...';
      status.className = 'status';
      
      try {
        window.electron.ipcRenderer.send('oauth-login', 'youtube');
      } catch (error) {
        status.textContent = `Error: ${error.message}`;
        status.className = 'status error';
      }
    });
    
    // Listen for auth results
    window.electron.ipcRenderer.on('oauth-result', (platform, success) => {
      const status = document.getElementById('status');
      if (success) {
        status.textContent = `Successfully logged into ${platform}!`;
        status.className = 'status success';
      } else {
        status.textContent = `Failed to log into ${platform}. Please try again.`;
        status.className = 'status error';
      }
    });
    
    // Load emoji cache status on page load
    async function loadEmojiStatus() {
      try {
        const stats = await window.electron.ipcRenderer.invoke('youtube-emoji-cache-status');
        const statusEl = document.getElementById('emoji-status');
        if (stats.error) {
          statusEl.textContent = `Error: ${stats.error}`;
          statusEl.style.color = '#ff4757';
        } else {
          statusEl.textContent = `Cached emojis: ${stats.totalEmojis} | Cache directory: ${stats.cacheDirectory}`;
          statusEl.style.color = stats.totalEmojis > 0 ? '#2ed573' : '#888';
        }
      } catch (error) {
        document.getElementById('emoji-status').textContent = `Error loading status: ${error.message}`;
      }
    }
    
    // Load emoji status when page loads
    loadEmojiStatus();
    
    // Emoji management button handlers
    document.getElementById('scrape-emojis').addEventListener('click', async () => {
      const button = document.getElementById('scrape-emojis');
      const statusEl = document.getElementById('emoji-operation-status');
      
      button.disabled = true;
      button.textContent = 'Scraping...';
      
      try {
        const result = await window.electron.ipcRenderer.invoke('youtube-scrape-emojis');
        
        if (result.success) {
          statusEl.textContent = `Success! Found ${result.emojisFound} emojis, ${result.emojisNew} new. Total cached: ${result.totalCached}`;
          statusEl.style.background = '#2ed573';
          statusEl.style.color = '#fff';
          loadEmojiStatus(); // Refresh status display
        } else {
          statusEl.textContent = `Scraping failed: ${result.error}`;
          statusEl.style.background = '#ff4757';
          statusEl.style.color = '#fff';
        }
      } catch (error) {
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.style.background = '#ff4757';
        statusEl.style.color = '#fff';
      }
      
      button.disabled = false;
      button.textContent = 'Scrape Emojis';
      
      // Hide status after 5 seconds
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 5000);
    });
    
    document.getElementById('refresh-emoji-status').addEventListener('click', () => {
      loadEmojiStatus();
    });
    
    document.getElementById('clear-emoji-cache').addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear the emoji cache? This will remove all cached emojis.')) {
        return;
      }
      
      const button = document.getElementById('clear-emoji-cache');
      const statusEl = document.getElementById('emoji-operation-status');
      
      button.disabled = true;
      button.textContent = 'Clearing...';
      
      try {
        const result = await window.electron.ipcRenderer.invoke('youtube-emoji-clear-cache');
        
        if (result.success) {
          statusEl.textContent = 'Emoji cache cleared successfully!';
          statusEl.style.background = '#2ed573';
          statusEl.style.color = '#fff';
          loadEmojiStatus(); // Refresh status display
        } else {
          statusEl.textContent = `Failed to clear cache: ${result.error}`;
          statusEl.style.background = '#ff4757';
          statusEl.style.color = '#fff';
        }
      } catch (error) {
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.style.background = '#ff4757';
        statusEl.style.color = '#fff';
      }
      
      button.disabled = false;
      button.textContent = 'Clear Cache';
      
      // Hide status after 3 seconds
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 3000);
    });
    
    // Twitch Activity Scraper test handlers - DISABLED due to Twitch browser detection
    /*
    document.getElementById('start-scraper').addEventListener('click', async function() {
      const button = this;
      const statusEl = document.getElementById('scraper-operation-status');
      const scraperStatusEl = document.getElementById('scraper-status');
      
      button.disabled = true;
      button.textContent = 'Starting...';
      
      try {
        const result = await window.electron.ipcRenderer.invoke('twitch-activity-scraper-start');
        
        statusEl.style.display = 'block';
        if (result.success) {
          statusEl.textContent = 'Scraper started successfully!';
          statusEl.style.background = '#2ed573';
          statusEl.style.color = '#fff';
          scraperStatusEl.textContent = 'Scraper Status: Running';
          scraperStatusEl.style.color = '#2ed573';
        } else {
          statusEl.textContent = `Failed to start scraper: ${result.error}`;
          statusEl.style.background = '#ff4757';
          statusEl.style.color = '#fff';
        }
      } catch (error) {
        statusEl.style.display = 'block';
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.style.background = '#ff4757';
        statusEl.style.color = '#fff';
      }
      
      button.disabled = false;
      button.textContent = 'Start Scraper';
      
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 3000);
    });
    
    document.getElementById('stop-scraper').addEventListener('click', async function() {
      const button = this;
      const statusEl = document.getElementById('scraper-operation-status');
      const scraperStatusEl = document.getElementById('scraper-status');
      
      button.disabled = true;
      button.textContent = 'Stopping...';
      
      try {
        const result = await window.electron.ipcRenderer.invoke('twitch-activity-scraper-stop');
        
        statusEl.style.display = 'block';
        if (result.success) {
          statusEl.textContent = 'Scraper stopped successfully!';
          statusEl.style.background = '#ff6b6b';
          statusEl.style.color = '#fff';
          scraperStatusEl.textContent = 'Scraper Status: Stopped';
          scraperStatusEl.style.color = '#888';
        } else {
          statusEl.textContent = `Failed to stop scraper: ${result.error}`;
          statusEl.style.background = '#ff4757';
          statusEl.style.color = '#fff';
        }
      } catch (error) {
        statusEl.style.display = 'block';
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.style.background = '#ff4757';
        statusEl.style.color = '#fff';
      }
      
      button.disabled = false;
      button.textContent = 'Stop Scraper';
      
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 3000);
    });
    
    document.getElementById('test-scraper').addEventListener('click', async function() {
      const button = this;
      const statusEl = document.getElementById('scraper-operation-status');
      const eventsEl = document.getElementById('scraper-events');
      
      button.disabled = true;
      button.textContent = 'Getting Events...';
      
      try {
        const result = await window.electron.ipcRenderer.invoke('twitch-activity-scraper-get-events');
        
        statusEl.style.display = 'block';
        if (result.events && result.events.length > 0) {
          statusEl.textContent = `Found ${result.events.length} events!`;
          statusEl.style.background = '#2ed573';
          statusEl.style.color = '#fff';
          
          // Display events
          eventsEl.style.display = 'block';
          const eventsList = result.events.map(event => 
            `[${event.type}] ${event.username}: ${event.redemptionName || event.message || 'N/A'} (${event.timestamp})`
          ).join('\\n');
          
          eventsEl.innerHTML = `<div style="color: #fff; margin-bottom: 10px; font-weight: bold;">Latest Events (${result.events.length}):</div><pre style="margin: 0; white-space: pre-wrap;">${eventsList}</pre>`;
        } else {
          statusEl.textContent = 'No events found. Make sure scraper is running and authenticated.';
          statusEl.style.background = '#ffa502';
          statusEl.style.color = '#fff';
          eventsEl.style.display = 'none';
        }
      } catch (error) {
        statusEl.style.display = 'block';
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.style.background = '#ff4757';
        statusEl.style.color = '#fff';
        eventsEl.style.display = 'none';
      }
      
      button.disabled = false;
      button.textContent = 'Get Events';
      
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 5000);
    });
    
    document.getElementById('navigate-manually').addEventListener('click', async function() {
      const button = this;
      const statusEl = document.getElementById('scraper-operation-status');
      
      button.disabled = true;
      button.textContent = 'Navigating...';
      
      try {
        const result = await window.electron.ipcRenderer.invoke('twitch-activity-scraper-navigate-manually');
        
        statusEl.style.display = 'block';
        if (result.success) {
          statusEl.textContent = 'Navigated to activity feed successfully!';
          statusEl.style.background = '#2ed573';
          statusEl.style.color = '#fff';
        } else {
          statusEl.textContent = `Failed to navigate: ${result.error}`;
          statusEl.style.background = '#ff4757';
          statusEl.style.color = '#fff';
        }
      } catch (error) {
        statusEl.style.display = 'block';
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.style.background = '#ff4757';
        statusEl.style.color = '#fff';
      }
      
      button.disabled = false;
      button.textContent = 'Go to Activity Feed';
      
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 3000);
    });
    */
    
    // Toggle visibility of password fields
    function toggleVisibility(id) {
      const input = document.getElementById(id);
      const button = input.nextElementSibling;
      if (input.type === 'password') {
        input.type = 'text';
        button.textContent = 'Hide';
      } else {
        input.type = 'password';
        button.textContent = 'Show';
      }
    }
    
    // Update color preview squares with saved colors
    function updateColorPreviews(colors) {
      console.log('Updating color previews with:', colors);
      
      // Update text color preview
      const textColorPreview = document.querySelector('#change-text-color div');
      if (textColorPreview && colors.TEXT_COLOR) {
        textColorPreview.style.backgroundColor = colors.TEXT_COLOR;
      }
      
      // Update theme color preview
      const themeColorPreview = document.querySelector('#change-events-color div');
      if (themeColorPreview && colors.THEME_COLOR) {
        themeColorPreview.style.backgroundColor = colors.THEME_COLOR;
      }
      
      // Update background color preview
      const backgroundColorPreview = document.querySelector('#change-background-color div');
      if (backgroundColorPreview && colors.BACKGROUND_COLOR) {
        backgroundColorPreview.style.backgroundColor = colors.BACKGROUND_COLOR;
      }
    }

    // Color picker functionality
    let colorPicker = {
      canvas: null,
      ctx: null,
      hueSlider: null,
      hueCtx: null,
      currentHue: 0,
      currentSaturation: 100,
      currentLightness: 50,
      isDragging: false,
      isDraggingHue: false,
      listenersSetup: false,
      
      init() {
        this.canvas = document.getElementById('colorCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.hueSlider = document.getElementById('hueSlider');
        this.hueCtx = this.hueSlider.getContext('2d');
        
        this.drawColorCanvas();
        this.drawHueSlider();
        
        // Only setup event listeners once
        if (!this.listenersSetup) {
          this.setupEventListeners();
          this.listenersSetup = true;
        }
        
        this.updateColor();
      },
      
      drawColorCanvas() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Create saturation gradient (left to right)
        const saturationGradient = this.ctx.createLinearGradient(0, 0, width, 0);
        saturationGradient.addColorStop(0, 'white');
        saturationGradient.addColorStop(1, `hsl(${this.currentHue}, 100%, 50%)`);
        
        this.ctx.fillStyle = saturationGradient;
        this.ctx.fillRect(0, 0, width, height);
        
        // Create lightness gradient (top to bottom)
        const lightnessGradient = this.ctx.createLinearGradient(0, 0, 0, height);
        lightnessGradient.addColorStop(0, 'rgba(0,0,0,0)');
        lightnessGradient.addColorStop(1, 'rgba(0,0,0,1)');
        
        this.ctx.fillStyle = lightnessGradient;
        this.ctx.fillRect(0, 0, width, height);
      },
      
      drawHueSlider() {
        const width = this.hueSlider.width;
        const height = this.hueSlider.height;
        
        // Create hue gradient
        const hueGradient = this.hueCtx.createLinearGradient(0, 0, 0, height);
        for (let i = 0; i <= 360; i += 60) {
          hueGradient.addColorStop(i / 360, `hsl(${i}, 100%, 50%)`);
        }
        
        this.hueCtx.fillStyle = hueGradient;
        this.hueCtx.fillRect(0, 0, width, height);
      },
      
      setupEventListeners() {
        // Canvas mouse events
        this.canvas.addEventListener('mousedown', (e) => {
          this.isDragging = true;
          this.handleCanvasClick(e);
        });

        this.canvas.addEventListener('mousemove', (e) => {
          if (this.isDragging) {
            this.handleCanvasClick(e);
          }
        });

        document.addEventListener('mouseup', () => {
          this.isDragging = false;
          this.isDraggingHue = false;
        });

        // Hue slider events
        this.hueSlider.addEventListener('mousedown', (e) => {
          this.isDraggingHue = true;
          this.handleHueClick(e);
        });

        this.hueSlider.addEventListener('mousemove', (e) => {
          if (this.isDraggingHue) {
            this.handleHueClick(e);
          }
        });

        // Input field events
        document.getElementById('hexInput').addEventListener('input', (e) => {
          this.handleHexInput(e.target.value);
        });

        document.getElementById('redInput').addEventListener('input', () => {
          this.handleRGBInput();
        });

        document.getElementById('greenInput').addEventListener('input', () => {
          this.handleRGBInput();
        });

        document.getElementById('blueInput').addEventListener('input', () => {
          this.handleRGBInput();
        });
      },
      
      handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Calculate saturation and lightness
        this.currentSaturation = (x / this.canvas.width) * 100;
        this.currentLightness = 100 - ((y / this.canvas.height) * 100);
        
        this.updateColor();
        this.updateCursor(x, y);
      },
      
      handleHueClick(e) {
        const rect = this.hueSlider.getBoundingClientRect();
        const y = e.clientY - rect.top;
        
        // Calculate hue
        this.currentHue = (y / this.hueSlider.height) * 360;
        
        this.drawColorCanvas();
        this.updateColor();
        this.updateHueCursor(y);
      },
      
      updateColor() {
        const rgb = this.hslToRgb(this.currentHue, this.currentSaturation, this.currentLightness);
        const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
        
        // Update input fields
        document.getElementById('hexInput').value = hex;
        document.getElementById('redInput').value = rgb.r;
        document.getElementById('greenInput').value = rgb.g;
        document.getElementById('blueInput').value = rgb.b;
      },
      
      updateCursor(x, y) {
        const cursor = document.getElementById('colorCursor');
        cursor.style.left = x + 'px';
        cursor.style.top = y + 'px';
      },
      
      updateHueCursor(y) {
        const cursor = document.getElementById('hueCursor');
        cursor.style.top = y + 'px';
      },
      
      // Color conversion utilities
      hslToRgb(h, s, l) {
        h /= 360;
        s /= 100;
        l /= 100;
        
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h * 6) % 2 - 1));
        const m = l - c / 2;
        
        let r, g, b;
        
        if (0 <= h && h < 1/6) {
          r = c; g = x; b = 0;
        } else if (1/6 <= h && h < 2/6) {
          r = x; g = c; b = 0;
        } else if (2/6 <= h && h < 3/6) {
          r = 0; g = c; b = x;
        } else if (3/6 <= h && h < 4/6) {
          r = 0; g = x; b = c;
        } else if (4/6 <= h && h < 5/6) {
          r = x; g = 0; b = c;
        } else {
          r = c; g = 0; b = x;
        }
        
        return {
          r: Math.round((r + m) * 255),
          g: Math.round((g + m) * 255),
          b: Math.round((b + m) * 255)
        };
      },
      
      rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
      },
      
      hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16)
        } : null;
      },
      
      rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        
        if (max === min) {
          h = s = 0;
        } else {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          
          switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
          }
          h /= 6;
        }
        
        return {
          h: h * 360,
          s: s * 100,
          l: l * 100
        };
      },
      
      handleHexInput(hex) {
        if (hex.match(/^#[0-9A-F]{6}$/i)) {
          const rgb = this.hexToRgb(hex);
          const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);
          
          this.currentHue = hsl.h;
          this.currentSaturation = hsl.s;
          this.currentLightness = hsl.l;
          
          this.drawColorCanvas();
          this.updateInputs();
          this.updateCursors();
        }
      },
      
      handleRGBInput() {
        const r = parseInt(document.getElementById('redInput').value) || 0;
        const g = parseInt(document.getElementById('greenInput').value) || 0;
        const b = parseInt(document.getElementById('blueInput').value) || 0;
        
        const hsl = this.rgbToHsl(r, g, b);
        const hex = this.rgbToHex(r, g, b);
        
        this.currentHue = hsl.h;
        this.currentSaturation = hsl.s;
        this.currentLightness = hsl.l;
        
        document.getElementById('hexInput').value = hex;
        this.drawColorCanvas();
        this.updateCursors();
      },
      
      updateInputs() {
        const rgb = this.hslToRgb(this.currentHue, this.currentSaturation, this.currentLightness);
        const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
        
        document.getElementById('hexInput').value = hex;
        document.getElementById('redInput').value = rgb.r;
        document.getElementById('greenInput').value = rgb.g;
        document.getElementById('blueInput').value = rgb.b;
      },
      
      updateCursors() {
        // Update color canvas cursor
        const x = (this.currentSaturation / 100) * this.canvas.width;
        const y = ((100 - this.currentLightness) / 100) * this.canvas.height;
        this.updateCursor(x, y);
        
        // Update hue cursor
        const hueY = (this.currentHue / 360) * this.hueSlider.height;
        this.updateHueCursor(hueY);
      }
    };
    
    document.getElementById('change-text-color').addEventListener('click', () => {
      openColorPicker('text');
    });
    
    document.getElementById('change-events-color').addEventListener('click', () => {
      openColorPicker('events');
    });
    
    document.getElementById('change-background-color').addEventListener('click', () => {
      openColorPicker('background');
    });
    
    document.getElementById('close-color-picker').addEventListener('click', () => {
      closeColorPicker();
    });
    
    document.getElementById('color-picker-cancel').addEventListener('click', () => {
      closeColorPicker();
    });
    
    document.getElementById('color-picker-apply').addEventListener('click', () => {
      applyColor();
    });
    
    document.getElementById('color-picker-default').addEventListener('click', () => {
      resetToDefault();
    });
    
    // Close modal when clicking outside
    document.getElementById('color-picker-modal').addEventListener('click', (e) => {
      if (e.target.id === 'color-picker-modal') {
        closeColorPicker();
      }
    });
    
    function openColorPicker(colorType) {
      console.log(`Opening color picker for: ${colorType}`);
      const modal = document.getElementById('color-picker-modal');
      modal.style.display = 'flex';
      
      // Store which color we're editing
      modal.setAttribute('data-color-type', colorType);
      
      // Update modal title based on color type
      const title = modal.querySelector('h3');
      switch(colorType) {
        case 'text':
          title.textContent = 'Edit Text Color';
          break;
        case 'events':
          title.textContent = 'Edit Theme Color';
          break;
        case 'background':
          title.textContent = 'Edit Background Color';
          break;
      }
      
      // Initialize color picker and load current color for this button
      setTimeout(async () => {
        colorPicker.init();
        await loadCurrentColor(colorType);
      }, 100);
    }
    
    function closeColorPicker() {
      const modal = document.getElementById('color-picker-modal');
      modal.style.display = 'none';
      modal.removeAttribute('data-color-type');
    }
    
    function applyColor() {
      const colorType = document.getElementById('color-picker-modal').getAttribute('data-color-type');
      const hex = document.getElementById('hexInput').value;
      
      console.log(`Applying color ${hex} to ${colorType}`);
      
      // Update the preview square in the button
      let buttonSelector;
      switch(colorType) {
        case 'text':
          buttonSelector = '#change-text-color div';
          // Send text color to chat window
          window.electron.ipcRenderer.send('update-text-color', hex);
          break;
        case 'events':
          buttonSelector = '#change-events-color div';
          // Send events color to overlay window
          window.electron.ipcRenderer.send('update-events-color', hex);
          break;
        case 'background':
          buttonSelector = '#change-background-color div';
          // Send background color to both chat and overlay windows
          window.electron.ipcRenderer.send('update-background-color', hex);
          break;
      }
      
      if (buttonSelector) {
        document.querySelector(buttonSelector).style.backgroundColor = hex;
      }
      
      closeColorPicker();
    }
    
    function resetToDefault() {
      const colorType = document.getElementById('color-picker-modal').getAttribute('data-color-type');
      
      console.log(`Resetting color to default for ${colorType}`);
      
      // Set default color values based on color type
      let defaultHex, defaultRed, defaultGreen, defaultBlue, defaultHue, defaultSaturation, defaultLightness;
      
      switch(colorType) {
        case 'text':
          // White text
          defaultHex = '#FFFFFF';
          defaultRed = 255;
          defaultGreen = 255;
          defaultBlue = 255;
          defaultHue = 0;
          defaultSaturation = 0;
          defaultLightness = 100;
          break;
        case 'events':
          // Purple events
          defaultHex = '#9353ff';
          defaultRed = 147;
          defaultGreen = 83;
          defaultBlue = 255;
          defaultHue = 258;
          defaultSaturation = 100;
          defaultLightness = 66;
          break;
        case 'background':
          // Black background
          defaultHex = '#000000';
          defaultRed = 0;
          defaultGreen = 0;
          defaultBlue = 0;
          defaultHue = 0;
          defaultSaturation = 0;
          defaultLightness = 0;
          break;
      }
      
      // Update the preview square in the button
      let buttonSelector;
      switch(colorType) {
        case 'text':
          buttonSelector = '#change-text-color div';
          break;
        case 'events':
          buttonSelector = '#change-events-color div';
          break;
        case 'background':
          buttonSelector = '#change-background-color div';
          break;
      }
      
      if (buttonSelector) {
        document.querySelector(buttonSelector).style.backgroundColor = defaultHex;
      }
      
      // Update color picker values
      document.getElementById('hexInput').value = defaultHex;
      document.getElementById('redInput').value = defaultRed;
      document.getElementById('greenInput').value = defaultGreen;
      document.getElementById('blueInput').value = defaultBlue;
      
      // Update color picker internal state
      colorPicker.currentHue = defaultHue;
      colorPicker.currentSaturation = defaultSaturation;
      colorPicker.currentLightness = defaultLightness;
      
      colorPicker.drawColorCanvas();
      colorPicker.updateCursors();
    }
    
    async function loadCurrentColor(colorType) {
      console.log(`Loading current color for: ${colorType}`);
      
      // Get saved colors first
      let colors;
      try {
        colors = await window.electron.ipcRenderer.invoke('get-colors');
      } catch (error) {
        console.error('Error loading colors for picker:', error);
        colors = {};
      }
      
      // Get current color from saved colors or fallback to preview square
      let buttonSelector;
      let defaultHex, defaultRed, defaultGreen, defaultBlue;
      
      switch(colorType) {
        case 'text':
          buttonSelector = '#change-text-color div';
          defaultHex = colors.TEXT_COLOR || '#FFFFFF';
          break;
        case 'events':
          buttonSelector = '#change-events-color div';
          defaultHex = colors.THEME_COLOR || '#9353ff';
          break;
        case 'background':
          buttonSelector = '#change-background-color div';
          defaultHex = colors.BACKGROUND_COLOR || '#000000';
          break;
      }
      
      // Use saved color
      const hex = defaultHex;
      const rgb = colorPicker.hexToRgb(hex);
      
      console.log(`Using saved color: ${hex}, RGB: ${rgb.r}, ${rgb.g}, ${rgb.b}`);
      
      // Convert to HSL for color picker
      const hsl = colorPicker.rgbToHsl(rgb.r, rgb.g, rgb.b);
      
      console.log(`Setting color picker state - HSL: ${hsl.h}, ${hsl.s}, ${hsl.l}`);
      
      // Update color picker state
      colorPicker.currentHue = hsl.h;
      colorPicker.currentSaturation = hsl.s;
      colorPicker.currentLightness = hsl.l;
      
      // Update inputs
      document.getElementById('hexInput').value = hex;
      document.getElementById('redInput').value = rgb.r;
      document.getElementById('greenInput').value = rgb.g;
      document.getElementById('blueInput').value = rgb.b;
      
      // Redraw canvas and update cursors
      colorPicker.drawColorCanvas();
      colorPicker.updateCursors();
    }
    
    // Platform visibility functions
    function loadPlatformVisibilitySettings(config) {
      const visibilitySettings = config.PLATFORM_VISIBILITY || {
        tiktok: true,
        twitch: true,
        youtube: true
      };
      
      // Update button states
      updatePlatformToggleButton('tiktok', visibilitySettings.tiktok);
      updatePlatformToggleButton('twitch', visibilitySettings.twitch);
      updatePlatformToggleButton('youtube', visibilitySettings.youtube);
    }
    
    function updatePlatformToggleButton(platform, isVisible) {
      const button = document.getElementById(`toggle-${platform}`);
      if (button) {
        if (isVisible) {
          button.textContent = 'SHOW';
          button.style.background = '#2ed573';
        } else {
          button.textContent = 'HIDE';
          button.style.background = '#e74c3c';
        }
      }
    }
    
    function getPlatformVisibility(platform) {
      const button = document.getElementById(`toggle-${platform}`);
      return button && button.textContent === 'SHOW';
    }
    
    function togglePlatformVisibility(platform) {
      const button = document.getElementById(`toggle-${platform}`);
      if (button) {
        const currentlyVisible = button.textContent === 'SHOW';
        const newVisibility = !currentlyVisible;
        
        updatePlatformToggleButton(platform, newVisibility);
        
        // Send update to overlay immediately via IPC
        console.log(`Sending platform visibility update: ${platform} = ${newVisibility}`);
        window.electron.ipcRenderer.send('update-platform-visibility', { platform, visible: newVisibility });
      }
    }
    
    // Set up platform toggle button event listeners
    function setupPlatformToggleListeners() {
      document.getElementById('toggle-tiktok').addEventListener('click', () => {
        togglePlatformVisibility('tiktok');
      });
      
      document.getElementById('toggle-twitch').addEventListener('click', () => {
        togglePlatformVisibility('twitch');
      });
      
      document.getElementById('toggle-youtube').addEventListener('click', () => {
        togglePlatformVisibility('youtube');
      });
    }
    // YouTube Stream Selector Modal Logic
    const streamModal = document.getElementById('stream-selector-modal');
    const selectStreamBtn = document.getElementById('select-stream-btn');
    const closeModalBtn = document.getElementById('close-stream-modal');
    const streamListContainer = document.getElementById('stream-list-container');
    const streamListLoading = document.getElementById('stream-list-loading');
    const streamListError = document.getElementById('stream-list-error');
    const streamList = document.getElementById('stream-list');
    const youtubeLiveIdInput = document.getElementById('youtube-live-id');

    // Open modal
    selectStreamBtn.addEventListener('click', async () => {
      streamModal.style.display = 'flex';
      streamListContainer.style.display = 'none';
      streamListLoading.style.display = 'block';
      streamListError.style.display = 'none';
      
      try {
        const broadcasts = await window.electron.ipcRenderer.invoke('get-youtube-broadcasts');
        displayBroadcasts(broadcasts);
      } catch (error) {
        console.error('Failed to load broadcasts:', error);
        streamListLoading.style.display = 'none';
        streamListError.style.display = 'block';
      }
    });

    // Close modal
    closeModalBtn.addEventListener('click', () => {
      streamModal.style.display = 'none';
    });

    // Close on background click
    streamModal.addEventListener('click', (e) => {
      if (e.target === streamModal) {
        streamModal.style.display = 'none';
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && streamModal.style.display === 'flex') {
        streamModal.style.display = 'none';
      }
    });

    // Display broadcasts
    function displayBroadcasts(broadcasts) {
      streamListLoading.style.display = 'none';
      streamListContainer.style.display = 'block';
      streamList.innerHTML = '';

      if (!broadcasts || broadcasts.length === 0) {
        streamList.innerHTML = '<div style="text-align: center; color: #999; padding: 40px;">No streams found</div>';
        return;
      }

      broadcasts.forEach(broadcast => {
        const streamDate = new Date(broadcast.snippet.scheduledStartTime || broadcast.snippet.publishedAt);
        const title = broadcast.snippet.title;
        const status = broadcast.status?.lifeCycleStatus || 'unknown';
        const streamId = broadcast.id;
        
        // Format date and time
        const dateStr = streamDate.toLocaleDateString();
        const timeStr = streamDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Create stream item
        const streamItem = document.createElement('div');
        streamItem.style.cssText = 'padding: 15px; border: 1px solid #333; border-radius: 4px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; background: #222;';
        
        streamItem.innerHTML = `
          <div style="font-weight: bold; color: #fff; margin-bottom: 5px;">${title}</div>
          <div style="color: #999; font-size: 13px;">
            ${dateStr} ${timeStr} • Status: <span style="color: ${getStatusColor(status)}">${status.toUpperCase()}</span>
          </div>
          <div style="color: #666; font-size: 12px; margin-top: 5px;">
            Stream ID: ${streamId}
          </div>
        `;
        
        // Hover effect
        streamItem.addEventListener('mouseenter', () => {
          streamItem.style.background = '#2a2a2a';
          streamItem.style.borderColor = '#ff0000';
        });
        
        streamItem.addEventListener('mouseleave', () => {
          streamItem.style.background = '#222';
          streamItem.style.borderColor = '#333';
        });
        
        // Click to select
        streamItem.addEventListener('click', () => {
          youtubeLiveIdInput.value = streamId;
          streamModal.style.display = 'none';
        });
        
        streamList.appendChild(streamItem);
      });
    }

    function getStatusColor(status) {
      switch(status.toLowerCase()) {
        case 'live': return '#4CAF50';
        case 'upcoming': return '#2196F3';
        case 'complete': return '#999';
        case 'ready': return '#ff9800';
        default: return '#666';
      }
    }

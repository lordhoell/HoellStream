(async () => {
  // Load both config and OAuth tokens
  const CONFIG = await window.hs.config.load();
  let TOKENS = await window.hs.auth.getTokens();
  
  // Apply font sizes from config
  if (CONFIG) {
    // Apply overlay event box size
    if (CONFIG.OVERLAY_FONT_SIZE) {
      const style = document.createElement('style');
      style.setAttribute('data-dynamic-font', 'true');
      style.textContent = `
        .item { 
          min-height: calc(44px * ${CONFIG.OVERLAY_FONT_SIZE}) !important;
          padding: calc(0.5em * ${CONFIG.OVERLAY_FONT_SIZE}) !important;
        }
        .item .left-content {
          font-size: calc(1em * ${CONFIG.OVERLAY_FONT_SIZE}) !important;
        }
        .item .right-content {
          font-size: calc(1em * ${CONFIG.OVERLAY_FONT_SIZE}) !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Apply stats font size
    if (CONFIG.STATS_FONT_SIZE) {
      const style = document.createElement('style');
      style.setAttribute('data-dynamic-font', 'true');
      style.textContent = `.stat span { font-size: ${CONFIG.STATS_FONT_SIZE}em !important; }`;
      document.head.appendChild(style);
    }
    
    // Apply platform visibility settings
    if (CONFIG.PLATFORM_VISIBILITY) {
      updatePlatformVisibility(CONFIG.PLATFORM_VISIBILITY);
    }
  }

  // Initialization flag to prevent operations during startup
  let isInitialized = false;

  // YouTube service state tracking
  let youtubeServiceRunning = false;
  let youtubeServiceLoading = false;

  // Twitch service state tracking
  let twitchServiceRunning = false;
  let twitchServiceLoading = false;

  // Get YouTube icon container for click handling
  const youtubeIconContainer = document.querySelector('.platform-icon-container.clickable.youtube-icon');
  const youtubeStatusElement = document.getElementById('youtube-status');

  // Get Twitch icon container for click handling
  const twitchIconContainer = document.querySelector('.platform-icon-container.clickable.twitch-icon');
  const twitchStatusElement = document.getElementById('twitch-status');

  // YouTube icon click handler
  youtubeIconContainer.addEventListener('click', async () => {
    if (!isInitialized) {
      console.log('[Overlay] System still initializing, please wait...');
      return;
    }
    
    if (youtubeServiceLoading) {
      console.log('[Overlay] YouTube service operation in progress, ignoring click');
      return;
    }

    console.log(`[Overlay] YouTube icon clicked - Current state: ${youtubeServiceRunning ? 'running' : 'stopped'}`);
    
    if (youtubeServiceRunning) {
      // Stop YouTube service
      await stopYouTubeService();
    } else {
      // Check if we should bypass the selector
      const config = await window.electron.ipcRenderer.invoke('load-config');
      
      if (config.youtubeBypassSelector && config.YT_STREAM_ID) {
        // Bypass selector and start directly with manually entered stream ID
        console.log('[Overlay] Bypassing stream selector, using manual stream ID:', config.YT_STREAM_ID);
        
        // Make sure to save the manual stream ID as the active stream ID before starting
        config.youtubeStreamId = config.YT_STREAM_ID;
        await window.electron.ipcRenderer.invoke('save-config', config);
        
        // Use the IPC call to start YouTube service (same as modal does)
        try {
          setYouTubeLoading(true);
          const startResult = await window.electron.ipcRenderer.invoke('youtube-service-start');
          
          if (startResult.success) {
            console.log('✅ [Overlay] YouTube service started successfully with manual stream ID');
            youtubeServiceRunning = true;
            updateConnectionStatus('youtube', true);
          } else {
            console.error('❌ [Overlay] Failed to start YouTube service:', startResult.error || 'Unknown error');
            youtubeServiceRunning = false;
            updateConnectionStatus('youtube', false);
          }
        } catch (error) {
          console.error('❌ [Overlay] Error starting YouTube service:', error);
          youtubeServiceRunning = false;
          updateConnectionStatus('youtube', false);
        } finally {
          setYouTubeLoading(false);
        }
      } else {
        // Open stream selector modal
        openYouTubeModal();
      }
    }
  });

  // Twitch icon click handler
  twitchIconContainer.addEventListener('click', async () => {
    if (!isInitialized) {
      console.log('[Overlay] System still initializing, please wait...');
      return;
    }
    
    if (twitchServiceLoading) {
      console.log('[Overlay] Twitch service operation in progress, ignoring click');
      return;
    }

    if (twitchServiceRunning) {
      await stopTwitchService();
    } else {
      await startTwitchService();
    }
  });

  // Start YouTube service function
  async function startYouTubeService() {
    console.log('[Overlay] Starting YouTube service...');
    setYouTubeLoading(true);
    
    try {
      const result = await window.hs.providers.youtube.start();
      
      if (result && result.success) {
        console.log('✅ [Overlay] YouTube service started successfully');
        youtubeServiceRunning = true;
        updateConnectionStatus('youtube', true);
      } else {
        console.error('❌ [Overlay] Failed to start YouTube service:', result?.error || 'Unknown error');
        youtubeServiceRunning = false;
        updateConnectionStatus('youtube', false);
      }
    } catch (error) {
      console.error('❌ [Overlay] Error starting YouTube service:', error);
      youtubeServiceRunning = false;
      updateConnectionStatus('youtube', false);
    } finally {
      setYouTubeLoading(false);
    }
  }

  // Stop YouTube service function
  async function stopYouTubeService() {
    console.log('[Overlay] Stopping YouTube service...');
    setYouTubeLoading(true);
    
    try {
      await window.hs.providers.youtube.stop();
      console.log('✅ [Overlay] YouTube service stopped successfully');
      youtubeServiceRunning = false;
      updateConnectionStatus('youtube', false);
    } catch (error) {
      console.error('❌ [Overlay] Error stopping YouTube service:', error);
      // Still mark as stopped even if there was an error
      youtubeServiceRunning = false;
      updateConnectionStatus('youtube', false);
    } finally {
      setYouTubeLoading(false);
    }
  }

  // Start Twitch service function
  async function startTwitchService() {
    console.log('[Overlay] Starting Twitch service...');
    setTwitchLoading(true);
    
    try {
      const result = await window.hs.providers.twitch.start();
      
      if (result && result.success) {
        console.log('✅ [Overlay] Twitch service started successfully');
        twitchServiceRunning = true;
        updateConnectionStatus('twitch', true);
      } else {
        console.log('⚠️ [Overlay] Twitch service start - no explicit success response, waiting for status update');
        // Don't set to connected here - let the connection status listener handle it
      }
    } catch (error) {
      console.error('❌ [Overlay] Error starting Twitch service:', error);
      twitchServiceRunning = false;
      updateConnectionStatus('twitch', false);
    } finally {
      setTwitchLoading(false);
    }
  }

  // Stop Twitch service function
  async function stopTwitchService() {
    console.log('[Overlay] Stopping Twitch service...');
    setTwitchLoading(true);
    
    try {
      await window.hs.providers.twitch.stop();
      console.log('✅ [Overlay] Twitch service stopped successfully');
      twitchServiceRunning = false;
      updateConnectionStatus('twitch', false);
    } catch (error) {
      console.error('❌ [Overlay] Error stopping Twitch service:', error);
      // Still mark as stopped even if there was an error
      twitchServiceRunning = false;
      updateConnectionStatus('twitch', false);
    } finally {
      setTwitchLoading(false);
    }
  }

  // Set loading state for YouTube icon
  function setYouTubeLoading(loading) {
    youtubeServiceLoading = loading;
    if (loading) {
      youtubeIconContainer.classList.add('loading');
    } else {
      youtubeIconContainer.classList.remove('loading');
    }
  }

  // Set loading state for Twitch icon
  function setTwitchLoading(loading) {
    twitchServiceLoading = loading;
    if (loading) {
      twitchIconContainer.classList.add('twitch-loading');
    } else {
      twitchIconContainer.classList.remove('twitch-loading');
    }
  }

  // Note: YouTube polling buttons removed - functionality moved to clickable favicon

  // YouTube Modal Management
  let youtubeModalOpen = false;

  function initYouTubeModal() {
    const backdrop = document.getElementById('youtube-modal-backdrop');
    const modal = document.getElementById('youtube-modal');
    const closeBtn = document.getElementById('youtube-modal-close');
    const cancelBtn = document.getElementById('youtube-cancel-btn');
    const startBtn = document.getElementById('youtube-start-btn');
    const streamSelect = document.getElementById('youtube-stream-select');
    const retryBtn = document.getElementById('youtube-retry-fetch');

    // Close modal function
    function closeModal() {
      backdrop.style.display = 'none';
      youtubeModalOpen = false;
      resetModalState();
    }

    // Reset modal to initial state
    function resetModalState() {
      document.getElementById('youtube-modal-loading').style.display = 'block';
      document.getElementById('youtube-modal-selector').style.display = 'none';
      document.getElementById('youtube-modal-error').style.display = 'none';
      document.getElementById('youtube-modal-progress').style.display = 'none';
      streamSelect.innerHTML = '<option value="">-- Select a Stream --</option>';
      startBtn.disabled = true;
    }

    // Event listeners
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && youtubeModalOpen) closeModal();
    });

    // Stream selection
    streamSelect.addEventListener('change', (e) => {
      const selected = e.target.value;
      startBtn.disabled = !selected;
      
      if (selected) {
        // Show info about selected stream
        const option = streamSelect.options[streamSelect.selectedIndex];
        const info = document.getElementById('youtube-stream-info');
        const status = option.dataset.status || 'unknown';
        
        // Color code the status
        let statusColor = '#999';
        if (status === 'live') statusColor = '#4CAF50';
        else if (status === 'testing') statusColor = '#FF9800';
        else if (status === 'ready') statusColor = '#2196F3';
        
        info.innerHTML = `Status: <span style="color: ${statusColor}">${status.toUpperCase()}</span> • Stream ID: ${selected}`;
      }
    });

    // Start button
    startBtn.addEventListener('click', async () => {
      const streamId = streamSelect.value;
      if (!streamId) return;

      try {
        // Show progress
        document.getElementById('youtube-modal-selector').style.display = 'none';
        document.getElementById('youtube-modal-progress').style.display = 'block';
        startBtn.disabled = true;
        cancelBtn.disabled = true;

        // Step 1: Load current config
        document.getElementById('youtube-progress-message').textContent = 'Loading configuration...';
        const config = await window.electron.ipcRenderer.invoke('load-config');

        // Step 2: Update config with new stream ID
        document.getElementById('youtube-progress-message').textContent = 'Saving stream selection...';
        config.youtubeStreamId = streamId;
        config.YT_STREAM_ID = streamId; // Also update the manual field to keep them in sync
        
        const saveResult = await window.electron.ipcRenderer.invoke('save-config', config);
        // Check if save failed (saveResult might be undefined, false, or have an error)
        if (saveResult === false || (saveResult && saveResult.error)) {
          throw new Error(saveResult?.error || 'Failed to save configuration');
        }

        // Step 3: Start YouTube service
        document.getElementById('youtube-progress-message').textContent = 'Starting YouTube service...';
        const startResult = await window.electron.ipcRenderer.invoke('youtube-service-start');
        
        if (!startResult.success) {
          throw new Error(startResult.error || 'Failed to start YouTube service');
        }

        // Success!
        document.getElementById('youtube-progress-message').textContent = 'Successfully started!';
        youtubeServiceRunning = true;
        updateConnectionStatus('youtube', true);
        setTimeout(closeModal, 1000);

      } catch (error) {
        console.error('Failed to start YouTube:', error);
        
        // Stop the service to ensure clean state
        await window.electron.ipcRenderer.invoke('youtube-service-stop');
        
        // Show error
        document.getElementById('youtube-modal-progress').style.display = 'none';
        document.getElementById('youtube-modal-error').style.display = 'block';
        document.querySelector('#youtube-modal-error .error-message').textContent = 
          `Failed to start YouTube service: ${error.message}`;
        
        cancelBtn.disabled = false;
      }
    });

    // Retry button
    retryBtn.addEventListener('click', () => {
      fetchYouTubeStreams();
    });
  }

  // Fetch YouTube streams
  async function fetchYouTubeStreams() {
    try {
      // Show loading
      document.getElementById('youtube-modal-loading').style.display = 'block';
      document.getElementById('youtube-modal-selector').style.display = 'none';
      document.getElementById('youtube-modal-error').style.display = 'none';

      // Get current config to check for saved stream ID
      const config = await window.electron.ipcRenderer.invoke('load-config');
      const savedStreamId = config.youtubeStreamId;

      // Fetch broadcasts from YouTube (same as settings.js)
      const broadcasts = await window.electron.ipcRenderer.invoke('get-youtube-broadcasts');
      
      if (!broadcasts || broadcasts.length === 0) {
        throw new Error('No YouTube streams found. Please start a stream first.');
      }

      // Populate dropdown
      const select = document.getElementById('youtube-stream-select');
      select.innerHTML = '<option value="">-- Select a Stream --</option>';
      
      broadcasts.forEach(broadcast => {
        const streamDate = new Date(broadcast.snippet.scheduledStartTime || broadcast.snippet.publishedAt);
        const title = broadcast.snippet.title;
        const status = broadcast.status?.lifeCycleStatus || 'unknown';
        const streamId = broadcast.id;
        
        // Format date and time
        const dateStr = streamDate.toLocaleDateString();
        const timeStr = streamDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const option = document.createElement('option');
        option.value = streamId;
        option.textContent = `${title} - ${dateStr} ${timeStr} (${status.toUpperCase()})`;
        option.dataset.status = status;
        
        // Pre-select if it matches saved stream ID
        if (streamId === savedStreamId) {
          option.selected = true;
        }
        
        select.appendChild(option);
      });

      // Enable start button if something is selected
      document.getElementById('youtube-start-btn').disabled = !select.value;

      // Show selector
      document.getElementById('youtube-modal-loading').style.display = 'none';
      document.getElementById('youtube-modal-selector').style.display = 'block';

    } catch (error) {
      console.error('Failed to fetch YouTube streams:', error);
      
      // Show error
      document.getElementById('youtube-modal-loading').style.display = 'none';
      document.getElementById('youtube-modal-error').style.display = 'block';
      document.querySelector('#youtube-modal-error .error-message').textContent = 
        error.message || 'Failed to fetch streams. Please ensure you are authenticated with YouTube.';
    }
  }

  // Open YouTube modal
  function openYouTubeModal() {
    const backdrop = document.getElementById('youtube-modal-backdrop');
    backdrop.style.display = 'flex';
    youtubeModalOpen = true;
    
    // Start fetching streams
    fetchYouTubeStreams();
  }

  // Initialize modal on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initYouTubeModal);
  } else {
    initYouTubeModal();
  }

  // Only log that overlay is loaded without exposing sensitive config values
  


  // Event counters
  let tF = 0, tS = 0, tB = 0, tR = 0;  // Twitch: followers, subs, bits, raids
  let ytS = 0, ytM = 0, ytSC = 0, ytJewels = 0;  // YouTube: subs, members, superchats, jewels
  let tkF = 0, tkD = 0, tkS = 0;  // TikTok: followers, diamonds, subs
  
  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  // Active gift tracking for TikTok stacking gifts (window-level to ensure persistence)
  window.activeGifts = window.activeGifts || {};
  
  // Test IPC connection
  console.log('[Overlay] Setting up TikTok status listener...');
  
  // Listen for TikTok status updates from main process
  const offTikTokStatus = window.hs.providers.tiktok.onStatus((status) => {
    console.log('[Overlay] Received TikTok status from main:', status);
    const isConnected = status === 'connected';
    console.log('[Overlay] Calling updateConnectionStatus with tiktok,', isConnected);
    updateConnectionStatus('tiktok', isConnected);
    
    // Also log the element we're trying to update
    const statusElement = document.getElementById('tiktok-status');
    console.log('[Overlay] TikTok status element found:', statusElement);
    if (statusElement) {
      console.log('[Overlay] Current classes:', statusElement.className);
    }
  });
  
  // Disabled - now using normalized overlay-event stream
  // const offTikTokMessage = window.electron.ipcRenderer.on('tiktok-message', (event, m) => {
  //   window.handleTikTokMessage(m);
  // });
  
  // Listen for normalized overlay events (all platforms)
  const offOverlayEvent = window.hs.events.onOverlay((e) => {
    if (!e || !e.platform || !e.type) return;

    // --- TikTok ---
    if (e.platform === 'tiktok') {
      switch (e.type) {
        case 'metric': {
          if (e.metric === 'viewers') $('#tiktokViewers').text(e.value);
          else if (e.metric === 'likes') $('#tiktokLikes').text(e.value);
          break;
        }
        case 'follow': {
          tkF++; $('#tiktokFollows').text(tkF);
          addItem({ avatar: e.avatarUrl, name: e.displayName || e.username || 'Unknown', html: 'FOLLOWED', provider: 'tiktok' });
          break;
        }
        case 'sub': {
          tkS++; $('#tiktokSubs').text(tkS);
          addItem({ avatar: e.avatarUrl, name: e.displayName || e.username || 'Unknown', html: 'NEW SUB', provider: 'tiktok' });
          break;
        }
        case 'gift_sub': {
          tkS++; $('#tiktokSubs').text(tkS);
          const from = e.from || e.username || 'Unknown';
          const to = e.to || 'Unknown';
          addItem({ avatar: e.avatarUrl, name: from, html: `GIFT SUB from ${from} → ${to}`, provider: 'tiktok' });
          break;
        }
        case 'gift': {
          const displayName = e.displayName || e.username || 'Unknown';
          // Use a simpler key that's more likely to be consistent
          const giftName = e.giftName || 'Gift';
          const giftKey = `${displayName}-${giftName}`;
          const icon = e.giftImageUrl || '';
          const count = e.repeatCount || e.giftCount || 1;
          const diamondEach = e.diamondEach || e.diamondCount || 0;
          const totalDiamonds = e.totalDiamonds || (diamondEach * count);
          
          console.log('[TikTok Gift Debug]', {
            displayName,
            giftName,
            giftKey,
            count,
            repeatEnd: e.repeatEnd,
            giftType: e.giftType,
            activeGiftsKeys: Object.keys(window.activeGifts)
          });
          
          // Check if this is a Type 1 (stacking) gift
          const isStackingGift = e.giftType === 1 || e.giftType === '1';
          
          if (isStackingGift) {
            // Handle stacking gifts
            if (e.repeatEnd === false || e.repeatEnd === 0 || e.repeatEnd === '0' || e.repeatEnd === 'false') {
              // Gift is still accumulating
              if (window.activeGifts[giftKey]) {
                // Update existing gift count
                const activeGift = window.activeGifts[giftKey];
                activeGift.currentCount = count;
                console.log('[TikTok Gift] Updating existing gift:', giftKey, 'to count:', count);
                
                // Update the display immediately - find element by data attribute
                const giftElement = $(`.feed .event-row[data-gift-key="${giftKey}"]`);
                if (giftElement.length > 0) {
                  const countElement = giftElement.find('.tiktok-gift-counting');
                  if (countElement.length > 0) {
                    countElement.text(`${count}×`);
                  }
                }
                return; // Don't add a new item, just update existing
              } else {
                // First gift event - start tracking
                console.log('[TikTok Gift] Creating new gift:', giftKey);
                const giftHtml = `sent <span class="tiktok-gift-counting">${count}×</span> ${giftName} ${icon ? `<img class="icon" src="${icon}">` : ''}`;
                
                const giftItem = {
                  avatar: e.avatarUrl,
                  name: displayName,
                  html: giftHtml,
                  provider: 'tiktok',
                  giftImageUrl: icon,
                  giftName: giftName,
                  giftCount: count,
                  diamondCount: totalDiamonds,
                  giftKey: giftKey,
                  isAnimating: true
                };
                
                addItem(giftItem);
                
                // Store reference for updates - wait a moment for DOM to update
                setTimeout(() => {
                  const addedElement = $(`.feed .event-row[data-gift-key="${giftKey}"]`);
                  window.activeGifts[giftKey] = {
                    currentCount: count,
                    targetCount: count,
                    diamondCount: diamondEach,
                    giftName: giftName,
                    icon: icon,
                    element: addedElement
                  };
                  console.log('[TikTok Gift] Stored active gift:', giftKey, window.activeGifts[giftKey]);
                }, 0);
                return;
              }
            } else {
              // Final gift event - complete the counting
              if (window.activeGifts[giftKey]) {
                const activeGift = window.activeGifts[giftKey];
                const finalCount = count;
                const finalDiamonds = diamondEach * finalCount;
                
                // Update target count
                activeGift.targetCount = finalCount;
                
                // Find the element by data attribute
                const giftElement = $(`.feed .event-row[data-gift-key="${giftKey}"]`);
                if (giftElement.length === 0) {
                  console.error('[TikTok Gift] Could not find element for gift:', giftKey);
                  delete window.activeGifts[giftKey];
                  return;
                }
                
                // Animate count from current to final
                const startCount = activeGift.currentCount;
                const endCount = finalCount;
                const duration = Math.min(2000, Math.max(500, (endCount - startCount) * 50));
                const startTime = Date.now();
                
                const countUp = () => {
                  const elapsed = Date.now() - startTime;
                  const progress = Math.min(elapsed / duration, 1);
                  const currentCount = Math.floor(startCount + (endCount - startCount) * progress);
                  
                  // Update count display
                  const countElement = giftElement.find('.tiktok-gift-counting');
                  if (countElement.length > 0) {
                    countElement.text(`${currentCount}×`);
                  }
                  
                  if (progress < 1) {
                    requestAnimationFrame(countUp);
                  } else {
                    // Animation complete - finalize the gift
                    countElement.removeClass('tiktok-gift-counting');
                    
                    // Update HTML to include diamond count
                    const finalHtml = `sent ${finalCount}× ${activeGift.giftName} ${activeGift.icon ? `<img class="icon" src="${activeGift.icon}">` : ''} <span class="tiktok-diamonds">(${finalDiamonds} diamonds)</span>`;
                    giftElement.find('.details').html(finalHtml);
                    
                    // Apply flash animation
                    giftElement.find('.item').addClass('event-animate');
                    
                    // Clean up
                    delete window.activeGifts[giftKey];
                    
                    // Update diamond counter
                    tkD += finalDiamonds;
                    $('#tiktokDiamonds').text(tkD);
                  }
                };
                
                countUp();
                return;
              } else {
                // No active gift found, show as complete gift
                const giftHtml = `sent ${count}× ${e.giftName || 'Gift'} ${icon ? `<img class="icon" src="${icon}">` : ''} <span class="tiktok-diamonds">(${totalDiamonds} diamonds)</span>`;
                addItem({ 
                  avatar: e.avatarUrl, 
                  name: displayName, 
                  html: giftHtml, 
                  provider: 'tiktok', 
                  giftImageUrl: icon, 
                  giftName: e.giftName, 
                  giftCount: count, 
                  diamondCount: totalDiamonds 
                });
                tkD += totalDiamonds;
                $('#tiktokDiamonds').text(tkD);
              }
            }
          } else {
            // Handle non-stacking gifts (Type 0) - show immediately
            const giftHtml = `sent ${count}× ${e.giftName || 'Gift'} ${icon ? `<img class="icon" src="${icon}">` : ''} <span class="tiktok-diamonds">(${totalDiamonds} diamonds)</span>`;
            
            addItem({
              avatar: e.avatarUrl,
              name: displayName,
              html: giftHtml,
              provider: 'tiktok',
              giftImageUrl: icon,
              giftName: e.giftName,
              giftCount: count,
              diamondCount: totalDiamonds
            });
            
            tkD += totalDiamonds;
            $('#tiktokDiamonds').text(tkD);
          }
          
          $('.feed').scrollTop($('.feed')[0].scrollHeight);
          break;
        }
      }
      return;
    }

    // --- Twitch ---
    if (e.platform === 'twitch') {
      switch (e.type) {
        case 'follow': {
          tF++; $('#twitchFollows').text(tF);
          addItem({ avatar: e.avatarUrl, name: e.displayName || e.username || 'Unknown', html: 'FOLLOWED', provider: 'twitch' });
          break;
        }
        case 'sub': {
          tS++; $('#twitchSubs').text(tS);
          const months = e.months || 1;
          const monthsText = `subscribed for ${months} month${months > 1 ? 's' : ''}`;
          let tierText = '';
          if (e.tier) {
            const tierValue = String(e.tier).toLowerCase() === 'prime' ? 'Prime' : parseInt(e.tier) / 1000;
            tierText = ` (Tier ${tierValue})`;
          }
          addItem({ avatar: e.avatarUrl, name: e.displayName || e.username || 'Unknown', html: `${monthsText}${tierText}`, provider: 'twitch' });
          break;
        }
        case 'gift_sub': {
          tS++; $('#twitchSubs').text(tS);
          const from = e.from || 'Unknown';
          const fromDisplayName = e.fromDisplayName || from;
          const to = e.to || null;
          const toDisplayName = e.toDisplayName || to;
          const toAvatar = e.toAvatarUrl || e.avatarUrl || '';
          const fromAvatar = e.fromAvatarUrl || '';
          const c = e.count || 1;
          
          // If there's a specific recipient (individual gift sub notification)
          if (to) {
            addItem({ 
              avatar: toAvatar, 
              name: toDisplayName || to || 'Unknown', 
              html: `received a sub from ${fromDisplayName}`, 
              provider: 'twitch' 
            });
          } 
          // If it's a mass gift announcement (no specific recipient, count > 1)
          else if (c > 1) {
            addItem({ 
              avatar: fromAvatar, 
              name: fromDisplayName, 
              html: `Gifted ${c} subs`, 
              provider: 'twitch' 
            });
          }
          // Single gift without recipient info (fallback)
          else {
            addItem({ 
              avatar: fromAvatar, 
              name: fromDisplayName, 
              html: `Gifted 1 sub`, 
              provider: 'twitch' 
            });
          }
          break;
        }
        case 'cheer': {
          const amt = e.amount || 0;
          tB = (typeof tB === 'number' ? tB : 0) + amt;
          $('#twitchBits').text(tB);
          
          // Comprehensive name fallbacks
          const name = 
            e.displayName ||
            e.username ||
            e.authorDisplayName ||
            e.author?.name ||
            (e.author && e.author.name) ||
            'Unknown';
          
          // Comprehensive avatar fallbacks
          const avatar = 
            e.avatarUrl || 
            e.avatar ||
            (e.author && e.author.avatar) ||
            '';
          
          // Removed message from display - just show bits amount
          addItem({ 
            avatar: avatar, 
            name: name, 
            html: `CHEERED ${amt} bits`, 
            provider: 'twitch' 
          });
          break;
        }
        case 'raid': {
          const v = e.viewers || 0;
          tR = (typeof tR === 'number' ? tR : 0) + 1;
          $('#twitchRaids').text(tR);
          addItem({ avatar: '', name: e.raider || 'Unknown', html: `RAIDED with ${v} viewers`, provider: 'twitch' });
          break;
        }
      }
      return;
    }

    // --- YouTube ---
    if (e.platform === 'youtube') {
      switch (e.type) {
        case 'member': {
          ytM++; $('#youtubeMembers').text(ytM);
          const lvl = e.level ? ` (${e.level})` : '';
          addItem({ avatar: e.avatarUrl, name: e.displayName || e.username || 'Unknown', html: `BECAME A MEMBER${lvl}`, provider: 'youtube' });
          break;
        }
        case 'gift_member': {
          ytM++; $('#youtubeMembers').text(ytM);
          const c = e.count || 1;
          
          // Comprehensive name fallbacks (same pattern as chat.js)
          const name = 
            e.from ||
            e.displayName ||
            e.authorDisplayName ||
            e.author?.name ||
            (e.author && e.author.name) ||
            e.username ||
            e.gifter ||
            'Unknown';
          
          // Use the avatar from the event instead of empty string
          const avatar = 
            e.avatarUrl || 
            e.avatar ||
            (e.author && e.author.avatar) ||
            '';
          
          addItem({ 
            avatar: avatar, 
            name: name, 
            html: `GIFTED ${c} MEMBERSHIP${c > 1 ? 'S' : ''}`, 
            provider: 'youtube' 
          });
          break;
        }
        case 'gift_member_received': {
          // Comprehensive fallbacks for recipient name
          const to = 
            e.to || 
            e.recipient || 
            e.displayName || 
            e.author?.name ||
            (e.author && e.author.name) ||
            e.username ||
            'Unknown';
          
          // Comprehensive fallbacks for gifter name  
          const from = 
            e.from || 
            e.gifter ||
            e.sourceName ||
            (e.source && e.source.name) ||
            'Unknown';
          
          // Use the avatar from the event
          const avatar = 
            e.avatarUrl || 
            e.avatar ||
            (e.author && e.author.avatar) ||
            '';
          
          addItem({ 
            avatar: avatar, 
            name: to, 
            html: `RECEIVED A GIFTED MEMBERSHIP FROM ${from}`, 
            provider: 'youtube' 
          });
          break;
        }
        case 'superchat': {
          const amt = e.amount || 0;
          const cur = e.currency || '';
          
          // Comprehensive name fallbacks (same pattern as gift memberships)
          const name = 
            e.displayName ||
            e.username ||
            e.authorDisplayName ||
            e.author?.name ||
            (e.author && e.author.name) ||
            'Unknown';
          
          // Use the avatar from the event with fallbacks
          const avatar = 
            e.avatarUrl || 
            e.avatar ||
            (e.author && e.author.avatar) ||
            '';
          
          // Removed message from display - just show amount and currency
          addItem({ 
            avatar: avatar, 
            name: name, 
            html: `SUPERCHAT ${amt} ${cur}`, 
            provider: 'youtube' 
          });
          break;
        }
        case 'sticker': {
          // Comprehensive name fallbacks
          const name = 
            e.displayName ||
            e.username ||
            e.authorDisplayName ||
            e.author?.name ||
            (e.author && e.author.name) ||
            'Unknown';
          
          // Use the avatar from the event with fallbacks
          const avatar = 
            e.avatarUrl || 
            e.avatar ||
            (e.author && e.author.avatar) ||
            '';
          
          addItem({ 
            avatar: avatar, 
            name: name, 
            html: `SENT A STICKER`, 
            provider: 'youtube' 
          });
          break;
        }
      }
    }
  });


  const offTwitchDataUpdate = window.hs.providers.twitch.onData((data) => {
    console.log('🔥 [Overlay] IPC LISTENER CALLED! Event received successfully!');
    console.log('[Overlay] Received Twitch data update:', data);
    
    // Update viewer count
    if (data.viewerCount !== undefined) {
      document.getElementById('twitchViewers').textContent = data.viewerCount || '–';
    }

    // Process new events
    if (data && data.events && data.events.length > 0) {
      console.log(`[Overlay] Received ${data.events.length} Twitch events`);
      data.events.forEach(event => {
        // All actionable events now arrive via 'overlay-event'; ignore here
        return;
      });
    } else {
      console.log('[Overlay] No Twitch events to process');
    }

    // Update connection status
    updateConnectionStatus('twitch', data.connectionStatus);
  });

  // Function to handle Twitch events

  // Make functions globally accessible

  // Token reload listener for auth refresh
  const offReloadTokens = window.hs.onReloadTokens(async () => {
    console.log('🔄 [Overlay] Reloading tokens from secure storage...');
    TOKENS = await window.hs.auth.getTokens();
    console.log('✅ [Overlay] Tokens reloaded successfully');
  });

  // Connection status listeners for service status updates
  const offTwitchConn = window.hs.providers.twitch.onStatus((data) => {
    console.log('[Overlay] Received Twitch connection status update:', data);
    const status = data.connectionStatus !== undefined ? data.connectionStatus : data;
    updateConnectionStatus('twitch', status);
    twitchServiceRunning = data.connectionStatus;
  });

  const offYouTubeConn = window.hs.providers.youtube.onStatus((data) => {
    console.log('[Overlay] Received YouTube connection status update:', data);
    console.log('[Overlay] data.connectionStatus value:', data.connectionStatus);
    console.log('[Overlay] data.connectionStatus type:', typeof data.connectionStatus);
    console.log('[Overlay] About to call updateConnectionStatus with:', 'youtube', data.connectionStatus);
    updateConnectionStatus('youtube', data.connectionStatus);
    console.log('[Overlay] updateConnectionStatus call completed');
    youtubeServiceRunning = data.connectionStatus;
  });

  const offYouTubeDataUpdate = window.hs.providers.youtube.onData((data) => {
    console.log('🔥 [Overlay] IPC LISTENER CALLED! Event received successfully!');
    console.log('[Overlay] Received YouTube data update:', data);
    
    // Update viewer count
    if (data.viewerCount !== undefined) {
      document.getElementById('ytViewers').textContent = data.viewerCount || '–';
    }
    
    // Update total jewels counter if provided
    if (data.totalJewels !== undefined) {
      ytJewels = data.totalJewels;
      document.getElementById('ytJewels').textContent = ytJewels;
    }

    // Process new events
    if (data && data.events && data.events.length > 0) {
      console.log(`[Overlay] Received ${data.events.length} YouTube events`);
      data.events.forEach(event => {
        // All actionable events now arrive via 'overlay-event'; ignore here
        return;
      });
    } else {
      console.log('[Overlay] No YouTube events to process');
    }

    // Update connection status
    updateConnectionStatus('youtube', data.connectionStatus);
  });

  // Function to update connection status for a platform
  function updateConnectionStatus(platform, status) {
    console.log(`[updateConnectionStatus] Called with platform: ${platform}, status: ${status}`);
    const statusElement = document.getElementById(`${platform}-status`);
    console.log(`[updateConnectionStatus] Found element:`, statusElement);
    if (statusElement) {
      console.log(`[updateConnectionStatus] Element classes before update:`, statusElement.classList.toString());
      if (status === true) {
        statusElement.classList.remove('status-disconnected');
        statusElement.classList.add('status-connected');
        console.log(`[updateConnectionStatus] Added status-connected class`);
      } else {
        statusElement.classList.remove('status-connected');
        statusElement.classList.add('status-disconnected');
        console.log(`[updateConnectionStatus] Added status-disconnected class`);
      }
      console.log(`[updateConnectionStatus] Element classes after update:`, statusElement.classList.toString());
    } else {
      console.error(`[updateConnectionStatus] ❌ Element with ID '${platform}-status' not found!`);
    }
  }

  // Function to send event to API via IPC
  function sendEventToAPI(item) {
    try {
      // Extract event type from the HTML content
      let eventType = 'unknown';
      let amount = null;
      let message = null;
      
      const htmlLower = item.html.toLowerCase();
      
      // Twitch events
      if (item.provider === 'twitch') {
        if (htmlLower.includes('followed')) eventType = 'follower';
        else if (htmlLower.includes('gifted') && htmlLower.includes('subs')) eventType = 'gift_purchase';
        else if (htmlLower.includes('received a sub from')) eventType = 'gift_subscription';
        else if (htmlLower.includes('subscribed for')) eventType = 'subscriber';
        else if (htmlLower.includes('new subscriber') || htmlLower.includes('resub')) eventType = 'subscriber';
        else if (htmlLower.includes('cheered')) {
          eventType = 'bits';
          // Extract bits amount from "CHEERED<br><span>(X bits)</span>" pattern
          const bitsMatch = item.html.match(/\((\d+)\s*bits\)/i);
          if (bitsMatch) amount = parseInt(bitsMatch[1]);
        }
        else if (htmlLower.includes('raid')) {
          eventType = 'raid';
          // Extract viewer count from "RAID with X viewers" pattern
          const viewerMatch = item.html.match(/(\d+)\s*viewers/i);
          if (viewerMatch) amount = parseInt(viewerMatch[1]);
        }
        else if (htmlLower.includes('redeemed')) eventType = 'channel_point_redemption';
      }
      // YouTube events
      else if (item.provider === 'youtube') {
        if (htmlLower.includes('super chat')) {
          eventType = 'superchat';
          // Extract amount from "SUPER CHAT<br><span>(amount)</span>" pattern
          const amountMatch = item.html.match(/\(([^)]+)\)/i);
          if (amountMatch) {
            message = amountMatch[1]; // Store amount as message for display
            // Also try to extract numeric amount for potential future use
            const numericMatch = amountMatch[1].match(/[\d.]+/);
            if (numericMatch) amount = parseFloat(numericMatch[0]);
          }
        }
        else if (htmlLower.includes('super sticker')) {
          eventType = 'supersticker';
          // Extract amount from "SUPER STICKER<br><span>(amount)</span>" pattern
          const amountMatch = item.html.match(/\(([^)]+)\)/i);
          if (amountMatch) {
            message = amountMatch[1]; // Store amount as message for display
            // Also try to extract numeric amount for potential future use
            const numericMatch = amountMatch[1].match(/[\d.]+/);
            if (numericMatch) amount = parseFloat(numericMatch[0]);
          }
        }
        else if (htmlLower.includes('gifted') && htmlLower.includes('membership')) eventType = 'gift_membership_purchase';
        else if (htmlLower.includes('new member') || htmlLower.includes('membership')) eventType = 'membership';
        else if (htmlLower.includes('milestone')) eventType = 'milestone';
        else if (htmlLower.includes('subscribed')) eventType = 'subscription';
        else if (htmlLower.includes('gift')) {
          eventType = 'jewel_gift';
          // Extract jewel count from "100 Gift<br><span>(2 jewels)</span>" pattern
          const jewelMatch = item.html.match(/\((\d+)\s+jewels?\)/);
          if (jewelMatch) amount = parseInt(jewelMatch[1]);
          
          // Extract gift name from "Happy poop Gift<br>" pattern (everything before "Gift")
          // Updated regex to capture multi-word gift names including spaces
          let giftNameMatch = item.html.match(/^(.+?)\s+Gift/);
          if (!giftNameMatch) {
            // Try without start anchor in case there's whitespace
            giftNameMatch = item.html.match(/(.+?)\s+Gift/);
          }
          if (giftNameMatch) {
            // Store gift name in a separate variable to avoid conflicts
            item.extractedGiftName = giftNameMatch[1];
            console.log(`[Overlay] Extracted gift name: "${giftNameMatch[1]}" from HTML: "${item.html}"`);
          } else {
            console.log(`[Overlay] Failed to extract gift name from HTML: "${item.html}"`);
          }
        }
      }
      // TikTok events
      else if (item.provider === 'tiktok') {
        if (htmlLower.includes('followed')) eventType = 'follow';
        else if ((htmlLower.includes('sent') && htmlLower.includes('×')) || item.giftName) eventType = 'gift';
        else if (htmlLower.includes('gift sub')) eventType = 'subscription';
        else if (htmlLower.includes('new sub') || htmlLower.includes('subscribed')) eventType = 'subscription';
        
        // For TikTok gifts, extract additional data
        if (eventType === 'gift') {
          // Extract gift count from "sent 5× GiftName" pattern
          const countMatch = item.html.match(/sent (\d+)×/);
          if (countMatch) amount = parseInt(countMatch[1]);
          
          // Extract gift name from "sent 5× GiftName" pattern
          const nameMatch = item.html.match(/sent \d+×\s*([^<]+)/);
          if (nameMatch) {
            message = nameMatch[1].trim();
          }
        }
      }
      
      // Extract message if present (but don't override TikTok gift data)
      if (item.html.includes(':') && eventType !== 'gift') {
        const parts = item.html.split(':');
        if (parts.length > 1) {
          message = parts.slice(1).join(':').trim();
        }
      }
      
      // Build standardized event object
      const eventData = {
        platform: item.provider,
        type: eventType,
        username: item.name,
        displayName: item.name,
        avatar: item.avatar || '',
        timestamp: new Date().toISOString()
      };
      
      // Add optional fields if present
      if (amount) eventData.amount = amount;
      if (message) eventData.message = message;
      
      // For TikTok gifts, add gift-specific data
      if (item.provider === 'tiktok' && eventType === 'gift') {
        if (item.giftImageUrl) eventData.giftImageUrl = item.giftImageUrl;
        if (item.giftName) eventData.giftName = item.giftName;
        if (item.giftCount) eventData.amount = item.giftCount; // Use giftCount as amount
        if (item.diamondCount) eventData.diamondCount = item.diamondCount;
        
        // If we extracted gift name from HTML, also set it as giftName field
        if (message && !item.giftName) {
          eventData.giftName = message;
        }
        
        // Also preserve the full HTML as message if no gift name was extracted
        if (!message) {
          eventData.message = item.html;
        }
      }
      
      // For YouTube gift memberships, extract gift count from HTML
      if (item.provider === 'youtube' && eventType === 'gift_membership_purchase') {
        // Extract gift count from HTML like "GIFTED 5 MEMBERSHIPS"
        const giftCountMatch = item.html.match(/GIFTED\s+(\d+)\s+MEMBERSHIP/i);
        if (giftCountMatch) {
          eventData.giftCount = parseInt(giftCountMatch[1], 10);
          console.log(`[Overlay] Extracted giftCount: ${eventData.giftCount} from HTML: ${item.html}`);
        }
      }
      
      // For YouTube Jewel gifts, add Jewel-specific data
      if (item.provider === 'youtube' && eventType === 'jewel_gift') {
        // Ensure amount is properly set as Jewel count
        if (amount) {
          eventData.jewelCount = amount;
          eventData.amount = amount; // Keep amount for API compatibility
        }
        
        // Use extracted gift name from item, or default to "Gift"
        eventData.giftName = item.extractedGiftName || 'Gift';
        eventData.giftType = 'jewel_gift';
        
        // Create clean raw message from the gift name and jewel count
        if (eventData.giftName && eventData.jewelCount) {
          eventData.rawMessage = `sent ${eventData.giftName} for ${eventData.jewelCount} Jewels`;
        } else {
          eventData.rawMessage = 'Jewel gift'; // Fallback
        }
        
        // Clear the message field to avoid confusion
        eventData.message = '';
        
        console.log(`[Overlay] Jewel gift event created: ${amount} jewels from ${item.name}, gift: ${eventData.giftName}`);
      }
      
      // For Twitch gift subscriptions, extract gift count from HTML
      if (item.provider === 'twitch' && eventType === 'gift_purchase') {
        // Extract gift count from HTML like "GIFTED 5 SUBS"
        const giftCountMatch = item.html.match(/GIFTED\s+(\d+)\s+SUBS/i);
        if (giftCountMatch) {
          eventData.giftCount = parseInt(giftCountMatch[1], 10);
          console.log(`[Overlay] Extracted giftCount: ${eventData.giftCount} from HTML: ${item.html}`);
        }
      }
      
      // Debug logging for API event formatting
      console.log(`[Overlay] Sending ${eventData.platform} ${eventData.type} event to API:`, eventData);
      
      // Send to main process
      window.hs.stream.emit(eventData);
      
    } catch (error) {
      console.error('[Overlay] Error sending event to API:', error);
    }
  }
  
  // Function to add an item to the feed
  function addItem(item) {
    const $feed = $('.feed');
    
    // Don't apply flash animation for gifts that are still animating
    const shouldAnimate = !item.isAnimating;
    const animationClasses = shouldAnimate ? 'event-animate' : '';
    
    // Add data-gift-key attribute if it's a TikTok gift that's still accumulating
    const giftKeyAttr = item.giftKey ? `data-gift-key="${item.giftKey}"` : '';
    
    const $item = $(`<div class="event-row" ${giftKeyAttr}>
      <div class='provider-icon-box'><img src='${item.provider === 'twitch' ? 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png' : item.provider === 'youtube' ? 'https://www.youtube.com/favicon.ico' : 'https://www.tiktok.com/favicon.ico'}' alt='${item.provider}'></div>
      <div class="item ${item.provider}-item ${item.extraClass || ''} ${animationClasses}">
        <img class="avatar" src="${item.avatar}" alt="">
        <div class="username">${item.name}</div>
        <div class="details">${item.html}</div>
      </div>
    </div>`);
    $feed.append($item);
    $feed.each(function() { this.scrollTop = this.scrollHeight; });
    
    // Remove animation classes after animation completes to allow future animations
    if (shouldAnimate) {
      setTimeout(() => {
        $item.find('.item').removeClass('event-animate');
      }, 1500);
    }
    
    // Limit to 30 most recent events
    while ($feed.children('.event-row').length > 30) {
      $feed.children('.event-row').first().remove();
    }
    
    // Send event to main process for API storage
    sendEventToAPI(item);
  }
  
  // Handle font size updates
  const offFontSizeUpdate = window.hs.ui.onFontSizeUpdate((fontSizes) => {
    // Clear existing dynamic styles
    const existingStyles = document.querySelectorAll('style[data-dynamic-font]');
    existingStyles.forEach(style => style.remove());
    
    // Apply overlay event box size
    if (fontSizes.overlayFontSize) {
      const style = document.createElement('style');
      style.setAttribute('data-dynamic-font', 'true');
      style.textContent = `
        .item { 
          min-height: calc(44px * ${fontSizes.overlayFontSize}) !important;
          padding: calc(0.5em * ${fontSizes.overlayFontSize}) !important;
        }
        .item .left-content {
          font-size: calc(1em * ${fontSizes.overlayFontSize}) !important;
        }
        .item .right-content {
          font-size: calc(1em * ${fontSizes.overlayFontSize}) !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Apply stats font size
    if (fontSizes.statsFontSize) {
      const style = document.createElement('style');
      style.setAttribute('data-dynamic-font', 'true');
      style.textContent = `.stat span { font-size: ${fontSizes.statsFontSize}em !important; }`;
      document.head.appendChild(style);
    }
    
    console.log('Overlay font sizes updated:', fontSizes);
  });

  // Handle background color updates from settings
  const offBackgroundColorUpdate = window.hs.ui.onBackgroundColorUpdate((backgroundColor) => {
    console.log('Overlay background color updated to:', backgroundColor);
    
    // Remove existing dynamic background color style if present
    const existingStyle = document.getElementById('dynamic-background-color-style');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Add new background color style
    const style = document.createElement('style');
    style.id = 'dynamic-background-color-style';
    style.textContent = `
      html { 
        background-color: ${backgroundColor} !important; 
      }
      body { 
        background-color: ${backgroundColor} !important; 
      }
      .stats-wrapper {
        background: ${backgroundColor} !important;
      }
      .stats-wrapper::after {
        background: #8000FF !important;
      }
      .feed-header {
        background: ${backgroundColor} !important;
        border-bottom: 1px solid #8000FF !important;
      }
      .item {
        background: ${backgroundColor} !important;
      }
    `;
    document.head.appendChild(style);
  });

  // Handle events color updates from settings
  const offEventsColorUpdate = window.hs.ui.onEventsColorUpdate((eventsColor) => {
    console.log('Overlay events color updated to:', eventsColor);
    
    // Remove existing dynamic events color style if present
    const existingStyle = document.getElementById('dynamic-events-color-style');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Add new events color style
    const style = document.createElement('style');
    style.id = 'dynamic-events-color-style';
    style.textContent = `
      /* Update main text color */
      body { 
        color: ${eventsColor} !important; 
      }
      
      /* Update stat labels */
      .stat label { 
        color: ${eventsColor} !important; 
      }
      
      /* Update stat borders and backgrounds */
      .stat { 
        border: 2px solid ${eventsColor} !important; 
        background: ${eventsColor}1A !important; 
      }
      
      /* Update stats wrapper border */
      .stats-wrapper::after {
        background: ${eventsColor} !important;
      }
      
      /* Update feed header border */
      .feed-header {
        border-bottom: 1px solid ${eventsColor} !important;
      }
      
      /* Update item borders */
      .item {
        border: 1px solid ${eventsColor} !important;
      }
      
      /* Update provider icon box background */
      .provider-icon-box {
        background: ${eventsColor} !important;
      }
      
      /* Update platform icon filter */
      .platform-icon-inline {
        filter: drop-shadow(0 0 2px ${eventsColor}) !important;
      }
      
      /* Update button colors */
      .stat.polling button {
        color: ${eventsColor} !important;
        border: 1px solid ${eventsColor} !important;
      }
    `;
    document.head.appendChild(style);
  });

  // Platform visibility functions
  function updatePlatformVisibility(visibilitySettings) {
    const platforms = ['tiktok', 'twitch', 'youtube'];
    
    platforms.forEach(platform => {
      const row = document.getElementById(`${platform}-platform-row`);
      const isVisible = visibilitySettings[platform] !== false; // default to true if undefined
      
      if (row) {
        if (isVisible) {
          row.classList.remove('hidden');
        } else {
          row.classList.add('hidden');
        }
      }
    });
  }
  
  // Listen for platform visibility updates from settings
  const offPlatformVisibilityUpdate = window.hs.ui.onPlatformVisibilityUpdate((data) => {
    console.log('[Overlay] Received platform visibility update:', data);
    const platform = data.platform;
    const visible = data.visible;
    
    const row = document.getElementById(`${platform}-platform-row`);
    if (row) {
      if (visible) {
        row.classList.remove('hidden');
      } else {
        row.classList.add('hidden');
      }
    }
  });

  // Clean up IPC listeners on unload
  window.addEventListener('beforeunload', () => {
    try { offTikTokStatus && offTikTokStatus(); } catch {}
    // try { offTikTokMessage && offTikTokMessage(); } catch {} // Disabled - using overlay-event
    try { offOverlayEvent && offOverlayEvent(); } catch {}
    try { offTwitchDataUpdate && offTwitchDataUpdate(); } catch {}
    try { offReloadTokens && offReloadTokens(); } catch {}
    try { offTwitchConn && offTwitchConn(); } catch {}
    try { offYouTubeConn && offYouTubeConn(); } catch {}
    try { offYouTubeDataUpdate && offYouTubeDataUpdate(); } catch {}
    try { offFontSizeUpdate && offFontSizeUpdate(); } catch {}
    try { offBackgroundColorUpdate && offBackgroundColorUpdate(); } catch {}
    try { offEventsColorUpdate && offEventsColorUpdate(); } catch {}
    try { offPlatformVisibilityUpdate && offPlatformVisibilityUpdate(); } catch {}
  });

  // Mark initialization as complete
  console.log('[Overlay] Initialization complete - buttons are now active');
  isInitialized = true;

})();


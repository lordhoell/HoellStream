(async () => {
  // Load OAuth tokens only
  let TOKENS = await window.electron.ipcRenderer.invoke('get-tokens');
  
  // Load configuration for font sizes
  const CONFIG = await window.electron.ipcRenderer.invoke('load-config') || {};
  
  // Apply font sizes from config
  if (CONFIG.CHAT_FONT_SIZE) {
    document.querySelector('.chat-feed').style.fontSize = CONFIG.CHAT_FONT_SIZE + 'px';
  }
  
  // Apply username font size
  if (CONFIG.USERNAME_FONT_SIZE) {
    const style = document.createElement('style');
    style.id = 'dynamic-username-style';
    style.textContent = `.username { font-size: ${CONFIG.USERNAME_FONT_SIZE}em !important; }`;
    document.head.appendChild(style);
  }
  
  // Apply theme color if configured
  if (CONFIG.EVENTS_COLOR) {
    document.documentElement.style.setProperty('--theme-color', CONFIG.EVENTS_COLOR);
  }
  
  console.log('Chat script loaded with OAuth tokens');
  console.log('Twitch token available:', !!TOKENS?.twitch?.access_token);

  const feed = document.getElementById('chatFeed');
  const icons = {
    tiktok: 'https://www.tiktok.com/favicon.ico',
    twitch: 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png',
    youtube: 'https://www.youtube.com/favicon.ico'
  };
  
  // Connection status tracking
  const connectionStatus = {
    tiktok: false,
    twitch: false,
    youtube: false
  };
  
  // Function to update connection status indicators
  function updateConnectionStatus(service, isConnected) {
    console.log(`updateConnectionStatus called with service: ${service}, isConnected: ${isConnected}`);
    connectionStatus[service] = isConnected;
    const statusElement = document.getElementById(`${service}-status`);
    if (statusElement) {
      if (isConnected) {
        statusElement.classList.remove('status-disconnected');
        statusElement.classList.add('status-connected');
        console.log(`▶ ${service.toUpperCase()} connected`);
      } else {
        statusElement.classList.remove('status-connected');
        statusElement.classList.add('status-disconnected');
        console.log(`▶ ${service.toUpperCase()} disconnected`);
      }
    }
  }

  // Cache for avatars
  const cache = {};
  
  // Emote handling
  const emotes = {};
  
  // Add a chat message to the feed
  function addChat(platform, user, message, avatar, color, isHtml = false, badges = null, eventInfo = null) {
    console.log(`[addChat] Called with:`, { platform, user, message, avatar, color, isHtml, badges, eventInfo });
    
    const line = document.createElement('div');
    line.className = 'chat-line';
    
    // Platform icon
    const platformIcon = document.createElement('img');
    platformIcon.className = 'platform-icon';
    platformIcon.src = icons[platform];
    platformIcon.alt = platform;
    line.appendChild(platformIcon);
    
    // User avatar
    const avatarImg = document.createElement('img');
    avatarImg.className = 'avatar';
    avatarImg.src = avatar || icons[platform];
    avatarImg.alt = user;
    line.appendChild(avatarImg);
    
    // Username with badges
    const username = document.createElement('div');
    username.className = 'username';
    username.textContent = user;
    if (color) username.style.color = color;
    
    // Add badges after username
    if (badges && badges.length > 0) {
      const badgeContainer = document.createElement('span');
      badgeContainer.className = 'badges';
      badgeContainer.innerHTML = ' ' + badges.join(' ');
      username.appendChild(badgeContainer);
    }
    
    line.appendChild(username);
    
    // Message content
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    // Render messages with HTML or emotes
    if (isHtml || platform === 'tiktok' && /gift-icon/.test(message)) {
      messageDiv.innerHTML = message;
    } else if (platform === 'twitch' && emotes[user] && emotes[user][message]) {
      messageDiv.innerHTML = emotes[user][message];
    } else {
      messageDiv.textContent = message;
    }
    
    line.appendChild(messageDiv);
    
    // Add event background styling if this is a special event
    if (eventInfo) {
      line.className += ` event-message ${platform}-event`;
      if (eventInfo.isHighValue) {
        line.className += ' high-value-event';
      }
    }
    
    feed.appendChild(line);
    feed.scrollTop = feed.scrollHeight;
    
    console.log(`[addChat] Successfully added message to feed. Total messages in feed: ${feed.children.length}`);
  }

  async function getAvatar(user) {
    if (cache[user]) return cache[user];

    try {
      const res = await window.electron.ipcRenderer.invoke('twitch-api:get-user', { login: user });
      const url = (res && res.ok && res.data && res.data.data && res.data.data[0] && res.data.data[0].profile_image_url)
        ? res.data.data[0].profile_image_url
        : icons.twitch;

      cache[user] = url;
      return url;
    } catch (err) {
      console.error('Error getting Twitch avatar via IPC:', err);
      return icons.twitch;
    }
  }
  
  // Function to extract TikTok badges from user data
  function extractTikTokBadges(data) {
    const badges = [];
    
    // Check for moderator badge
    if (data.isModerator) {
      badges.push('<span class="badge mod-badge" title="Moderator">👮</span>');
    }
    
    // Check for subscriber badge
    if (data.isSubscriber) {
      // Try to get subscriber badge image from userBadges array
      let subBadgeFound = false;
      if (data.userBadges && Array.isArray(data.userBadges)) {
        for (const badge of data.userBadges) {
          if (badge.type === 'image' && badge.url && badge.url.includes('subs_badge')) {
            badges.push(`<img class="badge sub-badge" src="${badge.url}" title="Subscriber" alt="Sub">`);
            subBadgeFound = true;
            break;
          }
        }
      }
      // Fallback to emoji if no image badge found
      if (!subBadgeFound) {
        badges.push('<span class="badge sub-badge" title="Subscriber">⭐</span>');
      }
    }
    
    return badges;
  }


  // Function to extract YouTube badges from user data
  function extractYouTubeBadges(data) {
    const badges = [];

    // Owner (YouTube usually doesn't expose "owner" as a special graphic in live chat)
    if (data.isChatOwner) {
      badges.push('<span class="badge owner-badge" title="Channel Owner">👑</span>');
    }

    // Moderator badge
    if (data.isChatModerator) {
      const url = (window.youtubeBadgeUrls && window.youtubeBadgeUrls.moderator) || null;
      if (url) {
        badges.push(`<img class="badge mod-badge" src="${url}" alt="Moderator" title="Moderator" />`);
      } else {
        badges.push('<span class="badge mod-badge" title="Moderator">🔧</span>');
      }
    }

    // Member/Sponsor badge
    if (data.isChatSponsor) {
      const url = (window.youtubeBadgeUrls && window.youtubeBadgeUrls.member) || null;
      if (url) {
        badges.push(`<img class="badge member-badge" src="${url}" alt="Channel Member" title="Channel Member" />`);
      } else {
        badges.push('<span class="badge member-badge" title="Channel Member">💎</span>');
      }
    }

    return badges;
  }

  // Function to extract Twitch badges from user data
  function extractTwitchBadges(data) {
    const badges = [];
    const tags = data.tags || {};
    const badgeData = data.badgeData || [];
    
    console.log('[extractTwitchBadges] Processing tags:', tags);
    console.log('[extractTwitchBadges] Badge data:', badgeData);
    
    // If we have official badge data, use those images
    if (badgeData && badgeData.length > 0) {
      // Sort badges by importance (broadcaster > moderator > vip > subscriber)
      const badgeOrder = ['broadcaster', 'moderator', 'vip', 'subscriber', 'bits'];
      
      badgeData.sort((a, b) => {
        const aIndex = badgeOrder.indexOf(a.setId);
        const bIndex = badgeOrder.indexOf(b.setId);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });
      
      badgeData.forEach(badge => {
        let badgeClass = 'badge';
        let shouldShowBadge = true;
        
        // Add specific styling classes - only for badges we want to show
        switch (badge.setId) {
          case 'broadcaster':
            badgeClass += ' owner-badge';
            break;
          case 'moderator':
            badgeClass += ' mod-badge';
            break;
          case 'vip':
            badgeClass += ' vip-badge';
            break;
          case 'subscriber':
            badgeClass += ' sub-badge';
            break;
          default:
            // Skip all other badges (like no-sound, bits, etc.)
            shouldShowBadge = false;
        }
        
        // Only add badge to display if it's one we want to show
        if (shouldShowBadge) {
          badges.push(`<img class="${badgeClass}" src="${badge.imageUrl}" alt="${badge.title}" title="${badge.description}" />`);
        }
      });
    } else {
      // Fallback to emoji badges if no official badge data
      const badgesTag = tags.badges || '';
      const badgesList = badgesTag.split(',').filter(b => b.trim());
      
      // Check individual boolean flags as backup
      const isMod = tags.mod === '1' || badgesList.some(b => b.startsWith('moderator/'));
      const isSub = tags.subscriber === '1' || badgesList.some(b => b.startsWith('subscriber/'));
      const isVip = badgesList.some(b => b.startsWith('vip/'));
      const isBroadcaster = badgesList.some(b => b.startsWith('broadcaster/'));
      
      // Add emoji badges in order of importance
      if (isBroadcaster) {
        badges.push('<span class="badge owner-badge">👑</span>');
      }
      if (isMod) {
        badges.push('<span class="badge mod-badge">🔧</span>');
      }
      if (isVip) {
        badges.push('<span class="badge vip-badge">💎</span>');
      }
      if (isSub) {
        badges.push('<span class="badge sub-badge">⭐</span>');
      }
    }
    
    console.log('[extractTwitchBadges] Extracted badges:', badges);
    return badges;
  }


  // Twitch Chat IPC listener
  const offTwitchChatMessage = window.electron.ipcRenderer.on('twitch-chat-message', (event, data) => {
    console.log('Received Twitch chat message:', data);
    const { username, message, tags } = data;
    const displayName = tags['display-name'] || username;
    getAvatar(username).then(avatar => {
      // Check if message contains HTML (emotes)
      const hasEmotes = message.includes('<img');
      
      // Check if this is a bits/cheer message
      let eventInfo = null;
      const bits = parseInt(tags.bits) || 0;
      if (bits > 0) {
        eventInfo = {
          type: 'Bits',
          details: `${bits} bits`,
          isHighValue: bits >= 1000
        };
      }
      
      addChat('twitch', displayName, message, avatar, null, hasEmotes, extractTwitchBadges(data), eventInfo);
    });
  });

  // YouTube Events IPC listener (for all events including chat)
  const offYouTubeDataUpdate = window.electron.ipcRenderer.on('youtube-data-update', (event, data) => {
    console.log('Received YouTube data update:', data);
    console.log('YouTube events array:', data?.events);
    console.log('Number of YouTube events:', data?.events?.length || 0);
    
    // Add detailed emoji debugging for YouTube chat messages
    if (data && data.chatMessages && data.chatMessages.length > 0) {
      console.log(`🔍 [Chat] Processing ${data.chatMessages.length} YouTube chat messages`);
      data.chatMessages.forEach((msg, index) => {
        console.log(`🔍 [Chat] YouTube message ${index}:`, {
          displayName: msg.displayName,
          message: msg.message,
          fullMessage: msg,
          hasHtml: msg.message && msg.message.includes('<'),
          messageLength: msg.message ? msg.message.length : 0
        });
      });
    }
    
    // Process all events (chat, superchats, memberships, etc.)
    if (data && data.events && data.events.length > 0) {
      data.events.forEach(event => {
        console.log(`🔍 [Chat] Processing YouTube event:`, event);
        console.log(`🔍 [Chat] Event type: ${event.type}`);
        console.log(`🔍 [Chat] Raw event message field:`, event.message);
        console.log(`🔍 [Chat] Raw event text field:`, event.text);
        console.log(`🔍 [Chat] Event contains HTML:`, event.message && event.message.includes('<'));
        
        // Special logging for membership and jewel gift events
        if (event.type === 'sponsor' || event.type === 'gift_membership_purchase' || event.type === 'gift_membership_received') {
          console.log(`🎁 [Chat] MEMBERSHIP EVENT DETECTED:`, event.type, event);
        }
        if (event.type === 'jewel_gift') {
          console.log(`💎 [Chat] JEWEL GIFT EVENT DETECTED:`, event.type, event);
        }
        
        // Map event data with proper avatar and display name fallbacks (like overlay does)
        // BEFORE inserting the name into the chat line:
        const name = 
          event.displayName ||
          event.authorDisplayName ||                // some older shapes
          event.author?.name ||
          (event.handle ? event.handle.replace(/^@/, '') : '') ||
          event.username ||
          event.channelTitle ||
          'Unknown';
        
        const mappedEvent = {
          ...event,
          // Ensure avatar and displayName are available
          avatar: event.author?.avatar || event.avatar || icons.youtube,
          displayName: name
        };
        
        handleYouTubeEvent(event.type, mappedEvent);
      });
    }
    
    // Update connection status
    updateConnectionStatus('youtube', data.connectionStatus);
  });

  // Function to handle YouTube events and display them in chat format
  function handleYouTubeEvent(eventType, eventData) {
    console.log(`🔍 [Chat] handleYouTubeEvent called with type: ${eventType}`, eventData);
    
    // Special logging for membership and jewel gift events
    if (eventType === 'sponsor' || eventType === 'gift_membership_purchase' || eventType === 'gift_membership_received') {
      console.log(`🎁🎁 [Chat] HANDLING MEMBERSHIP EVENT IN handleYouTubeEvent:`, eventType);
    }
    if (eventType === 'jewel_gift') {
      console.log(`💎💎 [Chat] HANDLING JEWEL GIFT EVENT IN handleYouTubeEvent:`, eventType, eventData);
    }
    
    // Skip malformed events with undefined/empty content
    if (!eventType || eventType === 'undefined') {
      console.log(`⚠️ [Chat] Ignoring malformed YouTube event with undefined type`);
      return;
    }
    
    let message = '';
    const rawMessage = eventData.message || eventData.text || '';
    
    switch(eventType) {
      case 'chat':
      case 'textMessageEvent':
        // For chat messages, skip if empty
        if (!rawMessage || rawMessage === 'undefined') {
          console.log(`⚠️ [Chat] Ignoring YouTube chat event with undefined/empty message`);
          return;
        }
        // Regular chat message - check for emoji processing
        console.log(`🔍 [Chat] Processing YouTube chat message: "${rawMessage}"`);
        console.log(`🔍 [Chat] Message contains HTML: ${rawMessage.includes('<')}`);
        console.log(`🔍 [Chat] Message contains img tags: ${rawMessage.includes('<img')}`);
        
        // Check if message already contains processed emojis (HTML img tags)
        if (rawMessage.includes('<img') && rawMessage.includes('youtube-emoji')) {
          console.log(`✅ [Chat] Message already contains processed YouTube emojis!`);
          message = rawMessage; // Use as-is since it's already processed
        } else {
          console.log(`📝 [Chat] Using raw message text (no emojis detected)`);
          message = rawMessage;
        }
        break;
      case 'superchat':
      case 'superChatEvent':
        message = `Super Chat ${eventData.amount || ''} ${eventData.message || ''}`.trim();
        break;
      case 'supersticker':
      case 'superStickerEvent':
        message = `Super Sticker ${eventData.amount || ''}`;
        break;
      case 'sponsor':
      case 'newSponsorEvent':
        if (eventData.gifted) {
          if (eventData.giftCount) {
            message = `gifted ${eventData.giftCount} memberships`;
          } else {
            message = `gifted a membership`;
          }
          if (eventData.giftRecipient) {
            message += ` to ${eventData.giftRecipient}`;
          }
          if (eventData.memberLevelName) {
            message += ` (${eventData.memberLevelName})`;
          }
        } else {
          message = `just became a member!`;
          if (eventData.memberLevelName) {
            message = `just became a ${eventData.memberLevelName} member!`;
          }
          if (eventData.isUpgrade) {
            message = `upgraded their membership to ${eventData.memberLevelName || 'Member'}!`;
          }
        }
        break;
      case 'milestone':
      case 'memberMilestoneChatEvent':
        message = `membership milestone`;
        if (eventData.memberMonth) {
          message += ` (${eventData.memberMonth} months)`;
        }
        if (eventData.message) {
          message += `: ${eventData.message}`;
        }
        break;
      case 'gift_membership_purchase':
      case 'membershipGiftingEvent':
        message = `gifted ${eventData.giftCount || 1} memberships`;
        if (eventData.memberLevelName) {
          message += ` (${eventData.memberLevelName})`;
        }
        break;
      case 'gift_membership_received':
        // When someone receives a gifted membership
        message = `received a gifted membership`;
        if (eventData.gifter && eventData.gifter !== 'Anonymous Gifter') {
          message += ` from ${eventData.gifter}`;
        }
        if (eventData.memberLevelName) {
          message += ` (${eventData.memberLevelName})`;
        }
        break;
      case 'subscription':
        message = 'subscribed!';
        break;
      case 'jewel_gift':
        message = `💎 ${eventData.giftName} (${eventData.jewelCount} jewels)`;
        break;
      default:
        message = eventData.message || eventData.text || `${eventType}`;
    }

    // Add to chat feed using the properly mapped data
    // Check if message contains HTML emoji tags and use HTML rendering
    const hasEmojis = message.includes('<img') && message.includes('youtube-emoji');
    console.log(`🔍 [Chat] Adding YouTube message to chat. HasEmojis: ${hasEmojis}, Message: "${message}"`);
    
    // Create eventInfo for special events (not regular chat)
    let eventInfo = null;
    if (eventType !== 'chat' && eventType !== 'textMessageEvent') {
      eventInfo = {
        type: getEventTypeLabel(eventType),
        details: getEventDetails(eventType, eventData),
        isHighValue: isHighValueEvent(eventType, eventData)
      };
    }
    
    addChat('youtube', eventData.displayName, message, eventData.avatar, null, hasEmojis, extractYouTubeBadges(eventData), eventInfo);
  }

  // Helper functions for event info
  function getEventTypeLabel(eventType) {
    const labels = {
      'superchat': 'Super Chat',
      'supersticker': 'Super Sticker',
      'sponsor': 'Membership',
      'milestone': 'Milestone',
      'gift_membership_purchase': 'Gift Memberships',
      'gift_membership_received': 'Gifted Membership',
      'jewel_gift': 'Jewel Gift',
      'subscription': 'Subscription',
      'follow': 'Follow',
      'gift_purchase': 'Gift Subs',
      'gift_subscription': 'Gift Sub',
      'bits': 'Bits',
      'raid': 'Raid',
      'gift': 'Gift',
      'subscribe': 'Subscribe'
    };
    return labels[eventType] || eventType;
  }
  
  function getEventDetails(eventType, eventData) {
    switch(eventType) {
      case 'superchat':
        return eventData.amount || '';
      case 'supersticker':
        return eventData.amount || '';
      case 'sponsor':
        if (eventData.gifted && eventData.giftCount) {
          return `${eventData.giftCount} gifts`;
        }
        return eventData.memberLevelName || 'Member';
      case 'milestone':
        return `${eventData.memberMonth || 0} months`;
      case 'gift_membership_purchase':
        return `${eventData.giftCount || 1} gifts`;
      case 'jewel_gift':
        return `${eventData.jewelCount || 0} jewels`;
      case 'gift_purchase':
        return `${eventData.giftCount || eventData.count || 1} subs`;
      case 'gift_subscription':
        const tierName = eventData.tier ? eventData.tier.replace('1000', '1').replace('2000', '2').replace('3000', '3') : '1';
        return `Tier ${tierName}`;
      case 'subscription':
        if (!eventData.isGift) {
          const subTierName = eventData.tier ? eventData.tier.replace('1000', '1').replace('2000', '2').replace('3000', '3') : '1';
          return `Tier ${subTierName}`;
        }
        return '';
      case 'bits':
        return `${eventData.bits || eventData.amount || 0} bits`;
      case 'raid':
        return `${eventData.viewers || eventData.viewerCount || 0} viewers`;
      case 'gift':
        const count = eventData.repeatCount || 1;
        const totalDiamonds = (eventData.diamondCount || 0) * count;
        return `${totalDiamonds} diamonds`;
      default:
        return '';
    }
  }
  
  function isHighValueEvent(eventType, eventData) {
    // Consider events high value based on type and amount
    switch(eventType) {
      case 'superchat':
        const amount = parseFloat(eventData.amount?.replace(/[^0-9.]/g, '') || '0');
        return amount >= 50;
      case 'jewel_gift':
        return (eventData.jewelCount || 0) >= 100;
      case 'gift_membership_purchase':
        return (eventData.giftCount || 0) >= 5;
      case 'bits':
        return (eventData.bits || eventData.amount || 0) >= 1000;
      case 'gift':
        const totalDiamonds = (eventData.diamondCount || 0) * (eventData.repeatCount || 1);
        return totalDiamonds >= 5000; // Raised threshold to exclude common gifts like Galaxy
      default:
        return false;
    }
  }

  // TikTok IPC (Centralized WebSocket)
  
  // Listen for TikTok status updates from main process
  const offTikTokStatus = window.electron.ipcRenderer.on('tiktok-status', (event, status) => {
    console.log('▶ TikTok status update:', status);
    updateConnectionStatus('tiktok', status === 'connected');
  });
  
  // Listen for TikTok messages from main process
  const offTikTokMessage = window.electron.ipcRenderer.on('tiktok-message', (event, m) => {
      console.log('▶ TikTok raw event:', m);
      
      if (m.event === 'chat') {
        const d = m.data;
        const avatar = d.profilePictureUrl || icons.tiktok;
        const displayName = d.nickname || d.uniqueId || 'Unknown';
        
        // COMPREHENSIVE LOGGING FOR BADGE INVESTIGATION
        console.log('=== TikTok Chat Message Data Analysis ===');
        console.log('▶ TikTok chat FULL DATA STRUCTURE:', JSON.stringify(d, null, 2));
        console.log('▶ TikTok chat ALL AVAILABLE KEYS:', Object.keys(d));
        console.log('▶ TikTok chat DATA TYPES:', Object.keys(d).map(key => `${key}: ${typeof d[key]}`));
        
        // Look for potential badge fields
        const potentialBadgeFields = [
          'isModerator', 'moderator', 'mod', 'userRole', 'role',
          'isSubscriber', 'subscriber', 'sub', 'followRole', 
          'badges', 'userBadges', 'userLevel', 'level',
          'followInfo', 'subscriptionInfo', 'userInfo', 'authorInfo'
        ];
        
        console.log('▶ TikTok POTENTIAL BADGE FIELDS CHECK:');
        potentialBadgeFields.forEach(field => {
          if (d.hasOwnProperty(field)) {
            console.log(`  ✅ FOUND: ${field} =`, d[field]);
          }
        });
        
        // Enhanced logging for TikTok chat messages
        console.log('▶ TikTok chat message:', {
          text: d.comment,
          fullData: d,
          hasEmoji: d.comment && (d.comment.includes('\uD83D') || d.comment.includes('\uD83C')), // Basic emoji detection
          charCodes: d.comment ? Array.from(d.comment).map(c => c.charCodeAt(0).toString(16)) : [],
          emotes: d.emotes
        });
        console.log('=== End TikTok Data Analysis ===');
        
        // Process TikTok emotes if present
        let processedMessage = d.comment || '';
        
        // Check if the message has emotes to process
        if (d.emotes && Array.isArray(d.emotes) && d.emotes.length > 0) {
          console.log('▶ TikTok message has emotes:', d.emotes);
          
          // Create HTML for each emote
          // Clear the message text since we're just showing emotes
          processedMessage = '';
          
          d.emotes.forEach(emote => {
            if (emote.emoteImageUrl) {
              // Create an image tag for the emote
              const emoteImg = `<img class='emote' src='${emote.emoteImageUrl}' alt='${emote.emoteId || "emote"}' title='${emote.emoteId || ""}'>`;
              // Add the emote to the message
              processedMessage += emoteImg;
            }
          });
          
          // If the message was empty and we only added emotes, add a space for better display
          if (d.comment.trim() === '') {
            console.log('▶ TikTok: Empty message with only emotes');
          } else {
            // If there was text in the original message, add it back
            processedMessage = d.comment + ' ' + processedMessage;
          }
          
          // Use innerHTML for messages with emotes
          addChat('tiktok', displayName, processedMessage, avatar, null, true, extractTikTokBadges(d));
        } else {
          // Regular text message without emotes
          addChat('tiktok', displayName, processedMessage, avatar, null, false, extractTikTokBadges(d));
        }
      } else if (m.event === 'gift') {
        const d = m.data;
        // Only show after stacking is complete
        if (d.giftType === 1 && !d.repeatEnd) return;
        const avatar = d.profilePictureUrl || icons.tiktok;
        const displayName = d.nickname || d.uniqueId || 'Unknown';
        const count = d.repeatCount || 1;
        const totalDiamonds = (d.diamondCount || 0) * count;
        
        // Log gift details for debugging
        console.log(`▶ TikTok Gift: ${d.giftName} - ${count}x${d.diamondCount} = ${totalDiamonds} diamonds`);
        
        const giftIcon = d.giftPictureUrl ? `<img class='gift-icon' src='${d.giftPictureUrl}' alt='gift'>` : '';
        // Format: USERNAME: sent AMOUNT× GIFT TITLE GIFT PICTURE (DIAMONDS)
        const giftMsg = `sent ${count}× ${d.giftName} ${giftIcon} <span style='font-size:0.85em;color:#FFD700;'>(${totalDiamonds} diamonds)</span>`;
        const eventInfo = {
          type: 'Gift',
          details: `${totalDiamonds} diamonds`,
          isHighValue: totalDiamonds >= 1000
        };
        addChat('tiktok', displayName, giftMsg, avatar, null, true, extractTikTokBadges(d), eventInfo);
      } else if (m.event === 'follow') {
        const d = m.data;
        const avatar = d.profilePictureUrl || icons.tiktok;
        const displayName = d.nickname || d.uniqueId || 'Unknown';
        // Format: USERNAME: followed
        const followMsg = `followed`;
        const eventInfo = {
          type: 'Follow',
          details: 'New follower',
          isHighValue: false
        };
        addChat('tiktok', displayName, followMsg, avatar, null, false, extractTikTokBadges(d), eventInfo);
      } else if (m.event === 'subscribe') {
        const d = m.data;
        const avatar = d.profilePictureUrl || icons.tiktok;
        const displayName = d.nickname || d.uniqueId || 'Unknown';
        // Format: USERNAME: subscribed
        const subMsg = `subscribed`;
        const eventInfo = {
          type: 'Subscribe',
          details: 'New subscriber',
          isHighValue: false
        };
        addChat('tiktok', displayName, subMsg, avatar, null, false, extractTikTokBadges(d), eventInfo);
      }
  });

  // YouTube polling variables
  let ytNextPageToken = '';
  let youtubePollingInterval = null;

  // Set up YouTube service data listeners
  const offYouTubeConn = window.electron.ipcRenderer.on('youtube-connection-status', (event, data) => {
    if (data && typeof data.connectionStatus !== 'undefined') {
      updateConnectionStatus('youtube', data.connectionStatus);
    }
  });

  const offTwitchConn = window.electron.ipcRenderer.on('twitch-connection-status', (event, data) => {
    if (data && typeof data.connectionStatus !== 'undefined') {
      updateConnectionStatus('twitch', data.connectionStatus);
    }
  });

  // Twitch Events IPC listener (for all events including subscriptions, bits, raids, follows)
  const offTwitchDataUpdate = window.electron.ipcRenderer.on('twitch-data-update', (event, data) => {
    console.log('Received Twitch data update:', data);
    
    // Process all events (subscriptions, raids, follows, etc.)
    // Skip bits events since they're already shown in chat messages with event boxes
    if (data && data.events && data.events.length > 0) {
      data.events.forEach(event => {
        console.log(`🔍 [Chat] Processing Twitch event:`, event);
        // Skip bits/cheer events - they're already displayed in chat messages with event boxes
        if (event.type === 'bits' || event.type === 'cheer') {
          console.log(`🔍 [Chat] Skipping bits event (already shown in chat with event box):`, event);
          return;
        }
        handleTwitchEvent(event.type, event);
      });
    }
    
    // Update connection status
    updateConnectionStatus('twitch', data.connectionStatus);
  });

  // Function to handle Twitch events and display them in chat format
  function handleTwitchEvent(eventType, eventData) {
    console.log(`🔍 [Chat] handleTwitchEvent called with type: ${eventType}`, eventData);
    
    // Skip malformed events
    if (!eventType || eventType === 'undefined') {
      console.log(`⚠️ [Chat] Ignoring malformed Twitch event with undefined type`);
      return;
    }
    
    let message = '';
    let displayName = eventData.displayName || eventData.username || 'Unknown';
    let avatar = eventData.avatar || icons.twitch;
    
    switch(eventType) {
      case 'follow':
        message = 'followed';
        break;
      case 'gift_purchase':
        // Handle mass gift purchase events (gifter announcing they gifted X subs)
        const giftCount = eventData.giftCount || eventData.count || 1;
        message = `gifted ${giftCount} sub${giftCount > 1 ? 's' : ''}`;
        if (eventData.tier && eventData.tier !== '1000') {
          const tierName = eventData.tier.replace('1000', '1').replace('2000', '2').replace('3000', '3');
          message += ` (Tier ${tierName})`;
        }
        break;
      case 'gift_subscription':
        // Handle individual gift subscription recipients
        displayName = eventData.gifter || eventData.gifterDisplayName || 'Someone';
        avatar = eventData.gifterAvatar || avatar;
        const giftRecipient = eventData.username || eventData.displayName || 'someone';
        message = `gifted a sub to ${giftRecipient}`;
        if (eventData.tier && eventData.tier !== '1000') {
          const tierName = eventData.tier.replace('1000', '1').replace('2000', '2').replace('3000', '3');
          message += ` (Tier ${tierName})`;
        }
        break;
      case 'subscription':
        if (eventData.isGift) {
          // For gift subs, show the gifter as the sender
          displayName = eventData.gifterDisplayName || eventData.gifter || displayName;
          avatar = eventData.gifterAvatar || avatar;
          const recipient = eventData.username || eventData.displayName || 'someone';
          message = `gifted a sub to ${recipient}`;
          if (eventData.tier && eventData.tier !== '1000') {
            const tierName = eventData.tier.replace('1000', '1').replace('2000', '2').replace('3000', '3');
            message += ` (Tier ${tierName})`;
          }
        } else {
          message = 'subscribed';
          if (eventData.tier && eventData.tier !== '1000') {
            const tierName = eventData.tier.replace('1000', '1').replace('2000', '2').replace('3000', '3');
            message += ` (Tier ${tierName})`;
          }
          if (eventData.message) {
            message += `: ${eventData.message}`;
          }
        }
        break;
      // Commented out to prevent duplicate bits/cheer messages
      // Bits are already shown in the regular chat messages via twitch-chat-message
      // case 'bits':
      // case 'cheer':
      //   const bitAmount = eventData.bits || eventData.amount || 0;
      //   message = `cheered ${bitAmount} bits`;
      //   if (eventData.message) {
      //     message += `: ${eventData.message}`;
      //   }
      //   break;
      case 'raid':
        const viewers = eventData.viewers || eventData.viewerCount || 0;
        message = `raided with ${viewers} viewers`;
        break;
      default:
        message = eventData.message || eventData.text || `${eventType}`;
    }

    // Create eventInfo for special events
    const eventInfo = {
      type: getEventTypeLabel(eventType),
      details: getEventDetails(eventType, eventData),
      isHighValue: isHighValueEvent(eventType, eventData)
    };
    
    // Add to chat feed
    addChat('twitch', displayName, message, avatar, null, false, extractTwitchBadges(eventData), eventInfo);
  }

  // Token reload listener for auth refresh
  const offReloadTokens = window.electron.ipcRenderer.on('reload-tokens', async () => {
    console.log('🔄 [Chat] Reloading tokens from secure storage...');
    TOKENS = await window.electron.ipcRenderer.invoke('get-tokens');
    console.log('✅ [Chat] Tokens reloaded successfully');
  });

  // Handle YouTube emoji cache updates for retroactive replacement
  const offYouTubeEmojiCacheUpdate = window.electron.ipcRenderer.on('youtube-emoji-cache-update', (event, newEmojiCount) => {
    console.log(`🎨 [Chat] YouTube emoji cache updated with ${newEmojiCount} new emojis - updating recent messages...`);
    updateRecentYouTubeMessagesWithNewEmojis();
  });

  // Initialize YouTube badge URLs cache
  window.youtubeBadgeUrls = {};

  // Function to update YouTube badge URLs from cache
  async function updateYouTubeBadgeUrls() {
    try {
      // Request badge URLs from main process
      const badgeUrls = await window.electron.ipcRenderer.invoke('get-youtube-badge-urls');
      if (badgeUrls) {
        window.youtubeBadgeUrls = badgeUrls;
        console.log('🎖️ [Chat] YouTube badge URLs updated:', badgeUrls);
      }
    } catch (error) {
      console.error('❌ [Chat] Failed to get YouTube badge URLs:', error);
    }
  }

  // Handle YouTube badge cache updates
  const offYouTubeBadgeCacheUpdate = window.electron.ipcRenderer.on('youtube-badge-cache-update', (event, newBadgeCount) => {
    console.log(`🎖️ [Chat] YouTube badge cache updated with ${newBadgeCount} new badges - updating URLs...`);
    updateYouTubeBadgeUrls();
  });

  // Initialize badge URLs on startup
  updateYouTubeBadgeUrls();

  // Handle font size updates
  const offFontSizeUpdate = window.electron.ipcRenderer.on('font-size-update', (event, fontSizes) => {
    if (fontSizes.chatFontSize) {
      document.querySelector('.chat-feed').style.fontSize = fontSizes.chatFontSize + 'px';
      console.log('Chat font size updated to:', fontSizes.chatFontSize + 'px');
    }
    
    // Update username font size
    if (fontSizes.usernameFontSize) {
      // Remove existing style if present
      const existingStyle = document.getElementById('dynamic-username-style');
      if (existingStyle) {
        existingStyle.remove();
      }
      
      // Add new style
      const style = document.createElement('style');
      style.id = 'dynamic-username-style';
      style.textContent = `.username { font-size: ${fontSizes.usernameFontSize}em !important; }`;
      document.head.appendChild(style);
      console.log('Username font size updated to:', fontSizes.usernameFontSize + 'em');
    }
  });

  // Handle text color updates from settings
  const offTextColorUpdate = window.electron.ipcRenderer.on('text-color-update', (event, textColor) => {
    console.log('Chat text color updated to:', textColor);
    
    // Remove existing dynamic text color style if present
    const existingStyle = document.getElementById('dynamic-text-color-style');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Add new text color style
    const style = document.createElement('style');
    style.id = 'dynamic-text-color-style';
    style.textContent = `.message { color: ${textColor} !important; }`;
    document.head.appendChild(style);
  });

  // Handle background color updates from settings
  const offBackgroundColorUpdate = window.electron.ipcRenderer.on('background-color-update', (event, backgroundColor) => {
    console.log('Chat background color updated to:', backgroundColor);
    
    // Remove existing dynamic background color style if present
    const existingStyle = document.getElementById('dynamic-background-color-style');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Add new background color style
    const style = document.createElement('style');
    style.id = 'dynamic-background-color-style';
    style.textContent = `body { background-color: ${backgroundColor} !important; }`;
    document.head.appendChild(style);
  });

  // Handle theme color (events color) updates from settings
  const offEventsColorUpdate = window.electron.ipcRenderer.on('events-color-update', (event, eventsColor) => {
    console.log('Chat username color updated to:', eventsColor);
    
    // Update CSS variable for theme color
    document.documentElement.style.setProperty('--theme-color', eventsColor);
    
    // Remove existing dynamic username color style if present
    const existingStyle = document.getElementById('dynamic-username-color-style');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Add new username color style
    const style = document.createElement('style');
    style.id = 'dynamic-username-color-style';
    style.textContent = `.username { color: ${eventsColor} !important; }`;
    document.head.appendChild(style);
  });

  // Handle TikTok test messages (global function for test system)
  window.handleTikTokMessage = function(messageData) {
    console.log('🧪 [Chat] handleTikTokMessage called with:', messageData);
    
    if (messageData.event === 'chat') {
      const d = messageData.data;
      const avatar = d.profilePictureUrl || icons.tiktok;
      const displayName = d.nickname || d.uniqueId || 'Unknown';
      
      // Process TikTok emotes if present
      let processedMessage = d.comment || '';
      
      // Check if the message has emotes to process
      if (d.emotes && Array.isArray(d.emotes) && d.emotes.length > 0) {
        console.log('▶ TikTok test message has emotes:', d.emotes);
        
        // Create HTML for each emote
        processedMessage = '';
        
        d.emotes.forEach(emote => {
          if (emote.emoteImageUrl) {
            const emoteImg = `<img class='emote' src='${emote.emoteImageUrl}' alt='${emote.emoteId || "emote"}' title='${emote.emoteId || ""}'>`;
            processedMessage += emoteImg;
          }
        });
        
        if (d.comment.trim() !== '') {
          processedMessage = d.comment + ' ' + processedMessage;
        }
        
        // Use innerHTML for messages with emotes
        addChat('tiktok', displayName, processedMessage, avatar, null, true, []);
      } else {
        // Regular text message without emotes
        addChat('tiktok', displayName, processedMessage, avatar, null, false, []);
      }
    }
  };

  // Retroactively update recent YouTube messages with newly cached emojis
  async function updateRecentYouTubeMessagesWithNewEmojis() {
    const chatLines = feed.querySelectorAll('.chat-line');
    const recentLines = Array.from(chatLines).slice(-20); // Process last 20 messages
    
    console.log(`🎨 [Chat] Checking ${recentLines.length} recent messages for YouTube emoji updates...`);
    
    for (const line of recentLines) {
      const messageDiv = line.querySelector('.message');
      const platformIcon = line.querySelector('.platform-icon');
      
      // Only process YouTube messages that contain emoji shortcodes
      if (messageDiv && platformIcon && platformIcon.alt === 'youtube') {
        const currentText = messageDiv.textContent;
        
        // Check if message contains emoji shortcodes that might now be cached
        if (currentText && currentText.includes(':')) {
          console.log(`🎨 [Chat] Re-processing YouTube message: "${currentText}"`);
          
          try {
            // Request fresh processing from YouTube API service
            const processedMessage = await window.electron.ipcRenderer.invoke('youtube-process-message', currentText);
            
            if (processedMessage && processedMessage !== currentText) {
              console.log(`🎨 [Chat] ✅ Updated message: "${currentText}" -> "${processedMessage}"`);
              messageDiv.innerHTML = processedMessage;
            }
          } catch (error) {
            console.error('🎨 [Chat] ❌ Failed to re-process message:', error);
          }
        }
      }
    }
  }

  // Clean up IPC listeners on unload
  window.addEventListener('beforeunload', () => {
    try { offTwitchChatMessage && offTwitchChatMessage(); } catch {}
    try { offYouTubeDataUpdate && offYouTubeDataUpdate(); } catch {}
    try { offTikTokStatus && offTikTokStatus(); } catch {}
    try { offTikTokMessage && offTikTokMessage(); } catch {}
    try { offYouTubeConn && offYouTubeConn(); } catch {}
    try { offTwitchConn && offTwitchConn(); } catch {}
    try { offTwitchDataUpdate && offTwitchDataUpdate(); } catch {}
    try { offReloadTokens && offReloadTokens(); } catch {}
    try { offYouTubeEmojiCacheUpdate && offYouTubeEmojiCacheUpdate(); } catch {}
    try { offYouTubeBadgeCacheUpdate && offYouTubeBadgeCacheUpdate(); } catch {}
    try { offFontSizeUpdate && offFontSizeUpdate(); } catch {}
    try { offTextColorUpdate && offTextColorUpdate(); } catch {}
    try { offBackgroundColorUpdate && offBackgroundColorUpdate(); } catch {}
    try { offEventsColorUpdate && offEventsColorUpdate(); } catch {}
  });
})();

// tiktok-service.js
const WebSocket = require('ws');

function startTikTok({ url = 'ws://127.0.0.1:21213/', onMessage, onStatus } = {}) {
  let ws = null;
  let reconnectTimer = null;

  const safeStatus = (connected) => { 
    console.log('[TikTok Service] Sending status:', connected);
    try { onStatus && onStatus(!!connected); } catch (e) { 
      console.error('[TikTok Service] Error in onStatus callback:', e);
    }
  };
  const safeMessage = (msg) => { try { onMessage && onMessage(msg); } catch {} };

  const connect = () => {
    try {
      ws = new WebSocket(url);

      ws.on('open', () => {
        console.log('[TikTok Service] WebSocket connected to', url);
        safeStatus(true);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          safeMessage(msg);
        } catch (e) {
          console.error('[TikTok Service] Bad JSON message:', e);
        }
      });

      ws.on('error', (err) => {
        console.error('[TikTok Service] WS error:', err);
        safeStatus(false);
      });

      ws.on('close', () => {
        console.log('[TikTok Service] WebSocket closed');
        safeStatus(false);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 2000);
      });
    } catch (e) {
      console.error('[TikTok Service] Connect error:', e);
      safeStatus(false);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    }
  };

  connect();

  return {
    stop() {
      clearTimeout(reconnectTimer);
      if (ws) {
        try { ws.removeAllListeners(); ws.close(); } catch {}
        ws = null;
      }
    }
  };
}

module.exports = { startTikTok };
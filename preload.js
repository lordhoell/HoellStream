// preload.js
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Expose Electron APIs to the renderer process
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, callback) => {
      const subscription = (event, ...args) => callback(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  },
  // Expose auth module functions
  auth: {
    getTokens: () => ipcRenderer.invoke('get-tokens'),
    ensureTwitchToken: () => ipcRenderer.invoke('ensure-twitch-token'),
    ensureYouTubeToken: () => ipcRenderer.invoke('ensure-youtube-token'),
    getTwitchStreamInfo: () => ipcRenderer.invoke('get-twitch-stream-info'),
    getYouTubeStreamInfo: () => ipcRenderer.invoke('get-youtube-stream-info'),
    getYouTubeLiveChatId: () => ipcRenderer.invoke('get-youtube-live-chat-id')
  },
  // Expose config module functions
  config: {
    get: (key) => ipcRenderer.invoke('get-config', key),
    set: (key, value) => ipcRenderer.invoke('set-config', {key, value})
  },
  zoom: {
    getZoomFactor: () => webFrame.getZoomFactor(),
    setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
    zoomIn: () => webFrame.setZoomFactor(webFrame.getZoomFactor() * 1.1),
    zoomOut: () => webFrame.setZoomFactor(webFrame.getZoomFactor() / 1.1),
    reset: () => webFrame.setZoomFactor(1.0)
  }
});

// --- HoellStream minimal API surface (hs) ---
contextBridge.exposeInMainWorld('hs', (() => {
  const on = (channel, cb) => {
    const sub = (_ev, data) => { try { cb(data); } catch (e) { /* no-op */ } };
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  };
  return {
    config: {
      load: () => ipcRenderer.invoke('load-config'),
    },
    auth: {
      getTokens: () => ipcRenderer.invoke('get-tokens'),
    },
    providers: {
      youtube: {
        start: () => ipcRenderer.invoke('youtube-service-start'),
        stop: () => ipcRenderer.invoke('youtube-service-stop'),
        onStatus: (cb) => on('youtube-connection-status', cb),
        onData:   (cb) => on('youtube-data-update', cb),
      },
      twitch: {
        start: () => ipcRenderer.invoke('twitch-service-start'),
        stop: () => ipcRenderer.invoke('twitch-service-stop'),
        onStatus: (cb) => on('twitch-connection-status', cb),
        onData:   (cb) => on('twitch-data-update', cb),
      },
      tiktok: {
        onStatus: (cb) => on('tiktok-status', cb),
      },
    },
    events: {
      onOverlay: (cb) => on('overlay-event', cb),
    },
    ui: {
      onFontSizeUpdate:        (cb) => on('font-size-update', cb),
      onBackgroundColorUpdate: (cb) => on('background-color-update', cb),
      onEventsColorUpdate:     (cb) => on('events-color-update', cb),
      onPlatformVisibilityUpdate: (cb) => on('update-platform-visibility', cb),
    },
    stream: {
      emit: (eventData) => ipcRenderer.send('stream-event', eventData),
    },
    onReloadTokens: (cb) => on('reload-tokens', cb),
  };
})());

// Set up Ctrl+scroll wheel zoom handling
window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('wheel', (event) => {
    if (event.ctrlKey) {
      event.preventDefault();
      const currentZoom = webFrame.getZoomFactor();
      
      if (event.deltaY < 0) {
        // Zoom in (scroll up)
        webFrame.setZoomFactor(currentZoom * 1.1);
      } else {
        // Zoom out (scroll down)
        webFrame.setZoomFactor(currentZoom / 1.1);
      }
      
      // Notify main process about zoom change
      ipcRenderer.invoke('zoom-changed', webFrame.getZoomFactor());
    }
  }, { passive: false });
});

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

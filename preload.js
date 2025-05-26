// preload.js
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Expose Electron APIs to the renderer process
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, data) => ipcRenderer.invoke(channel, data)
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

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('banxing', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  onEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => {
      try { callback(data); } catch (error) { console.error('[bridge] event handler error', error); }
    };
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
});

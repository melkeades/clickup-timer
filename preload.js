const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('clickup', {
  toggleTimer: () => ipcRenderer.invoke('clickup:toggleTimer'),
  onStatus: (cb) => ipcRenderer.on('clickup:status', (_evt, payload) => cb(payload)),
})

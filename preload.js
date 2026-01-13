const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('clickup', {
  toggleTimer: () => ipcRenderer.invoke('clickup:toggleTimer'),
  getEntries: () => ipcRenderer.invoke('clickup:getEntries'),
  getCurrentEntry: () => ipcRenderer.invoke('clickup:getCurrentEntry'),
  startTask: (tid) => ipcRenderer.invoke('clickup:startTask', tid),
  stopTimer: () => ipcRenderer.invoke('clickup:stopTimer'),
  deleteEntry: (entryId) => ipcRenderer.invoke('clickup:deleteEntry', entryId),
  updateIndicators: (running) => ipcRenderer.invoke('clickup:updateIndicators', running),
  onStatus: (cb) => ipcRenderer.on('clickup:status', (_evt, payload) => cb(payload)),
})

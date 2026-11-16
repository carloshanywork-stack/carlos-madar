const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('madarDesktop', Object.freeze({
  platform: 'windows',
  getVersion: () => ipcRenderer.invoke('madar:desktop:version'),
  checkForUpdates: () => ipcRenderer.invoke('madar:desktop:check-updates'),
}));

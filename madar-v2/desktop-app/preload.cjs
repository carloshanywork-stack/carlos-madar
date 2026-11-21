const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('madarDesktop', Object.freeze({
  platform: 'windows',
  isLocalShell: true,
  getVersion: () => ipcRenderer.invoke('madar:desktop:version'),
  checkForUpdates: () => ipcRenderer.invoke('madar:desktop:check-updates'),
  getServerConfig: () => ipcRenderer.invoke('madar:desktop:get-server-config'),
  setServerConfig: (config) => ipcRenderer.invoke('madar:desktop:set-server-config', config),
  testServer: (url) => ipcRenderer.invoke('madar:desktop:test-server', url),
  openServerSettings: () => ipcRenderer.invoke('madar:desktop:open-server-settings'),
  reloadApp: () => ipcRenderer.invoke('madar:desktop:reload'),
  getPrinters: () => ipcRenderer.invoke('madar:desktop:get-printers'),
  printSilent: (options) => ipcRenderer.invoke('madar:desktop:print-silent', options),
  showNotification: (options) => ipcRenderer.invoke('madar:desktop:notification', options),
  downloadApk: (target) => ipcRenderer.invoke('madar:desktop:download-apk', target),
  getDiagnostics: () => ipcRenderer.invoke('madar:desktop:get-diagnostics'),
}));

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('puffDesktop', {
  copyImage: (data, mime) => ipcRenderer.invoke('copy-image', data, mime),
  saveFile: (data, name) => ipcRenderer.invoke('save-file', data, name),
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close'),
  info: () => ipcRenderer.invoke('app-info'),
  onQuickOpen: (callback) => { const listener = () => callback(); ipcRenderer.on('quick-open', listener); return () => ipcRenderer.removeListener('quick-open', listener); },
});

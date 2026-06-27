import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: () => ipcRenderer.invoke('platform'),
  version: () => ipcRenderer.invoke('version'),
  flashTray: () => ipcRenderer.send('flash-tray'),
  openQuickpick: (callback: () => void) => {
    ipcRenderer.on('open-quickpick', callback);
    return () => ipcRenderer.removeAllListeners('open-quickpick');
  },
});

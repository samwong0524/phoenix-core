/**
 * Preload script — 安全地将 Electron IPC 暴露给 React 渲染进程
 *
 * React 端通过 window.electronUpdate 接收更新事件:
 *   window.electronUpdate.onDownloading(({ version, progress }) => { ... })
 *   window.electronUpdate.onReady(({ version }) => { ... })
 *   window.electronUpdate.onError((msg) => { ... })
 *   window.electronUpdate.onUpdateAvailable(({ version }) => { ... })  // 运行中发现新版本，让用户选择
 *   window.electronUpdate.startDownload()  // 用户选择立即更新
 *   window.electronUpdate.restart()  // 触发 quitAndInstall
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronUpdate', {
  onDownloading: (cb) => ipcRenderer.on('update-downloading', (_e, data) => cb(data)),
  onReady: (cb) => ipcRenderer.on('update-ready', (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('update-error', (_e, msg) => cb(msg)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available-prompt', (_e, data) => cb(data)),
  startDownload: () => ipcRenderer.send('start-update-download'),
  restart: () => ipcRenderer.send('restart-for-update'),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  getMachineName: () => ipcRenderer.invoke('get-machine-name'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  saveFileToDisk: (dirPath, fileName, base64Data) => ipcRenderer.invoke('save-file-to-disk', { dirPath, fileName, base64Data }),
  openFolderPath: (dirPath) => ipcRenderer.invoke('open-folder-path', dirPath),
});

contextBridge.exposeInMainWorld('electronApp', {
  onCloseConfirm: (cb) => ipcRenderer.on('show-close-confirm', () => cb()),
  sendCloseConfirm: (confirmed) => ipcRenderer.send('close-confirm-response', confirmed),
});

contextBridge.exposeInMainWorld('electronGrok', {
  fetch: (options) => ipcRenderer.invoke('grok-fetch', options),
  download: (videoUrl) => ipcRenderer.invoke('grok-download', videoUrl),
  taskStatus: (taskId) => ipcRenderer.invoke('grok-task-status', taskId),
});

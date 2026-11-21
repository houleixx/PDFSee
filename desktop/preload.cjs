const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function invoke(channel, ...args) {
  const { value, error } = await ipcRenderer.invoke(channel, ...args);
  if (error) throw new Error(error);
  return value;
}

contextBridge.exposeInMainWorld('desktop', {
  pick: (kind, multi) => invoke('pick', kind, multi),
  drop: files => invoke('drop', files.map(file => webUtils.getPathForFile(file)).filter(Boolean)),
  read: (id, start, end) => invoke('read', id, start, end),
  release: id => invoke('release', id),
  execute: job => invoke('execute', job),
  saveImage: (name, bytes) => invoke('save-image', name, bytes),
  reveal: path => invoke('reveal', path),
  onFile: callback => ipcRenderer.on('system-file', (_event, file) => callback(file)),
  onError: callback => ipcRenderer.on('system-error', (_event, error) => callback(error)),
  onMenu: callback => ipcRenderer.on('menu', (_event, command) => callback(command)),
  ready: () => invoke('ready')
});

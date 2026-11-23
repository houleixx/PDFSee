const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function invoke(channel, ...args) {
  const { value, error } = await ipcRenderer.invoke(channel, ...args);
  if (error) throw new Error(error);
  return value;
}

contextBridge.exposeInMainWorld('desktop', {
  setToolSidebarHidden: hidden => invoke('set-tool-sidebar-hidden', hidden),
  openFeedback: () => invoke('open-feedback'),
  canRecognizePages: process.platform === 'darwin',
  recognizePage: bytes => invoke('recognize-page', bytes),
  printDocument: () => invoke('print-document'),
  pick: (kind, multi) => invoke('pick', kind, multi),
  drop: files => invoke('drop', files.map(file => webUtils.getPathForFile(file)).filter(Boolean)),
  read: (id, start, end) => invoke('read', id, start, end),
  release: id => invoke('release', id),
  execute: job => invoke('execute', job),
  saveImage: (name, bytes) => invoke('save-image', name, bytes),
  beginImages: (id, spec, count, format) => invoke('begin-images', id, spec, count, format),
  writeImage: (token, value, width, height) => invoke('write-image', token, value, width, height),
  finishImages: token => invoke('finish-images', token),
  cancelImages: token => invoke('cancel-images', token),
  reveal: path => invoke('reveal', path),
  onFile: callback => ipcRenderer.on('system-file', (_event, file) => callback(file)),
  onError: callback => ipcRenderer.on('system-error', (_event, error) => callback(error)),
  answerUpdatePrompt: (id, choice) => invoke('answer-update-prompt', id, choice),
  onUpdatePrompt: callback => ipcRenderer.on('update-prompt', (_event, prompt) => callback(prompt)),
  onUpdateProgress: callback => ipcRenderer.on('update-progress', (_event, progress) => callback(progress)),
  onMenu: callback => ipcRenderer.on('menu', (_event, command) => callback(command)),
  ready: () => invoke('ready')
});

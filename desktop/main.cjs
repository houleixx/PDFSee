const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, screen, shell, utilityProcess } = require('electron');
const { readFileSync, renameSync, writeFileSync } = require('node:fs');
const { copyFile, mkdtemp, open, readFile, rename, rm, stat, writeFile } = require('node:fs/promises');
const { basename, dirname, extname, join, resolve, sep } = require('node:path');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { imagePages, createImageExport, createFormatExport } = require('./image-export.cjs');
const { extensions: exportExtensions } = require('./pdf-formats.cjs');
const { findOffice } = require('./office.cjs');
const { findInstaller, downloadInstaller } = require('./office-download.cjs');
const { createUpdater } = require('./updates.cjs');
const translations = require('./translations.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'pdfsee', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true
} }]);

const types = {
  pdf: ['pdf'], image: ['jpg', 'jpeg', 'png'],
  office: ['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'rtf', 'txt']
};
const labels = { pdf: 'PDF', image: '图片', office: '文档' };
const registered = new Map();
const outputs = new Set();
const pending = [];
const ready = new Set();
const dist = resolve(__dirname, '../dist');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm'
};
let window;
let language = 'zh-CN';
const languages = { 'zh-CN': '简体中文', en: 'English' };
const t = source => language === 'en' && Object.hasOwn(translations, source) ? translations[source] : source;
const languagePath = () => join(app.getPath('userData'), 'language');

function readLanguage() {
  try {
    const saved = readFileSync(languagePath(), 'utf8').trim();
    if (Object.hasOwn(languages, saved)) return saved;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(error.message);
  }
  const locale = app.getPreferredSystemLanguages()[0] ?? app.getLocale();
  return /^zh(?:-|$)/i.test(locale) ? 'zh-CN' : 'en';
}

function setLanguage(next) {
  try {
    const path = languagePath();
    writeFileSync(`${path}.tmp`, next, 'utf8');
    renameSync(`${path}.tmp`, path);
    language = next;
    window?.webContents.send('language', next);
  } catch (error) {
    console.warn(error.message);
    void dialog.showMessageBox({
      type: 'error', message: t('无法保存语言偏好。'), buttons: [t('确定')]
    });
  }
  installMenu();
}

const appearanceLabels = { system: '跟随系统', light: '浅色', dark: '深色' };
const appearancePath = () => join(app.getPath('userData'), 'appearance');
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#18191b' : '#fafaf9';

function readAppearance() {
  try {
    const saved = readFileSync(appearancePath(), 'utf8').trim();
    if (Object.hasOwn(appearanceLabels, saved)) return saved;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(error.message);
  }
  return 'system';
}

function setAppearance(next) {
  try {
    const path = appearancePath();
    writeFileSync(`${path}.tmp`, next, 'utf8');
    renameSync(`${path}.tmp`, path);
    nativeTheme.themeSource = next;
  } catch (error) {
    console.warn(error.message);
    void dialog.showMessageBox({
      type: 'error', message: t('无法保存外观偏好。'), buttons: [t('确定')]
    });
  }
  installMenu();
}

let busy = false;
let imageExport = null;
let updateProgress = null;
let updatePrompt = null;
let startupUpdateChecked = false;
let startupUpdateTimer;
const checkForUpdates = createUpdater({
  app, show: showUpdatePrompt, shell, net, getWindow: () => window,
  onProgress: progress => {
    updateProgress = progress;
    if (window && ready.has(window.webContents.id)) window.webContents.send('update-progress', progress);
  },
  beginInstall: () => {
    if (busy) return false;
    busy = true;
    return true;
  },
  endInstall: () => { busy = false; }
});

function showUpdatePrompt(options) {
  const target = window?.webContents;
  if (!target || target.isDestroyed()) return Promise.resolve(options.cancelId ?? 0);
  return new Promise(resolve => {
    const prompt = { id: randomUUID(), ...options };
    updatePrompt = { owner: target.id, prompt, resolve };
    if (ready.has(target.id)) target.send('update-prompt', prompt);
  });
}

function finishUpdatePrompt(owner, choice) {
  if (updatePrompt?.owner !== owner) return;
  const { prompt, resolve } = updatePrompt;
  updatePrompt = null;
  resolve(choice ?? prompt.cancelId ?? 0);
}

async function cancelImages() {
  const active = imageExport;
  if (!active) return;
  imageExport = null;
  try { await active.session.cancel(); }
  finally { busy = false; }
}

function getImageExport(owner, token) {
  if (!imageExport || imageExport.owner !== owner || imageExport.token !== token) {
    throw new Error('图片导出任务已结束，请重新导出。');
  }
  return imageExport.session;
}

function kindOf(path) {
  const extension = extname(path).slice(1).toLowerCase();
  return Object.keys(types).find(kind => types[kind].includes(extension));
}

async function register(path, owner) {
  const kind = kindOf(path);
  if (!kind) throw new Error('文件格式不受支持。');
  const info = await stat(path);
  if (!info.isFile() || !info.size) throw new Error('文件为空，或无法打开。');
  const id = randomUUID();
  registered.set(id, { path, owner, kind, size: info.size });
  return { id, kind, size: info.size, name: basename(path) };
}

async function releaseFile(owner, id) {
  const file = registered.get(id);
  if (file?.owner !== owner) return;
  registered.delete(id);
  if (file.temporary) await rm(file.temporary, { recursive: true, force: true });
}

function getFile(id, owner, kind) {
  const file = registered.get(id);
  if (!file || file.owner !== owner || (kind && file.kind !== kind)) throw new Error('请重新选择文件。');
  return file;
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (event.sender !== window?.webContents || event.senderFrame?.url !== 'pdfsee://app/index.html') {
        throw new Error('无法执行此操作。');
      }
      return { value: await callback(event.sender.id, ...args) };
    } catch (error) {
      if (!error.code) return { error: error.message };
      return { error: '无法读取或写入文件，请检查文件是否仍在原位置以及目录权限。' };
    }
  });
}

handle('recognize-page', (_owner, bytes) => {
  if (process.platform !== 'darwin' || !(bytes instanceof Uint8Array) || bytes.length > 20 * 1024 * 1024) {
    throw new Error('无法识别此页面。');
  }
  const binary = join(app.isPackaged ? process.resourcesPath : dist, 'pdfsee-ocr');
  return new Promise((resolve, reject) => {
    const child = execFile(binary, { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error('页面文字识别失败。'));
        return;
      }
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error('无法读取文字识别结果。')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
});

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = utilityProcess.fork(join(__dirname, 'jobs.cjs'), [], { serviceName: 'PDFSee 文档处理' });
    worker.once('message', ({ value, error }) => {
      worker.kill();
      if (error) reject(new Error(error));
      else resolve(value);
    });
    worker.once('error', () => reject(new Error('PDF 处理进程发生错误。')));
    worker.once('exit', () => reject(new Error('PDF 处理已提前结束。')));
    worker.once('spawn', () => worker.postMessage(payload));
  });
}

async function chooseOutput(defaultPath, extension = 'pdf') {
  const result = await dialog.showSaveDialog(window, {
    defaultPath, filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  });
  return result.canceled ? null : result.filePath;
}

async function ensureDifferent(path, sources) {
  const key = value => process.platform === 'linux' ? resolve(value) : resolve(value).toLowerCase();
  let destination;
  try { destination = await stat(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const source of sources) {
    const origin = await stat(source);
    if (key(path) === key(source) || (destination && origin.dev === destination.dev && origin.ino === destination.ino)) {
      throw new Error('请选择与源文件不同的保存位置。');
    }
  }
}

async function saveAtomically(path, write) {
  const directory = await mkdtemp(join(dirname(path), '.pdfsee-'));
  try {
    const temporary = join(directory, 'output');
    await write(temporary);
    await rename(temporary, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function offerOfficeDownload() {
  const target = window;
  const { response } = await dialog.showMessageBox(target, {
    type: 'info', message: t('文档转 PDF 需要 LibreOffice'),
    detail: t('PDFSee 可以下载适用于这台电脑的官方安装包。下载后安装 LibreOffice，再回来转换文档。'),
    buttons: [t('下载安装包'), t('稍后')], defaultId: 0, cancelId: 1
  });
  if (response !== 0 || target.isDestroyed()) return { message: '安装 LibreOffice 后即可转换文档。' };
  const fetch = (url, options) => net.fetch(url, options);
  const arch = process.platform === 'darwin' && app.runningUnderARM64Translation ? 'arm64' : process.arch;
  target.setProgressBar(2);
  try {
    const installer = await findInstaller(fetch, process.platform, arch);
    if (target.isDestroyed()) return null;
    const path = await chooseOutput(join(app.getPath('downloads'), installer.name), extname(installer.name).slice(1));
    if (!path) return { message: '已取消下载。' };
    let percent = -1;
    await saveAtomically(path, temporary => downloadInstaller(fetch, installer, temporary, progress => {
      const next = Math.floor(progress * 100);
      if (next !== percent && !target.isDestroyed()) {
        percent = next;
        target.setProgressBar(progress);
      }
    }));
    outputs.add(path);
    return { name: basename(path), location: path, message: 'LibreOffice 已下载。请打开安装包，安装后重新转换。' };
  } finally {
    if (!target.isDestroyed()) target.setProgressBar(-1);
  }
}

async function execute(owner, job) {
  if (busy) throw new Error('正在处理另一个任务，请稍后再试。');
  busy = true;
  try {
    const kinds = { merge: 'pdf', split: 'pdf', extract: 'pdf', organize: 'pdf', image: 'image', office: 'office' };
    if (!Object.hasOwn(kinds, job?.mode) || !Array.isArray(job.ids) || !job.ids.length || job.ids.length > 300) {
      throw new Error('请选择要处理的文件。');
    }
    if (job.mode === 'merge' && job.ids.length < 2) throw new Error('请至少添加两份 PDF。');
    if (!['merge', 'image'].includes(job.mode) && job.ids.length !== 1) throw new Error('请选择一份文件。');
    const files = job.ids.map(id => getFile(id, owner, kinds[job.mode]));
    const paths = files.map(file => file.path);
    const first = files[0].sources?.[0] ?? paths[0];
    const stem = basename(first, extname(first));
    const { mode } = job;
    const office = mode === 'office' ? await findOffice() : null;
    if (mode === 'office' && !office) return await offerOfficeDownload();
    const spec = typeof job.spec === 'string' ? job.spec.slice(0, 30000) : '';
    const rotation = [0, 90, 180, 270].includes(job.rotation) ? job.rotation : 0;
    const paper = ['original', 'a4', 'letter'].includes(job.paper) ? job.paper : 'original';
    const groupSize = Number(job.groupSize);
    if (mode === 'split') {
      if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 10000) throw new Error('每份页数应在 1 至 10000 之间。');
      const result = await dialog.showOpenDialog(window, { title: t('选择拆分导出目录'), properties: ['openDirectory', 'createDirectory'], defaultPath: dirname(first) });
      if (result.canceled) return null;
      const directory = await mkdtemp(join(result.filePaths[0], `${stem.slice(0, 65)}-拆分-`));
      try {
        const count = await runWorker({ mode, paths, spec, groupSize, directory });
        outputs.add(directory);
        return { name: basename(directory), location: directory, count };
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    }
    const suffix = { merge: '-合并', extract: '-提取', organize: '-整理', image: '-图片', office: '' }[mode];
    const path = await chooseOutput(join(dirname(first), `${stem}${suffix}.pdf`));
    if (!path) return null;
    await ensureDifferent(path, files.flatMap(file => file.sources ?? [file.path]));
    await saveAtomically(path, outputPath => runWorker({ mode, paths, spec, rotation, paper, office, outputPath }));
    outputs.add(path);
    return { name: basename(path), location: path };
  } finally {
    busy = false;
  }
}

const toolSidebarPreference = () => join(app.getPath('userData'), 'tool-sidebar');
function isToolSidebarHidden() {
  try {
    return readFileSync(toolSidebarPreference(), 'utf8') === 'hidden';
  } catch {
    return false;
  }
}
handle('set-tool-sidebar-hidden', (_owner, hidden) => {
  if (typeof hidden !== 'boolean') throw new Error('无效的工具栏状态。');
  const path = toolSidebarPreference();
  const temporary = path + '.tmp';
  writeFileSync(temporary, hidden ? 'hidden' : 'visible');
  renameSync(temporary, path);
});

handle('open-feedback', () => shell.openExternal('https://pdfsee.pages.dev/feedback'));

handle('print-document', owner => {
  const contents = window?.webContents;
  if (contents?.id !== owner) throw new Error('打印窗口已关闭。');
  return new Promise((resolve, reject) => {
    contents.print({ printBackground: true, margins: { marginType: 'none' } }, (success, reason) => {
      if (success) resolve(true);
      else if (/cancel/i.test(reason)) resolve(false);
      else reject(new Error(reason ? `打印失败：${reason}` : '无法打印，请检查系统打印机设置。'));
    });
  });
});

handle('pick', async (owner, kind, multi) => {
  if (!Object.hasOwn(types, kind)) throw new Error('不支持该格式。');
  const result = await dialog.showOpenDialog(window, {
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: t(labels[kind]), extensions: types[kind] }]
  });
  return Promise.all(result.filePaths.map(path => register(path, owner)));
});
handle('drop', async (owner, paths) => {
  const supported = paths.slice(0, 300).filter(kindOf);
  if (!supported.length) throw new Error('拖入的文件格式不受支持。');
  return Promise.all(supported.map(path => register(path, owner)));
});
handle('release', releaseFile);
handle('page-menu', (owner, id, canDelete) => {
  getFile(id, owner, 'pdf');
  return new Promise(resolve => {
    const menu = Menu.buildFromTemplate([
      { label: t('在此页前插入 PDF…'), click: () => resolve('before') },
      { label: t('在此页后插入 PDF…'), click: () => resolve('after') },
      { type: 'separator' },
      { label: t('删除此页'), enabled: canDelete === true, click: () => resolve('delete') }
    ]);
    menu.popup({ window, callback: () => resolve(null) });
  });
});
handle('edit-pages', async (owner, id, edit) => {
  const source = getFile(id, owner, 'pdf');
  const { action, ids } = edit ?? {};
  if (!['insert', 'move', 'delete'].includes(action) || !Array.isArray(ids) || ids.length > 300 ||
      (action === 'insert' ? !ids.length : ids.length)) throw new Error('页面操作无效。');
  const attachments = ids.map(id => getFile(id, owner));
  if (attachments.some(file => file.kind !== 'pdf' && file.kind !== 'image')) {
    throw new Error('仅支持插入 PDF、JPG、JPEG 或 PNG 文件。');
  }
  const files = [source, ...attachments];
  const sources = [...new Set(files.flatMap(file => file.sources ?? [file.path]))];
  const temporary = await mkdtemp(join(app.getPath('temp'), 'pdfsee-pages-'));
  try {
    const outputPath = join(temporary, basename(sources[0]));
    await runWorker({ mode: 'edit-pages', paths: files.map(file => file.path), edit, outputPath });
    if (window?.webContents.id !== owner) throw new Error('文档窗口已关闭。');
    const info = await register(outputPath, owner);
    Object.assign(getFile(info.id, owner, 'pdf'), { temporary, sources });
    return info;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
});
handle('save-edited-pdf', async (owner, id) => {
  const file = getFile(id, owner, 'pdf');
  if (!file.sources) throw new Error('没有页面改动可导出。');
  const source = file.sources[0];
  const path = await chooseOutput(join(dirname(source), `${basename(source, extname(source))}-整理.pdf`));
  if (!path) return null;
  await ensureDifferent(path, file.sources);
  await saveAtomically(path, temporary => copyFile(file.path, temporary));
  outputs.add(path);
  return { name: basename(path), location: path };
});
handle('read', async (owner, id, start, end) => {
  const file = getFile(id, owner, 'pdf');
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
      end <= start || end > file.size || end - start > 64 * 1024 * 1024) throw new Error('读取范围无效。');
  const fd = await open(file.path, 'r');
  try {
    const bytes = new Uint8Array(end - start);
    let total = 0;
    while (total < bytes.length) {
      const result = await fd.read(bytes, total, bytes.length - total, start + total);
      if (!result.bytesRead) throw new Error('文件在读取期间发生变化，请重新打开。');
      total += result.bytesRead;
    }
    return bytes;
  } finally { await fd.close(); }
});
handle('execute', execute);
handle('begin-images', async (owner, id, spec, count, format = 'pages') => {
  if (busy) throw new Error('正在处理另一个任务，请稍后再试。');
  const file = getFile(id, owner, 'pdf');
  const pages = imagePages(spec, count);
  busy = true;
  try {
    let session;
    const stem = basename(file.path, extname(file.path));
    if (format === 'pages') {
      const result = await dialog.showOpenDialog(window, {
        title: t('选择图片导出目录'), properties: ['openDirectory', 'createDirectory'], defaultPath: dirname(file.sources?.[0] ?? file.path)
      });
      if (result.canceled || !window || window.webContents.id !== owner) { busy = false; return null; }
      session = await createImageExport(result.filePaths[0], stem, pages);
    } else {
      if (!Object.hasOwn(exportExtensions, format)) throw new Error('不支持的转换格式。');
      const extension = exportExtensions[format];
      const suffix = { long: '-长图', flat: '-纯图', pptx: '', docx: '' }[format];
      const path = await chooseOutput(join(dirname(file.sources?.[0] ?? file.path), `${stem}${suffix}.${extension}`), extension);
      if (!path || !window || window.webContents.id !== owner) { busy = false; return null; }
      await ensureDifferent(path, file.sources ?? [file.path]);
      session = await createFormatExport(path, format, pages.length, (entries, closed) =>
        saveAtomically(path, async outputPath => {
          await runWorker({ mode: 'pdf-format', format, pages: entries, outputPath });
          if (closed()) throw new Error('转换已取消。');
        }));
    }
    if (!window || window.webContents.id !== owner) {
      await session.cancel();
      busy = false;
      return null;
    }
    const token = randomUUID();
    imageExport = { token, owner, session };
    return { token, pages };
  } catch (error) { busy = false; throw error; }
});
handle('write-image', async (owner, token, value, width, height) => getImageExport(owner, token).append(value, width, height));
handle('finish-images', async (owner, token) => {
  const active = imageExport;
  const session = getImageExport(owner, token);
  let finished = false;
  try {
    const result = await session.finish();
    finished = true;
    outputs.add(result.location);
    return result;
  } finally {
    if (imageExport === active) {
      if (!finished) await session.cancel().catch(console.error);
      if (imageExport === active) {
        imageExport = null;
        busy = false;
      }
    }
  }
});
handle('cancel-images', async (owner, token) => {
  getImageExport(owner, token);
  await cancelImages();
});
handle('save-image', async (_owner, name, bytes) => {
  if (typeof name !== 'string' || !(bytes instanceof Uint8Array) || bytes.length > 100 * 1024 * 1024) throw new Error('图像过大，无法导出。');
  const path = await chooseOutput(basename(name).replaceAll(/[:*?"<>|]/g, '_'), 'png');
  if (!path) return null;
  await saveAtomically(path, temporary => writeFile(temporary, bytes));
  outputs.add(path);
  return { name: basename(path), location: path };
});
handle('reveal', (_owner, path) => {
  if (outputs.has(path)) shell.showItemInFolder(path);
});

async function openFromSystem(path) {
  if (kindOf(path) !== 'pdf') return;
  if (!window || !ready.has(window.webContents.id)) {
    pending.push(path);
    return;
  }
  const target = window.webContents;
  try {
    const file = await register(path, target.id);
    if (!target.isDestroyed()) target.send('system-file', file);
  } catch (error) {
    if (!target.isDestroyed()) target.send('system-error', error.message);
  }
}
handle('answer-update-prompt', (owner, id, choice) => {
  if (updatePrompt?.owner !== owner || updatePrompt.prompt.id !== id) return;
  const count = updatePrompt.prompt.buttons?.length ?? 1;
  if (Number.isInteger(choice) && choice >= 0 && choice < count) finishUpdatePrompt(owner, choice);
});

handle('get-language', () => language);

handle('ready', owner => {
  ready.add(owner);
  if (updateProgress) window.webContents.send('update-progress', updateProgress);
  if (updatePrompt?.owner === owner) window.webContents.send('update-prompt', updatePrompt.prompt);
  if (!startupUpdateChecked && ['darwin', 'win32'].includes(process.platform)) {
    startupUpdateChecked = true;
    startupUpdateTimer = setTimeout(() => { if (window) void checkForUpdates({ automatic: true }); }, 1500).unref();
  }
  for (const path of new Set(pending.splice(0))) void openFromSystem(path);
});

app.on('open-file', (event, path) => {
  event.preventDefault();
  if (app.isReady() && !window) createWindow();
  void openFromSystem(path);
});

function restoreWindowPosition(path, width, height) {
  try {
    const { x, y } = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return {};
    const { workArea } = screen.getDisplayMatching({ x, y, width, height });
    return {
      x: Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width)),
      y: Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height))
    };
  } catch {
    return {};
  }
}

function createWindow() {
  const width = 1100;
  const height = 820;
  const positionPath = join(app.getPath('userData'), 'window-position.json');
  const mainWindow = new BrowserWindow({
    width, height, minWidth: 740, minHeight: 570,
    ...restoreWindowPosition(positionPath, width, height),
    title: 'PDFSee', backgroundColor: windowBackground(),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  window = mainWindow;
  mainWindow.on('close', () => {
    const { x, y } = mainWindow.getNormalBounds();
    try {
      const temporary = positionPath + '.tmp';
      writeFileSync(temporary, JSON.stringify({ x, y }));
      renameSync(temporary, positionPath);
    } catch (error) {
      console.warn('无法保存窗口位置', error.code ?? error.message);
    }
  });
  const owner = window.webContents.id;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('render-process-gone', () => {
    ready.delete(owner);
    finishUpdatePrompt(owner);
    void cancelImages().catch(() => {});
  });
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question', message: t('页面改动尚未另存。要放弃改动吗？'),
      buttons: [t('继续编辑'), t('放弃改动')], defaultId: 0, cancelId: 0
    });
    if (choice === 1) event.preventDefault();
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  void window.loadURL('pdfsee://app/index.html');
  window.on('closed', () => {
    finishUpdatePrompt(owner);
    void cancelImages().catch(() => {});
    ready.delete(owner);
    for (const id of registered.keys()) void releaseFile(owner, id).catch(() => {});
    window = null;
  });
}

function installMenu() {
  const send = command => () => window?.webContents.send('menu', command);
  const updateItem = { label: t('检查更新…'), click: () => {
    startupUpdateChecked = true;
    clearTimeout(startupUpdateTimer);
    if (!window) createWindow();
    void checkForUpdates();
  } };
  const languageItem = {
    label: t('语言'),
    submenu: Object.entries(languages).map(([value, label]) => ({
      label, type: 'radio', checked: language === value, click: () => setLanguage(value)
    }))
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [
      { role: 'about', label: t('关于 PDFSee') }, updateItem, languageItem, { type: 'separator' },
      { role: 'services', label: t('服务') }, { type: 'separator' },
      { role: 'hide', label: t('隐藏 PDFSee') }, { role: 'hideOthers', label: t('隐藏其他应用') }, { role: 'unhide', label: t('显示全部') },
      { type: 'separator' }, { role: 'quit', label: t('退出 PDFSee') }
    ] }] : []),
    { label: t('文件'), submenu: [
      { label: t('打开 PDF…'), accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: t('打印…'), accelerator: 'CmdOrCtrl+P', click: send('print') },
      { label: t('关闭文档'), accelerator: 'CmdOrCtrl+Shift+W', click: send('close') },
      { role: 'close', label: t('关闭窗口') },
      { type: 'separator' },
      ...(process.platform === 'win32' ? [languageItem] : []),
      { role: 'quit', label: t('退出') }
    ] },
    { label: t('编辑'), submenu: [{ role: 'copy', label: t('复制') }, { role: 'selectAll', label: t('全选') },
      { label: t('在 PDF 中查找'), accelerator: 'CmdOrCtrl+F', click: send('find') }] },
    { label: t('视图'), submenu: [{
      label: t('外观'),
      submenu: Object.entries(appearanceLabels).map(([value, label]) => ({
        label: t(label), type: 'radio', checked: nativeTheme.themeSource === value,
        click: () => setAppearance(value)
      }))
    }] },
    { label: t('窗口'), submenu: [{ role: 'minimize', label: t('最小化') }, { role: 'togglefullscreen', label: t('全屏') }] },
    ...(process.platform === 'win32' ? [{ label: t('帮助'), submenu: [updateItem] }] : [])
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!window && app.isReady()) createWindow();
    if (window?.isMinimized()) window.restore();
    window?.focus();
    for (const file of argv.slice(1)) void openFromSystem(file);
  });
  app.whenReady().then(() => {
    protocol.handle('pdfsee', async request => {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || request.method !== 'GET') return new Response(null, { status: 404 });
      try {
        const file = resolve(dist, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(dist + sep)) return new Response(null, { status: 404 });
        const data = await readFile(file);
        const mime = mimeTypes[extname(file)] ?? 'application/octet-stream';
        // Set the sidebar state in the initial HTML, before the first layout.
        const body = file === join(dist, 'index.html') && isToolSidebarHidden()
          ? data.toString('utf8').replace('<aside id="tool-sidebar"', '<aside hidden id="tool-sidebar"')
          : data;
        return new Response(body, { headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' } });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    language = readLanguage();
    nativeTheme.themeSource = readAppearance();
    nativeTheme.on('updated', () => window?.setBackgroundColor(windowBackground()));
    installMenu();
    createWindow();
    for (const file of process.argv.slice(app.isPackaged ? 1 : 2)) void openFromSystem(file);
    app.on('activate', () => { if (!window) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}

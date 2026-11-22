const { execFile, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { constants, createWriteStream } = require('node:fs');
const { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const run = promisify(execFile);
const repository = 'houleixx/PDFSee';
const releaseOrigin = 'https://github.com';
const latestRelease = `https://api.github.com/repos/${repository}/releases/latest`;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function newerVersion(tag, currentVersion) {
  if (typeof tag !== 'string' || !tag.startsWith('v') ||
      !versionPattern.test(tag.slice(1)) || !versionPattern.test(currentVersion)) return null;
  const version = tag.slice(1);
  const current = currentVersion.split('.').map(BigInt);
  const next = version.split('.').map(BigInt);
  const changed = next.findIndex((value, index) => value !== current[index]);
  return changed !== -1 && next[changed] > current[changed] ? version : null;
}

function installerNames(version, platform, arch) {
  if (platform === 'darwin') {
    return [
      `PDFSee-macos-${version}.dmg`, `PDFSee-${version}-universal.dmg`,
      `PDFSee-macos-${version}-${arch}.dmg`, `PDFSee-${version}-${arch}.dmg`
    ];
  }
  if (platform === 'win32' && ['x64', 'arm64'].includes(arch)) return [`PDFSee-windows-${version}.exe`];
  return [];
}

function releaseFile(version, name) {
  return `${releaseOrigin}/${repository}/releases/download/v${version}/${name}`;
}

function selectUpdate(release, currentVersion, platform, arch) {
  if (release.draft || release.prerelease) return null;
  const version = newerVersion(release.tag_name, currentVersion);
  if (!version) return null;

  for (const name of installerNames(version, platform, arch)) {
    const url = releaseFile(version, name);
    const asset = release.assets?.find(item => item.name === name && item.browser_download_url === url);
    if (asset && Number.isSafeInteger(asset.size) && asset.size > 0) {
      return { version, name, url, size: asset.size, digest: asset.digest };
    }
  }
  throw new Error(`GitHub 上的 ${version} 版没有适用于这台电脑的安装包。`);
}

function readRedirect(net, url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'manual' });
    request.setHeader('Cache-Control', 'no-cache');
    const timer = setTimeout(() => {
      reject(new Error('GitHub 版本查询超时。'));
      request.abort();
    }, 15000);
    request.once('close', () => clearTimeout(timer));
    request.once('error', reject);
    request.once('response', () => {
      reject(new Error('GitHub 没有返回最新正式版本的地址。'));
      request.abort();
    });
    request.once('redirect', (_status, _method, location) => {
      resolve(location);
      request.abort();
    });
    request.end();
  });
}

async function findUpdate(fetchRelease, currentVersion, platform, arch, getRedirect) {
  const options = { signal: AbortSignal.timeout(15000), cache: 'no-store' };
  const response = await fetchRelease(latestRelease, {
    ...options, headers: { Accept: 'application/vnd.github+json' }
  });
  if (response.ok) return selectUpdate(await response.json(), currentVersion, platform, arch);
  if (response.status === 404) throw new Error('GitHub 暂无可访问的正式版本。');
  if (![403, 429].includes(response.status)) throw new Error(`GitHub 返回 HTTP ${response.status}。`);

  // The public API is rate limited. The latest release page and published checksum
  // file let us identify and verify the same release without API access.
  await response.body?.cancel();
  const location = await getRedirect(`${releaseOrigin}/${repository}/releases/latest`);
  const prefix = `${releaseOrigin}/${repository}/releases/tag/`;
  const tag = location.startsWith(prefix) && location.slice(prefix.length);
  if (typeof tag !== 'string' || !tag.startsWith('v') || !versionPattern.test(tag.slice(1))) {
    throw new Error('GitHub 暂时限制了版本查询，请稍后再试。');
  }
  const version = newerVersion(tag, currentVersion);
  if (!version) return null;

  const checksums = await fetchRelease(releaseFile(version, 'SHA256SUMS.txt'), options);
  if (!checksums.ok) throw new Error('暂时无法获取新版安装包的校验信息。');
  const entries = (await checksums.text()).split(/\r?\n/)
    .map(line => line.match(/^([a-f0-9]{64}) [ *]([^/\\]+)$/));
  for (const name of installerNames(version, platform, arch)) {
    const entry = entries.find(item => item?.[2] === name);
    if (entry) return { version, name, url: releaseFile(version, name), digest: `sha256:${entry[1]}` };
  }
  throw new Error(`GitHub 上的 ${version} 版没有适用于这台电脑的安装包。`);
}

async function downloadUpdate(update, path, progress, fetchRelease = fetch) {
  const response = await fetchRelease(update.url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）。`);
  const size = update.size ?? (Number(response.headers.get('content-length')) || null);
  const hash = createHash('sha256');
  let length = 0;
  const count = new Transform({
    transform(chunk, _encoding, done) {
      length += chunk.length;
      if (size && length > size) return done(new Error('安装包大小与 GitHub 发布记录不符。'));
      hash.update(chunk);
      if (size) progress(length / size);
      done(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), count, createWriteStream(path, { flags: 'wx', mode: 0o700 }));
  const digest = `sha256:${hash.digest('hex')}`;
  if ((size && length !== size) || (update.digest && digest !== update.digest)) {
    throw new Error('安装包校验失败，请重新下载。');
  }
}

async function prepareMacUpdate(dmg, version) {
  const target = await realpath(resolve(process.execPath, '../../..'));
  const { stderr } = await run('/usr/bin/codesign', ['-dv', '--verbose=4', target]);
  const team = stderr.match(/^TeamIdentifier=([A-Z0-9]{10})$/m)?.[1];
  if (!team || !target.endsWith('.app')) return false;
  const parent = dirname(target);
  try { await access(parent, constants.W_OK); }
  catch { return false; }
  if (parent.startsWith('/Volumes/') || parent.includes('/AppTranslocation/')) return false;

  const requirement = '=anchor apple generic and identifier "com.pdfsee.desktop" ' +
    `and certificate leaf[subject.OU] = "${team}" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`;
  const stage = await mkdtemp(join(parent, '.pdfsee-update-'));
  let handedOff = false;
  try {
    const mount = await mkdtemp(join(tmpdir(), 'pdfsee-mount-'));
    let mounted = false;
    try {
      await run('/usr/bin/hdiutil', ['verify', dmg]);
      await run('/usr/bin/hdiutil', ['attach', dmg, '-mountpoint', mount, '-readonly', '-nobrowse']);
      mounted = true;
      const source = join(mount, 'PDFSee.app');
      const signature = ['--verify', '--deep', '--strict', '--test-requirement', requirement];
      await run('/usr/bin/codesign', [...signature, source]);
      const { stdout } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString',
        join(source, 'Contents/Info.plist')]);
      if (stdout.trim() !== version) throw new Error('安装包内的版本与 GitHub 发布记录不符。');
      const staged = join(stage, basename(source));
      await run('/usr/bin/ditto', [source, staged]);
      await run('/usr/bin/codesign', [...signature, staged]);
      await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', staged]);
    } finally {
      if (mounted) await run('/usr/bin/hdiutil', ['detach', mount]);
      await rm(mount, { recursive: true, force: true });
    }

    const helper = join(stage, 'install.sh');
    await writeFile(helper, await readFile(join(__dirname, 'update-install.sh')));
    const child = spawn('/bin/bash', [helper, stage, target, String(process.pid)], {
      detached: true, stdio: 'ignore'
    });
    await new Promise((resolveSpawn, reject) => {
      child.once('spawn', resolveSpawn);
      child.once('error', reject);
    });
    child.unref();
    handedOff = true;
    return true;
  } finally {
    if (!handedOff) await rm(stage, { recursive: true, force: true });
  }
}

function createUpdater({ app, dialog, shell, net, getWindow, beginInstall, endInstall }) {
  const fetchRelease = (url, options) => net.fetch(url, options);
  let inProgress = false;
  const show = options => {
    const window = getWindow();
    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  };

  return async function checkForUpdates() {
    if (inProgress) return;
    inProgress = true;
    let directory;
    let keepDownload = false;
    let downloading = false;
    let installing = false;
    try {
      const arch = process.platform === 'darwin' && app.runningUnderARM64Translation ? 'arm64' : process.arch;
      const update = await findUpdate(fetchRelease, app.getVersion(), process.platform, arch, url => readRedirect(net, url));
      if (!update) {
        await show({ type: 'info', message: `当前已是最新版本（${app.getVersion()}）。` });
        return;
      }
      const { response: choice } = await show({
        type: 'info', message: `发现 PDFSee ${update.version}`,
        detail: `当前版本为 ${app.getVersion()}。下载安装时，PDFSee 可能会退出。`,
        buttons: ['下载并安装', '稍后'], defaultId: 0, cancelId: 1
      });
      if (choice !== 0) return;

      const root = join(app.getPath('userData'), 'updates');
      await mkdir(root, { recursive: true });
      directory = await mkdtemp(join(root, 'download-'));
      const path = join(directory, update.name);
      downloading = true;
      getWindow()?.setProgressBar(2);
      let percent = -1;
      await downloadUpdate(update, path, progress => {
        const next = Math.floor(progress * 100);
        if (next !== percent) {
          percent = next;
          getWindow()?.setProgressBar(progress);
        }
      }, fetchRelease);

      installing = beginInstall();
      if (!installing) {
        keepDownload = true;
        await show({ type: 'info', message: '更新已下载，文档任务仍在运行。',
          detail: '请在任务完成后打开下载的安装包。' });
        shell.showItemInFolder(path);
        return;
      }
      if (process.platform === 'darwin' && app.isPackaged && await prepareMacUpdate(path, update.version)) {
        await rm(directory, { recursive: true, force: true }).catch(console.error);
        app.quit();
        return;
      }
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
      keepDownload = true;
      if (process.platform === 'win32') app.quit();
    } catch (error) {
      await show({ type: 'error', message: downloading ? '更新失败' : '检查更新失败', detail: error.message });
    } finally {
      getWindow()?.setProgressBar(-1);
      if (directory && !keepDownload) await rm(directory, { recursive: true, force: true }).catch(console.error);
      if (installing) endInstall();
      inProgress = false;
    }
  };
}

module.exports = { createUpdater, selectUpdate, findUpdate, downloadUpdate };

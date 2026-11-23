const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { createUpdater, selectUpdate, findUpdate, downloadUpdate } = require('../desktop/updates.cjs');

function asset(name, url = `https://github.com/houleixx/PDFSee/releases/download/v1.10.0/${name}`) {
  return { name, browser_download_url: url, size: 100 };
}

const universal = 'PDFSee-macos-1.10.0.dmg';
const arm = 'PDFSee-macos-1.10.0-arm64.dmg';
const intel = 'PDFSee-macos-1.10.0-x64.dmg';
const windows = 'PDFSee-windows-1.10.0.exe';
const release = { tag_name: 'v1.10.0', assets: [arm, windows, intel, universal].map(name => asset(name)) };

test('only a higher stable version offers an update', () => {
  assert.equal(selectUpdate(release, '1.9.99', 'darwin', 'arm64').version, '1.10.0');
  for (const current of ['1.10.0', '1.11.0', '2.0.0']) {
    assert.equal(selectUpdate(release, current, 'darwin', 'arm64'), null);
  }
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.11.0-beta.1' }]) {
    assert.equal(selectUpdate({ ...release, ...change }, '1.0.0', 'darwin', 'arm64'), null);
  }
});

test('selects the universal installer first and only falls back to a matching architecture', () => {
  assert.equal(selectUpdate(release, '1.0.0', 'darwin', 'arm64').name, universal);
  assert.equal(selectUpdate({ ...release, assets: [asset(intel), asset(arm)] }, '1.0.0', 'darwin', 'x64').name, intel);
  assert.equal(selectUpdate(release, '1.0.0', 'win32', 'x64').name, windows);
  const legacy = 'PDFSee-1.10.0-universal.dmg';
  assert.equal(selectUpdate({ ...release, assets: [asset(legacy)] }, '1.0.0', 'darwin', 'arm64').name, legacy);
  assert.throws(() => selectUpdate({ ...release, assets: [
    asset(intel), asset(arm, 'https://example.com/file.dmg')
  ] }, '1.0.0', 'darwin', 'arm64'), /没有适用于/);
});

test('checks downloaded installer length and GitHub digest before use', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pdfsee-update-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contents = Buffer.from('fixture installer');
  const update = {
    url: 'https://github.com/fixture',
    size: contents.length,
    digest: 'sha256:' + createHash('sha256').update(contents).digest('hex')
  };
  const response = async () => new Response(contents);
  await downloadUpdate(update, join(root, 'valid.dmg'), () => {}, response);
  assert.deepEqual(await readFile(join(root, 'valid.dmg')), contents);
  await assert.rejects(downloadUpdate({ ...update, size: contents.length + 1 },
    join(root, 'short.dmg'), () => {}, response), /校验失败/);
  await assert.rejects(downloadUpdate({ ...update, digest: 'sha256:wrong' },
    join(root, 'corrupted.dmg'), () => {}, response), /校验失败/);
});

test('rate-limited API falls back to the latest release redirect and published checksums', async () => {
  const digest = 'a'.repeat(64);
  const requested = [];
  const fetchRelease = async url => {
    requested.push(url);
    if (url.startsWith('https://api.github.com/')) return new Response('', { status: 403 });
    assert.match(url, /\/v1\.10\.0\/SHA256SUMS\.txt$/);
    return new Response(`${digest}  ${intel}\n${digest} *${arm}\n`);
  };
  const getRedirect = async url => {
    requested.push(url);
    assert.match(url, /\/releases\/latest$/);
    return 'https://github.com/houleixx/PDFSee/releases/tag/v1.10.0';
  };
  const update = await findUpdate(fetchRelease, '1.9.0', 'darwin', 'arm64', getRedirect);
  assert.equal(update.name, arm);
  assert.equal(update.digest, `sha256:${digest}`);
  requested.length = 0;
  assert.equal(await findUpdate(fetchRelease, '1.10.0', 'darwin', 'arm64', getRedirect), null);
  assert.equal(requested.length, 2);
});

const supported = ['darwin', 'win32'].includes(process.platform);

async function updaterFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pdfsee-update-flow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const notices = [];
  const downloads = [];
  const progress = [];
  const opened = [];
  const state = { current: '1.9.0', release, choice: 1, offline: false };
  const dependencies = {
    app: { getVersion: () => state.current, getPath: () => root, quit() {} },
    async show(options) {
      notices.push(options);
      return state.choice;
    },
    shell: { async openPath(path) {
      opened.push(await readFile(path));
      return '';
    } },
    net: { async fetch(url) {
      if (state.offline) throw new Error('offline');
      if (url.startsWith('https://api.github.com/')) return Response.json(state.release);
      downloads.push(url);
      return new Response(Buffer.alloc(100));
    } },
    getWindow: () => ({ setProgressBar() {} }),
    beginInstall: () => true,
    endInstall() {},
    onProgress: value => progress.push(value)
  };
  return { state, notices, downloads, progress, opened, newUpdater: () => createUpdater(dependencies) };
}

test('startup skips an ignored release across restarts and offers a newer release', { skip: !supported }, async t => {
  const { newUpdater, state, notices, downloads } = await updaterFixture(t);
  const startup = { automatic: true };
  state.current = '1.10.0';
  await newUpdater()(startup);
  assert.equal(notices.length, 0);

  state.current = '1.9.0';
  await newUpdater()(startup); // Later
  state.choice = 2;
  await newUpdater()(startup); // Ignore
  await newUpdater()(startup);
  assert.equal(notices.length, 2);
  assert.deepEqual(notices[1].buttons, ['后台下载并安装', '稍后', '忽略此版本']);
  await newUpdater()();
  assert.match(notices[2].message, /已忽略 PDFSee 1\.10\.0/);

  state.release = {
    tag_name: 'v1.11.0',
    assets: release.assets.map(item => ({
      ...item,
      name: item.name.replace('1.10.0', '1.11.0'),
      browser_download_url: item.browser_download_url.replaceAll('1.10.0', '1.11.0')
    }))
  };
  state.choice = 1;
  await newUpdater()(startup);
  assert.match(notices[3].message, /发现 PDFSee 1\.11\.0/);
  assert.equal(downloads.length, 0);
});

test('accepted updates report download progress and clear the indicator after handoff', { skip: !supported }, async t => {
  const { newUpdater, state, notices, downloads, progress, opened } = await updaterFixture(t);
  state.choice = 0;
  const check = newUpdater();
  await Promise.all([check({ automatic: true }), check()]);
  assert.equal(notices.length, 1);
  assert.equal(downloads.length, 1);
  assert.deepEqual(opened, [Buffer.alloc(100)]);
  assert.deepEqual(progress, [
    { version: '1.10.0', phase: 'download', percent: null },
    { version: '1.10.0', phase: 'download', percent: 100 },
    { version: '1.10.0', phase: 'install', percent: null },
    null
  ]);
});

test('startup network failures stay silent and manual failures are shown', async t => {
  const { newUpdater, state, notices, progress } = await updaterFixture(t);
  state.offline = true;
  const check = newUpdater();
  await check({ automatic: true });
  assert.equal(notices.length, 0);
  await check();
  assert.equal(notices[0].message, '检查更新失败');
  assert.deepEqual(progress, []);
});

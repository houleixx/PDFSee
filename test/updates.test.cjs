const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { selectUpdate, findUpdate, downloadUpdate } = require('../desktop/updates.cjs');

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

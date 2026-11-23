const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const { basename } = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const home = 'https://www.libreoffice.org/download/';
const origin = 'https://download.documentfoundation.org';

function installerLink(html, platform, arch) {
  const distribution = {
    'darwin-arm64': ['mac/aarch64', 'MacOS_aarch64.dmg'],
    'darwin-x64': ['mac/x86_64', 'MacOS_x86-64.dmg'],
    'win32-arm64': ['win/aarch64', 'Win_aarch64.msi'],
    'win32-x64': ['win/x86_64', 'Win_x86-64.msi']
  }[`${platform}-${arch}`];
  if (!distribution) throw new Error('此平台暂不支持自动下载 LibreOffice。');
  const [directory, suffix] = distribution;
  for (const match of html.matchAll(/href\s*=\s*["'](https:\/\/download\.documentfoundation\.org\/libreoffice\/stable\/[^"'<>]+)["']/gi)) {
    const url = new URL(match[1]);
    const [, version, os, architecture, name] = /^\/libreoffice\/stable\/([\d.]+)\/([\w]+)\/([\w]+)\/([^/]+)$/.exec(url.pathname) ?? [];
    if (url.origin === origin && /^\d+\.\d+\.\d+$/.test(version) && !url.search && !url.hash &&
        `${os}/${architecture}` === directory && name === `LibreOffice_${version}_${suffix}`) return url.href;
  }
  throw new Error('官方页面没有返回适用于这台电脑的 LibreOffice 安装包。');
}

async function findInstaller(fetch, platform, arch) {
  const options = { signal: AbortSignal.timeout(20000) };
  const page = await fetch(home, options);
  if (!page.ok) throw new Error('无法读取 LibreOffice 官方下载页。');
  const url = installerLink(await page.text(), platform, arch);
  const name = basename(new URL(url).pathname);
  const metadata = await fetch(url + '.meta4', options);
  if (!metadata.ok) throw new Error('无法取得 LibreOffice 安装包的校验信息。');
  const xml = await metadata.text();
  const expectedFile = xml.includes(`<file name="${name}">`);
  const size = Number(xml.match(/<size>(\d+)<\/size>/)?.[1]);
  const sha256 = xml.match(/<hash type="sha-256">([\da-f]{64})<\/hash>/i)?.[1]?.toLowerCase();
  if (!expectedFile || !Number.isSafeInteger(size) || size <= 0 || !sha256) {
    throw new Error('LibreOffice 安装包的校验信息无效。');
  }
  return { url, name, size, sha256 };
}

async function downloadInstaller(fetch, installer, path, progress) {
  const response = await fetch(installer.url, { signal: AbortSignal.timeout(20 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`下载 LibreOffice 失败（HTTP ${response.status}）。`);
  const hash = createHash('sha256');
  let length = 0;
  const verify = new Transform({
    transform(chunk, _encoding, callback) {
      length += chunk.length;
      if (length > installer.size) return callback(new Error('LibreOffice 安装包大小校验失败。'));
      hash.update(chunk);
      progress(length / installer.size);
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(path, { flags: 'wx' }));
  if (length !== installer.size || hash.digest('hex') !== installer.sha256) {
    throw new Error('LibreOffice 安装包校验失败，请重新下载。');
  }
}

module.exports = { installerLink, findInstaller, downloadInstaller };

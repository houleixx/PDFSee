const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [tag, macos, windows] = process.argv.slice(2);
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const version = tag?.startsWith('v') ? tag.slice(1) : '';
if (!versionPattern.test(version) ||
    ![`PDFSee-macos-${version}.dmg`, `PDFSee-macos-${version}-arm64.dmg`, `PDFSee-macos-${version}-x64.dmg`].includes(macos) ||
    windows !== `PDFSee-windows-${version}.exe`) {
  throw new Error('发布版本与安装包文件名不匹配。');
}

function isNewer(current) {
  const difference = current.split('.').map((part, index) => BigInt(part) - BigInt(version.split('.')[index]))
    .find(part => part !== 0n);
  return difference > 0n;
}

const base = 'https://github.com/houleixx/PDFSee/releases/download/';
const pages = ['index.html', 'en/index.html'].map(name => {
  const path = join(__dirname, '..', 'website', name);
  const html = readFileSync(path, 'utf8');
  const registered = [...html.matchAll(/href="([^"]+)" class="btn-primary" data-download="(macos|windows)"/g)];
  if (registered.length !== 2 || new Set(registered.map(link => link[2])).size !== 2) {
    throw new Error(`无法识别 ${name} 的两个平台下载入口。`);
  }
  return { path, html, registered };
});
const hasNewerLinks = pages.some(({ registered }) => registered.some(([, url]) => {
  if (!url.startsWith(base + 'v')) return false;
  const current = url.slice(base.length + 1).split('/')[0];
  return versionPattern.test(current) && isNewer(current);
}));
if (!hasNewerLinks) {
  for (const { path, html, registered } of pages) {
    let updated = html;
    for (const [match, url, platform] of registered) {
      const target = `${base}${tag}/${platform === 'macos' ? macos : windows}`;
      updated = updated.replace(match, match.replace(url, target));
    }
    if (updated !== html) writeFileSync(path, updated);
  }
}

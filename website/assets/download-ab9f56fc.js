(() => {
  const links = [...document.querySelectorAll('[data-download]')];
  const preferred = document.documentElement.dataset.downloadPlatform;
  const primary = links.find(link => link.dataset.download === preferred);
  // Match keyboard navigation to the visual order set before first paint.
  if (primary) primary.parentElement.prepend(primary);

  const repository = 'houleixx/PDFSee';
  void fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    signal: AbortSignal.timeout(3500)
  }).then(async response => {
    if (!response.ok) return;
    const { tag_name: tag, draft, prerelease, assets } = await response.json();
    if (draft || prerelease || !/^v\d+\.\d+\.\d+$/.test(tag) || !Array.isArray(assets)) return;
    const version = tag.slice(1);
    for (const link of links) {
      const system = link.dataset.download;
      const name = `PDFSee-${system}-${version}.${system === 'macos' ? 'dmg' : 'exe'}`;
      const url = `https://github.com/${repository}/releases/download/${tag}/${name}`;
      if (assets.some(asset => asset.name === name && asset.browser_download_url === url)) link.href = url;
    }
  }).catch(() => {});
})();

(() => {
  const links = [...document.querySelectorAll('[data-download]')];
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/^Mac/i.test(platform) && navigator.maxTouchPoints > 1);
  const preferred = mobile ? '' : /^Win/i.test(platform) ? 'windows' : /^Mac/i.test(platform) ? 'macos' : '';
  if (preferred) {
    const primary = links.find(link => link.dataset.download === preferred);
    primary.parentElement.prepend(primary);
    for (const link of links) {
      link.classList.toggle('btn-primary', link === primary);
      link.classList.toggle('btn-secondary', link !== primary);
    }
  }

})();

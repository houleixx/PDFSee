const { BrowserWindow } = require('electron');
const { tocLayout } = require('./merge-navigation.cjs');

const escapeHtml = value => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function renderMergeToc(entries, heading) {
  const { width, height, margin, top, rowHeight, rows } = tocLayout;
  const sections = [];
  for (let start = 0; start < entries.length; start += rows) {
    const lines = entries.slice(start, start + rows).map(({ title, number }) =>
      `<div class="row"><span class="label">${escapeHtml(title.slice(0, 500))}</span><span class="leader"></span><span>${number}</span></div>`).join('');
    sections.push(`<section><h1>${escapeHtml(heading)}</h1>${lines}</section>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    @page { size: ${width}pt ${height}pt; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 11pt system-ui, sans-serif; color: #181818; }
    section { position: relative; padding: ${top}pt ${margin}pt 0; }
    section + section { break-before: page; }
    h1 { position: absolute; top: 48pt; margin: 0; font-size: 24pt; }
    .row { display: flex; align-items: center; gap: 7pt; height: ${rowHeight}pt; break-inside: avoid; }
    .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .leader { flex: 1 0 12pt; border-bottom: 1px dotted #777; }
  </style>${sections.join('')}`;
  const browser = new BrowserWindow({
    show: false, webPreferences: { sandbox: true, javascript: false, backgroundThrottling: false }
  });
  try {
    await browser.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    return await browser.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  } finally {
    browser.destroy();
  }
}

module.exports = { renderMergeToc };

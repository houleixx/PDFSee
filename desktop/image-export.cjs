const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { basename, join } = require('node:path');
const { parsePages } = require('./pdf.cjs');

function imagePages(spec, count) {
  if (typeof spec !== 'string' || spec.length > 30000 || !Number.isInteger(count) || count < 1 || count > 100000) {
    throw new Error('文档页数或页码范围无效。');
  }
  // 每个原始页面只导出一张图片，文件名保留原页码。
  return [...new Set(parsePages(spec, count))];
}

async function createImageExport(parent, stem, pages) {
  const prefix = stem.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 65) || 'PDF';
  const directory = await mkdtemp(join(parent, `${prefix}-图片-`));
  const digits = Math.max(2, String(pages.reduce((largest, page) => Math.max(largest, page), 0) + 1).length);
  let saved = 0;
  let closed = false;
  let writing = null;
  return {
    async append(bytes) {
      if (closed || writing || saved >= pages.length) throw new Error('图片导出任务已结束或正在写入。');
      const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      if (!(bytes instanceof Uint8Array) || bytes.length > 100 * 1024 * 1024 ||
          !Buffer.from(bytes.subarray(0, 8)).equals(signature)) throw new Error('PNG 图片无效或过大。');
      const page = String(pages[saved] + 1).padStart(digits, '0');
      writing = writeFile(join(directory, `第${page}页.png`), bytes, { flag: 'wx' });
      try { await writing; saved++; }
      finally { writing = null; }
    },
    finish() {
      if (closed || writing || saved !== pages.length) throw new Error('图片尚未全部导出，请重试。');
      closed = true;
      return { name: basename(directory), location: directory, count: saved, kind: 'images' };
    },
    async cancel() {
      closed = true;
      await writing?.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  };
}

module.exports = { imagePages, createImageExport };

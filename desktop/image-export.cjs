const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { basename, join } = require('node:path');
const { tmpdir } = require('node:os');
const { parsePages } = require('./pdf.cjs');

function imagePages(spec, count) {
  if (typeof spec !== 'string' || spec.length > 30000 || !Number.isInteger(count) || count < 1 || count > 100000) {
    throw new Error('文档页数或页码范围无效。');
  }
  // 每个原始页面只导出一张图片，文件名保留原页码。
  return [...new Set(parsePages(spec, count))];
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function validPng(bytes) {
  return bytes instanceof Uint8Array && bytes.length <= 100 * 1024 * 1024 &&
    Buffer.from(bytes.subarray(0, 8)).equals(pngSignature);
}

async function createFormatExport(path, format, count, finalize) {
  const directory = await mkdtemp(join(tmpdir(), 'pdfsee-export-'));
  const pages = [];
  let operation;
  let totalBytes = 0;
  let closed = false;
  const expected = format === 'long' ? 1 : count;
  return {
    async append(value, width, height) {
      if (closed || operation || pages.length >= expected) throw new Error('转换任务已结束或正在写入。');
      const text = format === 'docx';
      if (text ? typeof value !== 'string' || value.length > 2_000_000 : !validPng(value)) {
        throw new Error('页面内容无效或过大。');
      }
      if (format !== 'long' && !text && (!Number.isFinite(width) || !Number.isFinite(height) ||
          Math.min(width, height) <= 0 || Math.max(width, height) > 14400)) {
        throw new Error('页面尺寸无效或过大。');
      }
      const file = join(directory, String(pages.length));
      const bytes = text ? Buffer.byteLength(value) : value.length;
      if (totalBytes + bytes > 256 * 1024 * 1024) throw new Error('所选页面的转换数据过大，请缩小页码范围。');
      operation = writeFile(file, value, { flag: 'wx' });
      try { await operation; totalBytes += bytes; pages.push({ path: file, width, height }); }
      finally { operation = null; }
    },
    async finish() {
      if (closed || operation || pages.length !== expected) throw new Error('页面尚未全部转换，请重试。');
      operation = finalize(pages, () => closed);
      try {
        await operation;
        return { name: basename(path), location: path };
      } finally {
        closed = true;
        operation = null;
        await rm(directory, { recursive: true, force: true }).catch(console.error);
      }
    },
    async cancel() {
      closed = true;
      await operation?.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  };
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
      if (!validPng(bytes)) throw new Error('PNG 图片无效或过大。');
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

module.exports = { imagePages, createImageExport, createFormatExport };

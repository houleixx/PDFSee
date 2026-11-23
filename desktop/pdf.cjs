const { readFile } = require('node:fs/promises');
const { extname } = require('node:path');

function parsePages(spec, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('文档没有可用页面。');
  const input = spec.trim();
  if (!input) return Array.from({ length: count }, (_, i) => i);
  const pages = [];
  for (const group of input.split(/[,，]/)) {
    const match = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(group);
    if (!match) throw new Error('请输入有效页码，例如 1-3, 5, 8-6。');
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < 1 || first > count || last > count) {
      throw new Error(`页码应在 1 至 ${count} 之间。`);
    }
    if (pages.length + Math.abs(last - first) + 1 > Math.max(10000, count)) {
      throw new Error('选择的页面过多。');
    }
    const step = first <= last ? 1 : -1;
    for (let page = first; page !== last + step; page += step) pages.push(page - 1);
  }
  return pages;
}

async function loadPdf(path) {
  const { PDFDocument, EncryptedPDFError } = require('pdf-lib');
  try {
    return await PDFDocument.load(await readFile(path), { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) throw new Error('此 PDF 已加密。页面工具需要使用未加密的副本。');
    if (error.code) throw error;
    throw new Error('无法读取这个 PDF。请确认文件完整。', { cause: error });
  }
}

async function copyPages(source, indices, rotation = 0) {
  const { PDFDocument, degrees } = require('pdf-lib');
  const output = await PDFDocument.create();
  const unique = [...new Set(indices)];
  const copies = await output.copyPages(source, unique);
  const firstCopy = new Map(unique.map((index, position) => [index, copies[position]]));
  for (const index of indices) {
    let page = firstCopy.get(index);
    if (page) firstCopy.delete(index);
    else [page] = await output.copyPages(source, [index]);
    if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation + 360) % 360));
    output.addPage(page);
  }
  return output.save();
}

async function editPages(paths, { action, page, gap }) {
  const source = await loadPdf(paths[0]);
  const indices = source.getPageIndices();
  if (action !== 'insert' && (!Number.isInteger(page) || page < 0 || page >= indices.length)) {
    throw new Error('要编辑的页面不存在。');
  }
  if (action !== 'delete' && (!Number.isInteger(gap) || gap < 0 || gap > indices.length)) {
    throw new Error('插入位置无效。');
  }
  if (action === 'delete') {
    if (indices.length === 1) throw new Error('文档至少需要保留一页。');
    indices.splice(page, 1);
    return copyPages(source, indices);
  }
  if (action === 'move') {
    indices.splice(page, 1);
    indices.splice(gap > page ? gap - 1 : gap, 0, page);
    return copyPages(source, indices);
  }
  const { PDFDocument } = require('pdf-lib');
  const output = await PDFDocument.create();
  async function append(document, pages) {
    for (const copied of await output.copyPages(document, pages)) output.addPage(copied);
  }
  await append(source, indices.slice(0, gap));
  for (const path of paths.slice(1)) {
    const attachment = await loadPdf(path);
    const pages = attachment.getPageIndices();
    if (!pages.length) throw new Error('插入的 PDF 没有可用页面。');
    await append(attachment, pages);
  }
  await append(source, indices.slice(gap));
  return output.save();
}

async function mergeFiles(paths) {
  const { PDFDocument } = require('pdf-lib');
  const output = await PDFDocument.create();
  for (const path of paths) {
    const source = await loadPdf(path);
    for (const page of await output.copyPages(source, source.getPageIndices())) output.addPage(page);
  }
  if (!output.getPageCount()) throw new Error('没有可导出的页面。');
  return output.save();
}

async function imagesToPdf(paths, paper) {
  const { PDFDocument } = require('pdf-lib');
  const output = await PDFDocument.create();
  const sizes = { a4: [595.28, 841.89], letter: [612, 792] };
  for (const path of paths) {
    const data = await readFile(path);
    const image = extname(path).toLowerCase() === '.png'
      ? await output.embedPng(data) : await output.embedJpg(data);
    const original = image.scale(Math.min(0.75, 14400 / Math.max(image.width, image.height)));
    const [width, height] = sizes[paper] ?? [original.width, original.height];
    const margin = paper === 'original' ? 0 : 24;
    const scaled = image.scaleToFit(width - margin * 2, height - margin * 2);
    output.addPage([width, height]).drawImage(image, {
      ...scaled, x: (width - scaled.width) / 2, y: (height - scaled.height) / 2
    });
  }
  return output.save();
}

module.exports = { parsePages, loadPdf, copyPages, mergeFiles, imagesToPdf, editPages };

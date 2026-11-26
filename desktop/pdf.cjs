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
    if (/^\.(?:jpe?g|png)$/i.test(extname(path))) {
      await appendImagePage(output, path, 'original');
      continue;
    }
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

async function appendImagePage(output, path, paper) {
  const data = await readFile(path);
  let image;
  try {
    image = extname(path).toLowerCase() === '.png'
      ? await output.embedPng(data) : await output.embedJpg(data);
  } catch (error) {
    throw new Error('无法读取图片。请确认文件完整且格式正确。', { cause: error });
  }
  const sizes = { a4: [595.28, 841.89], letter: [612, 792] };
  const original = image.scale(Math.min(0.75, 14400 / Math.max(image.width, image.height)));
  const [width, height] = sizes[paper] ?? [original.width, original.height];
  const margin = paper === 'original' ? 0 : 24;
  const scaled = image.scaleToFit(width - margin * 2, height - margin * 2);
  output.addPage([width, height]).drawImage(image, {
    ...scaled, x: (width - scaled.width) / 2, y: (height - scaled.height) / 2
  });
}

async function imagesToPdf(paths, paper) {
  const { PDFDocument } = require('pdf-lib');
  const output = await PDFDocument.create();
  for (const path of paths) await appendImagePage(output, path, paper);
  return output.save();
}

async function loadPdfForNotes(bytes) {
  const { PDFDocument, EncryptedPDFError } = require('pdf-lib');
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) throw new Error('此 PDF 已加密，无法修改便签。');
    throw error;
  }
}

function addPdfNote(document, { page, x, y, text }) {
  const { PDFHexString } = require('pdf-lib');
  const message = typeof text === 'string' ? text.trim() : '';
  if (!Number.isInteger(page) || page < 1 || page > document.getPageCount() ||
      !Number.isFinite(x) || !Number.isFinite(y) || !message || message.length > 4000) {
    throw new Error('便签内容或位置无效。');
  }
  const target = document.getPage(page - 1);
  const { context } = document;
  const note = context.obj({
    Type: 'Annot', Subtype: 'Text', Name: 'Comment', Rect: [x, y - 20, x + 20, y],
    Contents: PDFHexString.fromText(message), Open: false, F: 24, C: [1, 0.8, 0.2]
  });
  target.node.addAnnot(context.register(note));
}

function findPdfNote(document, page, id) {
  const { PDFDict, PDFName, PDFRef } = require('pdf-lib');
  const match = typeof id === 'string' && /^(\d+)R(\d+)?$/.exec(id);
  if (!match || !Number.isInteger(page) || page < 1 || page > document.getPageCount()) {
    throw new Error('找不到要操作的便签。');
  }
  const target = document.getPage(page - 1);
  const refs = target.node.Annots()?.asArray() ?? [];
  const ref = PDFRef.of(Number(match[1]), Number(match[2] ?? 0));
  const note = refs.includes(ref) ? document.context.lookup(ref) : null;
  if (!(note instanceof PDFDict) || note.get(PDFName.of('Subtype')) !== PDFName.of('Text')) {
    throw new Error('找不到要操作的便签。');
  }
  return { target, refs, ref, note };
}

function updatePdfNote(document, { page, id, text }) {
  const { PDFHexString, PDFName, PDFString } = require('pdf-lib');
  const { note } = findPdfNote(document, page, id);
  const message = typeof text === 'string' ? text.trim() : '';
  if (!message || message.length > 4000) throw new Error('便签内容或位置无效。');
  note.set(PDFName.of('Contents'), PDFHexString.fromText(message));
  note.delete(PDFName.of('RC'));
  note.set(PDFName.of('M'), PDFString.fromDate(new Date()));
}

function movePdfNote(document, { page, id, dx, dy }) {
  const { PDFArray, PDFName, PDFNumber, PDFString } = require('pdf-lib');
  const { note, target } = findPdfNote(document, page, id);
  const key = PDFName.of('Rect');
  const rect = note.lookupMaybe(key, PDFArray)?.asArray();
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || rect?.length !== 4 ||
      !rect.every(value => value instanceof PDFNumber)) throw new Error('便签内容或位置无效。');
  const [x1, y1, x2, y2] = rect.map(value => value.asNumber());
  const { x, y, width, height } = target.getCropBox();
  const shiftX = Math.max(x - Math.min(x1, x2), Math.min(dx, x + width - Math.max(x1, x2)));
  const shiftY = Math.max(y - Math.min(y1, y2), Math.min(dy, y + height - Math.max(y1, y2)));
  note.set(key, document.context.obj([x1 + shiftX, y1 + shiftY, x2 + shiftX, y2 + shiftY]));
  note.set(PDFName.of('M'), PDFString.fromDate(new Date()));
}

function removePdfNote(document, { page, id }) {
  const { PDFDict, PDFName } = require('pdf-lib');
  const { target, refs, ref, note } = findPdfNote(document, page, id);
  const popup = note.get(PDFName.of('Popup'));
  if (refs.includes(popup) && document.context.lookupMaybe(popup, PDFDict)?.get(PDFName.of('Subtype')) === PDFName.of('Popup')) {
    target.node.removeAnnot(popup);
  }
  target.node.removeAnnot(ref);
}

async function editPdfNotes(bytes, edits) {
  if (!Array.isArray(edits)) throw new Error('无效的便签操作。');
  if (!edits.length) return bytes;
  const document = await loadPdfForNotes(bytes);
  const operations = new Map([
    ['add', addPdfNote], ['update', updatePdfNote], ['move', movePdfNote], ['remove', removePdfNote]
  ]);
  for (const edit of edits) {
    const apply = operations.get(edit?.action);
    if (!apply) throw new Error('无效的便签操作。');
    apply(document, edit);
  }
  return document.save();
}

module.exports = { parsePages, loadPdf, copyPages, mergeFiles, imagesToPdf, editPages, editPdfNotes };

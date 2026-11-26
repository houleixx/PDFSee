const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePages, copyPages, mergeFiles, imagesToPdf } = require('../desktop/pdf.cjs');

const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64');

test('page ranges preserve the chosen order, repetitions and inclusive bounds', () => {
  assert.deepEqual(parsePages(' 1–3，5, 8-6, 1 ', 8), [0, 1, 2, 4, 7, 6, 5, 0]);
  assert.deepEqual(parsePages('', 3), [0, 1, 2]);
  for (const invalid of ['0', '4', '1-4', '1,,2', '1-2-3', 'a', '-1']) {
    assert.throws(() => parsePages(invalid, 3));
  }
});

test('exported PDFs retain page order and normalized rotation', async () => {
  const { PDFDocument, degrees } = require('pdf-lib');
  const source = await PDFDocument.create();
  source.addPage([200, 300]).setRotation(degrees(270));
  source.addPage([400, 300]);
  const document = await PDFDocument.load(await copyPages(source, [1, 0, 1], 90));
  assert.deepEqual(document.getPages().map(page => [page.getWidth(), page.getRotation().angle]),
    [[400, 90], [200, 0], [400, 90]]);
});

test('merge keeps the selected file order and image export creates an A4 page', async t => {
  const { PDFDocument } = require('pdf-lib');
  const { mkdtemp, rm, writeFile } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'pdfsee-tests-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [];
  for (const width of [200, 400]) {
    const doc = await PDFDocument.create();
    doc.addPage([width, 300]);
    const file = join(directory, `${width}.pdf`);
    await writeFile(file, await doc.save());
    paths.push(file);
  }
  const merged = await PDFDocument.load(await mergeFiles(paths.reverse()));
  assert.deepEqual(merged.getPages().map(page => page.getWidth()), [400, 200]);
  const png = join(directory, 'sample.png');
  await writeFile(png, samplePng);
  const imagePdf = await PDFDocument.load(await imagesToPdf([png], 'a4'));
  assert.equal(imagePdf.getPageCount(), 1);
  assert.ok(Math.abs(imagePdf.getPage(0).getWidth() - 595.28) < 0.001);
  const original = await PDFDocument.load(await imagesToPdf([png], 'original'));
  assert.equal(original.getPage(0).getWidth(), 0.75);
});

test('reader page edits preserve insertion order, support both move directions and protect the last page', async t => {
  const { PDFDocument } = require('pdf-lib');
  const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { editPages } = require('../desktop/pdf.cjs');
  const directory = await mkdtemp(join(tmpdir(), 'pdfsee-page-edits-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [];
  const originals = [];
  for (const widths of [[201, 202, 203], [301, 302], [401]]) {
    const source = await PDFDocument.create();
    for (const width of widths) source.addPage([width, 300]);
    const path = join(directory, `${widths[0]}.pdf`);
    const bytes = Buffer.from(await source.save());
    await writeFile(path, bytes);
    paths.push(path);
    originals.push(bytes);
  }
  const widthsAfter = async (sources, edit) =>
    (await PDFDocument.load(await editPages(sources, edit))).getPages().map(page => page.getWidth());

  assert.deepEqual(await widthsAfter(paths, { action: 'insert', gap: 1 }), [201, 301, 302, 401, 202, 203]);
  const image = join(directory, 'sample.PNG');
  await writeFile(image, samplePng);
  const mixed = await PDFDocument.load(await editPages([paths[0], image, paths[1], image], { action: 'insert', gap: 1 }));
  assert.deepEqual(mixed.getPages().map(page => page.getWidth()), [201, 0.75, 301, 302, 0.75, 202, 203]);
  assert.equal(mixed.getPage(1).getHeight(), 0.75);
  assert.deepEqual(await readFile(image), samplePng);
  const corruptImage = join(directory, 'corrupt.jpeg');
  await writeFile(corruptImage, 'invalid JPEG');
  await assert.rejects(widthsAfter([paths[0], corruptImage], { action: 'insert', gap: 1 }), /无法读取图片/);
  assert.deepEqual(await widthsAfter(paths.slice(0, 2), { action: 'insert', gap: 0 }), [301, 302, 201, 202, 203]);
  assert.deepEqual(await widthsAfter(paths.slice(0, 2), { action: 'insert', gap: 3 }), [201, 202, 203, 301, 302]);
  assert.deepEqual(await widthsAfter(paths.slice(0, 1), { action: 'move', page: 0, gap: 3 }), [202, 203, 201]);
  assert.deepEqual(await widthsAfter(paths.slice(0, 1), { action: 'move', page: 2, gap: 1 }), [201, 203, 202]);
  assert.deepEqual(await widthsAfter(paths.slice(0, 1), { action: 'delete', page: 1 }), [201, 203]);
  await assert.rejects(widthsAfter(paths.slice(-1), { action: 'delete', page: 0 }), /至少需要保留一页/);
  await assert.rejects(widthsAfter(paths, { action: 'insert', gap: 4 }), /插入位置无效/);
  assert.deepEqual(await Promise.all(paths.map(path => readFile(path))), originals);
});

test('a Unicode review note survives saving and follows its page when copied', async () => {
  const { PDFDocument, PDFDict, PDFName } = require('pdf-lib');
  const { editPdfNotes } = require('../desktop/pdf.cjs');
  const source = await PDFDocument.create();
  source.addPage([200, 300]);
  source.addPage([400, 300]);
  const original = await source.save();
  const note = { page: 2, x: 40, y: 200, text: '请核对数据' };
  const annotated = await PDFDocument.load(await editPdfNotes(original, [{ action: 'add', ...note }]));
  const reordered = await PDFDocument.load(await copyPages(annotated, [1, 0]));
  const [moved, untouched] = reordered.getPages();

  assert.equal(moved.getWidth(), 400);
  const [ref] = moved.node.Annots().asArray();
  const annotation = reordered.context.lookup(ref, PDFDict);
  assert.equal(annotation.get(PDFName.of('Subtype')).toString(), '/Text');
  assert.equal(annotation.get(PDFName.of('Contents')).decodeText(), note.text);
  assert.equal(untouched.node.Annots()?.size() ?? 0, 0);
  assert.equal((await PDFDocument.load(original)).getPage(1).node.Annots()?.size() ?? 0, 0);
  await assert.rejects(editPdfNotes(original, [{ action: 'add', ...note, page: 3 }]), /便签内容或位置无效/);
});

test('deleting an existing note removes its popup and preserves other annotations', async () => {
  const { PDFDocument, PDFHexString } = require('pdf-lib');
  const { editPdfNotes } = require('../desktop/pdf.cjs');
  const source = await PDFDocument.create();
  const page = source.addPage();
  const note = source.context.obj({ Subtype: 'Text', Contents: PDFHexString.fromText('删除此便签') });
  const noteRef = source.context.register(note);
  const popup = source.context.register(source.context.obj({ Subtype: 'Popup', Parent: noteRef }));
  note.set(require('pdf-lib').PDFName.of('Popup'), popup);
  const other = source.context.register(source.context.obj({ Subtype: 'Highlight' }));
  for (const ref of [noteRef, popup, other]) page.node.addAnnot(ref);
  const bytes = await source.save();
  const id = ref => `${ref.objectNumber}R`;
  const saved = await PDFDocument.load(await editPdfNotes(bytes, [{ action: 'remove', page: 1, id: id(noteRef) }]));
  assert.deepEqual(saved.getPage(0).node.Annots().asArray(), [other]);
  assert.equal((await PDFDocument.load(bytes)).getPage(0).node.Annots().size(), 3);
  await assert.rejects(editPdfNotes(bytes, [{ action: 'remove', page: 1, id: id(other) }]), /找不到要操作的便签/);
});

test('editing and moving a note preserves its identity and keeps it on the page', async () => {
  const { PDFDocument, PDFName } = require('pdf-lib');
  const { editPdfNotes } = require('../desktop/pdf.cjs');
  const source = await PDFDocument.create();
  source.addPage([200, 300]);
  const original = await editPdfNotes(await source.save(), [{ action: 'add', page: 1, x: 20, y: 220, text: '旧内容' }]);
  const added = await PDFDocument.load(original);
  const [ref] = added.getPage(0).node.Annots().asArray();
  const id = `${ref.objectNumber}R`;
  const moved = await PDFDocument.load(await editPdfNotes(original, [
    { action: 'update', page: 1, id, text: '新内容' },
    { action: 'move', page: 1, id, dx: 500, dy: -30 }
  ]));
  assert.deepEqual(moved.getPage(0).node.Annots().asArray(), [ref]);
  const result = moved.context.lookup(ref);
  assert.equal(result.get(PDFName.of('Contents')).decodeText(), '新内容');
  assert.deepEqual(result.get(PDFName.of('Rect')).asArray().map(value => value.asNumber()), [180, 170, 200, 190]);
  assert.equal(added.context.lookup(ref).get(PDFName.of('Contents')).decodeText(), '旧内容');
});

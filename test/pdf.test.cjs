const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePages, copyPages, mergeFiles, imagesToPdf } = require('../desktop/pdf.cjs');

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
  await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64'));
  const imagePdf = await PDFDocument.load(await imagesToPdf([png], 'a4'));
  assert.equal(imagePdf.getPageCount(), 1);
  assert.ok(Math.abs(imagePdf.getPage(0).getWidth() - 595.28) < 0.001);
  const original = await PDFDocument.load(await imagesToPdf([png], 'original'));
  assert.equal(original.getPage(0).getWidth(), 0.75);
});

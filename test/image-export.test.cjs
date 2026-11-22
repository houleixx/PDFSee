const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, writeFile, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { imagePages, createImageExport } = require('../desktop/image-export.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64');
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pdfsee-images-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('image export supports all pages, individual pages and ranges without duplicate images', () => {
  assert.deepEqual(imagePages('', 3), [0, 1, 2]);
  assert.deepEqual(imagePages('2', 3), [1]);
  assert.deepEqual(imagePages('3-1, 2', 3), [2, 1, 0]);
  for (const spec of ['0', '4', '1,,2', '1-x']) assert.throws(() => imagePages(spec, 3));
  assert.throws(() => imagePages('', 0));
  assert.throws(() => imagePages(null, 3));
});

test('exports one PNG per selected page with original page numbers and preserves source files', async t => {
  const directory = await temporary(t);
  const source = join(directory, 'source.pdf');
  await writeFile(source, 'unchanged source');
  const session = await createImageExport(directory, 'source', imagePages('3,1', 3));
  await session.append(png);
  await session.append(png);
  const result = session.finish();
  assert.equal(result.count, 2);
  assert.equal(result.kind, 'images');
  assert.deepEqual(await readdir(result.location), ['第01页.png', '第03页.png']);
  assert.deepEqual(await readFile(join(result.location, '第03页.png')), png);
  assert.equal(await readFile(source, 'utf8'), 'unchanged source');
  await assert.rejects(session.append(png));
});

test('incomplete or invalid exports cannot finish and cancellation removes partial images', async t => {
  const directory = await temporary(t);
  const session = await createImageExport(directory, 'document', imagePages('', 2));
  await assert.rejects(session.append(Buffer.from('invalid image')), /PNG/);
  await session.append(png);
  assert.throws(() => session.finish(), /尚未全部/);
  await session.cancel();
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(session.append(png));
});

test('cancelling during a write waits for it and preserves unrelated output directories', async t => {
  const directory = await temporary(t);
  const first = await createImageExport(directory, 'document', [0]);
  const second = await createImageExport(directory, 'document', [0]);
  await second.append(png);
  const output = second.finish();
  await Promise.all([first.append(png), first.cancel()]);
  assert.deepEqual(await readdir(directory), [output.name]);
  assert.deepEqual(await readFile(join(output.location, '第01页.png')), png);
});

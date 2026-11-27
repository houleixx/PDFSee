const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { PDFDocument, PDFHexString, PDFName } = require('pdf-lib');
const { mergeFiles } = require('../desktop/pdf.cjs');
const { mergeOptions, addsNavigation } = require('../desktop/merge-options.cjs');
const { tocLayout } = require('../desktop/merge-navigation.cjs');

const name = PDFName.of;
const get = (dict, key) => dict.lookup(name(key));

test('only options that create navigation allow a single file', () => {
  for (const policy of ['discard', 'retain', 'invalid']) assert.equal(addsNavigation(mergeOptions(policy)), false);
  for (const policy of ['file', 'group']) assert.equal(addsNavigation(mergeOptions(policy)), true);
  for (const policy of ['filename', 'title']) assert.equal(addsNavigation(mergeOptions(undefined, policy)), true);
});

test('merge remaps named bookmark destinations and paginates the linked directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pdfsee-navigation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  const second = source.addPage([400, 300]);
  source.setTitle('申请资料');
  const context = source.context;
  const root = context.obj({ Type: 'Outlines' });
  const rootRef = context.register(root);
  const item = context.register(context.obj({
    Parent: rootRef, Title: PDFHexString.fromText('第二页'), A: { S: 'GoTo', D: PDFHexString.fromText('chapter') }
  }));
  root.set(name('First'), item);
  root.set(name('Last'), item);
  source.catalog.set(name('Outlines'), rootRef);
  source.catalog.set(name('Names'), context.obj({
    Dests: { Kids: [{ Names: [PDFHexString.fromText('chapter'), { D: [second.ref, 'XYZ', null, 200, null] }] }] }
  }));
  const titled = join(directory, '卷一.pdf');
  await writeFile(titled, await source.save());
  const untitled = join(directory, '附件.pdf');
  const attachment = await PDFDocument.create();
  attachment.addPage();
  await writeFile(untitled, await attachment.save());

  const retained = await PDFDocument.load(await mergeFiles([titled, titled], { bookmarks: 'retain' }));
  const first = get(get(retained.catalog, 'Outlines'), 'First');
  assert.equal(get(first, 'Dest').get(0), retained.getPage(1).ref);
  assert.equal(get(get(first, 'Next'), 'Dest').get(0), retained.getPage(3).ref);
  const discarded = await PDFDocument.load(await mergeFiles([titled]));
  assert.equal(get(discarded.catalog, 'Outlines'), undefined);

  const inputs = [...Array(tocLayout.rows).fill(untitled), titled];
  const merged = await PDFDocument.load(await mergeFiles(inputs, { bookmarks: 'group', toc: 'title' }, async entries => {
    assert.deepEqual(entries[0], { title: '附件', number: 3 });
    assert.deepEqual(entries.at(-1), { title: '申请资料', number: tocLayout.rows + 3 });
    const placeholder = await PDFDocument.create();
    for (let i = 0; i < 2; i++) placeholder.addPage([tocLayout.width, tocLayout.height]);
    return placeholder.save();
  }));
  assert.equal(merged.getPageCount(), tocLayout.rows + 4);
  const lastGroup = get(get(merged.catalog, 'Outlines'), 'Last');
  assert.equal(get(lastGroup, 'Title').decodeText(), '卷一');
  const child = get(lastGroup, 'First');
  assert.equal(get(child, 'Title').decodeText(), '第二页');
  const destination = get(child, 'Dest');
  assert.equal(destination.get(0), merged.getPage(tocLayout.rows + 3).ref);
  assert.equal(destination.get(1), name('XYZ'));
  assert.equal(destination.get(3).asNumber(), 200);
  const firstLinks = merged.getPage(0).node.Annots();
  const lastLinks = merged.getPage(1).node.Annots();
  assert.equal(firstLinks.size(), tocLayout.rows);
  assert.equal(lastLinks.size(), 1);
  assert.equal(get(lastLinks.lookup(0), 'Dest').get(0), merged.getPage(tocLayout.rows + 2).ref);
});

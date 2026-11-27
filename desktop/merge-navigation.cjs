const { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } = require('pdf-lib');

const name = PDFName.of;
const get = (dict, key) => dict?.lookupMaybe(name(key), PDFDict);
const text = value => value instanceof PDFString || value instanceof PDFHexString || value instanceof PDFName
  ? value.decodeText() : '';

function readBookmarks(source, copies) {
  const { catalog, context } = source;
  const pages = new Map(source.getPages().map((page, index) => [page.ref, copies[index].ref]));
  const destinations = new Map();
  const visitedNames = new Set();
  function readNames(node) {
    if (!node || visitedNames.has(node)) return;
    visitedNames.add(node);
    const entries = node.lookupMaybe(name('Names'), PDFArray);
    for (let index = 0; entries && index + 1 < entries.size(); index += 2) {
      destinations.set(text(entries.lookup(index)), entries.lookup(index + 1));
    }
    const kids = node.lookupMaybe(name('Kids'), PDFArray);
    for (let index = 0; kids && index < kids.size(); index++) {
      const child = kids.lookup(index);
      if (child instanceof PDFDict) readNames(child);
    }
  }
  readNames(get(get(catalog, 'Names'), 'Dests'));
  const oldDestinations = new Map(get(catalog, 'Dests')?.entries().map(([key, value]) =>
    [key.decodeText(), context.lookup(value)]));
  function destination(value) {
    if (!(value instanceof PDFArray) && !(value instanceof PDFDict)) {
      const key = text(value);
      value = key ? destinations.get(key) ?? oldDestinations.get(key) : undefined;
    }
    if (value instanceof PDFDict) value = value.lookup(name('D'));
    if (!(value instanceof PDFArray)) return;
    const page = pages.get(value.get(0));
    if (!page) return;
    const fit = value.lookup(1);
    if (!(fit instanceof PDFName)) return [page, name('Fit')];
    return [page, fit, ...value.asArray().slice(2).map(item => {
      const parameter = context.lookup(item);
      return parameter instanceof PDFNumber ? parameter : null;
    })];
  }

  const visited = new Set();
  function readLevel(node) {
    const entries = [];
    while (node instanceof PDFDict && !visited.has(node)) {
      visited.add(node);
      const action = get(node, 'A');
      const kind = action?.lookup(name('S'));
      const dest = destination(node.lookup(name('Dest')) ?? (kind === name('GoTo') ? action.lookup(name('D')) : undefined));
      const uri = kind === name('URI') ? text(action.lookup(name('URI'))) : '';
      entries.push({
        title: text(node.lookup(name('Title'))),
        dest, uri, children: readLevel(get(node, 'First')),
        collapsed: (node.lookupMaybe(name('Count'), PDFNumber)?.asNumber() ?? 0) < 0
      });
      node = get(node, 'Next');
    }
    return entries;
  }
  return readLevel(get(get(catalog, 'Outlines'), 'First'));
}

function writeBookmarks(output, entries) {
  if (!entries.length) return;
  const { context } = output;
  const root = context.obj({ Type: 'Outlines' });
  function writeLevel(parent, parentRef, siblings) {
    const records = siblings.map(() => {
      const node = context.obj({ Parent: parentRef });
      return { node, ref: context.register(node) };
    });
    parent.set(name('First'), records[0].ref);
    parent.set(name('Last'), records.at(-1).ref);
    let visible = siblings.length;
    siblings.forEach(({ title, dest, uri, children, collapsed }, index) => {
      const { node, ref } = records[index];
      node.set(name('Title'), PDFHexString.fromText(title));
      if (dest) node.set(name('Dest'), context.obj(dest));
      else if (uri) node.set(name('A'), context.obj({ S: 'URI', URI: PDFHexString.fromText(uri) }));
      if (index) node.set(name('Prev'), records[index - 1].ref);
      if (index + 1 < records.length) node.set(name('Next'), records[index + 1].ref);
      if (children?.length) {
        const count = writeLevel(node, ref, children);
        node.set(name('Count'), PDFNumber.of(collapsed ? -count : count));
        if (!collapsed) visible += count;
      }
    });
    return visible;
  }
  const rootRef = context.register(root);
  root.set(name('Count'), PDFNumber.of(writeLevel(root, rootRef, entries)));
  output.catalog.set(name('Outlines'), rootRef);
}

const tocLayout = { width: 595, height: 842, margin: 52, top: 100, rowHeight: 24, rows: 28 };

async function insertToc(output, entries, render) {
  const { PDFDocument } = require('pdf-lib');
  const { margin, top, rowHeight, rows } = tocLayout;
  const count = Math.ceil(entries.length / rows);
  const directory = await PDFDocument.load(await render(entries.map(({ title, index }) => ({
    title, number: index + count + 1
  }))));
  if (directory.getPageCount() !== count) throw new Error('无法生成目录页。');
  const pages = await output.copyPages(directory, directory.getPageIndices());
  pages.forEach((page, index) => output.insertPage(index, page));
  entries.forEach(({ page: target }, index) => {
    const page = pages[Math.floor(index / rows)];
    const y = page.getHeight() - top - (index % rows) * rowHeight;
    const link = output.context.obj({
      Type: 'Annot', Subtype: 'Link', Border: [0, 0, 0],
      Rect: [margin, y - rowHeight, page.getWidth() - margin, y], Dest: [target.ref, 'Fit']
    });
    page.node.addAnnot(output.context.register(link));
  });
}

module.exports = { readBookmarks, writeBookmarks, insertToc, tocLayout };

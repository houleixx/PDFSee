const { cpSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const directory = dirname(require.resolve('pdfjs-dist/package.json'));
for (const item of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'web/images']) {
  const source = join(directory, item);
  if (existsSync(source)) cpSync(source, join('dist/pdfjs', item), { recursive: true });
}

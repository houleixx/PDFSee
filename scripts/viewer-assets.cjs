const { cpSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const directory = dirname(require.resolve('pdfjs-dist/package.json'));
for (const item of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'web/images']) {
  const source = join(directory, item);
  if (existsSync(source)) cpSync(source, join('dist/pdfjs', item), { recursive: true });
}

if (process.platform === 'darwin') {
  const { execFileSync } = require('node:child_process');
  const { mkdirSync, mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const stage = mkdtempSync(join(tmpdir(), 'pdfsee-swift-'));
  try {
    for (const [source, helper] of [
      ['recognize-text.swift', 'pdfsee-ocr'], ['print-document.swift', 'pdfsee-print'],
      ['default-pdf.swift', 'pdfsee-default-pdf']
    ]) {
      const binaries = ['arm64', 'x86_64'].map(arch => {
        const binary = join(stage, `${helper}-${arch}`);
        execFileSync('swiftc', ['-O', ...(helper === 'pdfsee-default-pdf' ? ['-parse-as-library'] : []), '-target', `${arch}-apple-macos12`, '-module-cache-path', stage,
          join('scripts', source), '-o', binary], { stdio: 'inherit' });
        return binary;
      });
      const bundle = helper === 'pdfsee-print' ? join('dist', 'PDFSee Print.app') : null;
      const output = bundle ? join(bundle, 'Contents', 'MacOS', helper) : join('dist', helper);
      if (bundle) {
        mkdirSync(dirname(output), { recursive: true });
        cpSync('scripts/print-helper-info.plist', join(bundle, 'Contents', 'Info.plist'));
      }
      execFileSync('lipo', ['-create', ...binaries, '-output', output], { stdio: 'inherit' });
      execFileSync('codesign', ['--force', '--sign', '-', bundle ?? output], { stdio: 'inherit' });
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

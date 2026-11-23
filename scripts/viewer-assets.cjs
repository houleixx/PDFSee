const { cpSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const directory = dirname(require.resolve('pdfjs-dist/package.json'));
for (const item of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'web/images']) {
  const source = join(directory, item);
  if (existsSync(source)) cpSync(source, join('dist/pdfjs', item), { recursive: true });
}

if (process.platform === 'darwin') {
  const { execFileSync } = require('node:child_process');
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const stage = mkdtempSync(join(tmpdir(), 'pdfsee-ocr-'));
  try {
    const binaries = ['arm64', 'x86_64'].map(arch => {
      const binary = join(stage, arch);
      execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos12`, '-module-cache-path', stage,
        'scripts/recognize-text.swift', '-o', binary], { stdio: 'inherit' });
      return binary;
    });
    execFileSync('lipo', ['-create', ...binaries, '-output', 'dist/pdfsee-ocr'], { stdio: 'inherit' });
    execFileSync('codesign', ['--force', '--sign', '-', 'dist/pdfsee-ocr'], { stdio: 'inherit' });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

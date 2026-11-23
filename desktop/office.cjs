const { execFile } = require('node:child_process');
const { access, copyFile, mkdtemp, readFile, rm } = require('node:fs/promises');
const { constants } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, extname } = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function findOffice() {
  const candidates = [process.env.PDFSEE_SOFFICE];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice',
      join(require('node:os').homedir(), 'Applications/LibreOffice.app/Contents/MacOS/soffice'));
  }
  if (process.platform === 'win32') {
    for (const dir of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (dir) candidates.push(join(dir, 'LibreOffice', 'program', 'soffice.com'));
    }
  }
  for (const path of candidates.filter(Boolean)) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {}
  }
  try {
    await run('soffice', ['--version'], { timeout: 5000, windowsHide: true });
    return 'soffice';
  } catch {
    return null;
  }
}

async function convertOffice(path, office) {
  office ??= await findOffice();
  if (!office) throw new Error('未找到 LibreOffice。请安装后重试。');
  const dir = await mkdtemp(join(tmpdir(), 'pdfsee-office-'));
  try {
    const source = join(dir, 'source' + extname(path).toLowerCase());
    await copyFile(path, source);
    try {
      await run(office, [
        `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
        '--headless', '--convert-to', 'pdf', '--outdir', dir, source
      ], { timeout: 180000, windowsHide: true });
      const pdf = await readFile(join(dir, 'source.pdf'));
      if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid conversion output');
      return pdf;
    } catch (error) {
      throw new Error(error.killed
        ? '文档转换超时，请检查文件或尝试转换较小的文档。'
        : 'LibreOffice 无法转换该文档。请确认文件完整且可以在 LibreOffice 中打开。', { cause: error });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

module.exports = { findOffice, convertOffice };

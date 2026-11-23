const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { loadPdf, copyPages, parsePages, mergeFiles, imagesToPdf, editPages } = require('./pdf.cjs');
const { convertOffice } = require('./office.cjs');
const { writePdfFormat } = require('./pdf-formats.cjs');

async function run({ mode, paths, paper, spec, rotation, groupSize, directory, office, edit }) {
  if (mode === 'edit-pages') return editPages(paths, edit);
  if (mode === 'merge') return mergeFiles(paths);
  if (mode === 'image') return imagesToPdf(paths, paper);
  if (mode === 'office') return convertOffice(paths[0], office);

  const source = await loadPdf(paths[0]);
  const pages = parsePages(spec, source.getPageCount());
  if (mode !== 'split') return copyPages(source, pages, rotation);

  const count = Math.ceil(pages.length / groupSize);
  const digits = Math.max(2, String(count).length);
  for (let index = 0; index < count; index++) {
    const bytes = await copyPages(source, pages.slice(index * groupSize, (index + 1) * groupSize));
    await writeFile(join(directory, `分册-${String(index + 1).padStart(digits, '0')}.pdf`), bytes, { flag: 'wx' });
  }
  return count;
}

process.parentPort.once('message', async ({ data: job }) => {
  try {
    if (job.mode === 'pdf-format') {
      await writePdfFormat(job.format, job.pages, job.outputPath);
      process.parentPort.postMessage({ value: true });
      return;
    }
    const value = await run(job);
    if (job.mode === 'split') process.parentPort.postMessage({ value });
    else {
      await writeFile(job.outputPath, value, { flag: 'wx' });
      process.parentPort.postMessage({ value: true });
    }
  } catch (error) {
    process.parentPort.postMessage({ error: error.code ? '文件读写失败，请检查路径和目录权限。' : error.message });
  }
});

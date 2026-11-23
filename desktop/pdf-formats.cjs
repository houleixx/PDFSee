const { constants, copyFile, readFile, writeFile } = require('node:fs/promises');

const extensions = Object.freeze({ long: 'png', flat: 'pdf', pptx: 'pptx', docx: 'docx' });

async function writePdfFormat(format, pages, outputPath) {
  if (format === 'long') {
    await copyFile(pages[0].path, outputPath, constants.COPYFILE_EXCL);
    return;
  }
  if (format === 'flat') {
    const { PDFDocument } = require('pdf-lib');
    const output = await PDFDocument.create();
    for (const { path, width, height } of pages) {
      const image = await output.embedPng(await readFile(path));
      output.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
    }
    await writeFile(outputPath, await output.save(), { flag: 'wx' });
    return;
  }
  if (format === 'docx') {
    const { Document, Packer, Paragraph } = require('docx');
    const paragraphs = [];
    let hasText = false;
    for (const [index, { path }] of pages.entries()) {
      const text = await readFile(path, 'utf8');
      hasText ||= !!text.trim();
      for (const [line, value] of text.split('\n').entries()) {
        paragraphs.push(new Paragraph({ text: value, pageBreakBefore: index > 0 && line === 0 }));
      }
    }
    if (!hasText) throw new Error('所选页面没有可提取的文字。扫描件需要先做 OCR。');
    const output = new Document({ sections: [{ children: paragraphs }] });
    await writeFile(outputPath, await Packer.toBuffer(output), { flag: 'wx' });
    return;
  }
  if (format !== 'pptx') throw new Error('不支持的导出格式。');
  const PptxGenJS = require('pptxgenjs');
  const presentation = new PptxGenJS();
  const ratio = pages[0].width / pages[0].height;
  const width = Math.min(13.333, 10 * ratio);
  const height = width / ratio;
  presentation.defineLayout({ name: 'PDF', width, height });
  presentation.layout = 'PDF';
  for (const [index, page] of pages.entries()) {
    const slide = presentation.addSlide();
    const scale = Math.min(width / page.width, height / page.height);
    const w = page.width * scale;
    const h = page.height * scale;
    slide.addImage({
      data: 'image/png;base64,' + (await readFile(page.path)).toString('base64'),
      x: (width - w) / 2, y: (height - h) / 2, w, h, altText: `PDF 第 ${index + 1} 张幻灯片`
    });
  }
  const data = await presentation.write({ outputType: 'nodebuffer' });
  await writeFile(outputPath, data, { flag: 'wx' });
}

module.exports = { extensions, writePdfFormat };

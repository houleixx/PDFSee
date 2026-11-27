type Size = { width: number; height: number };
type PrintOptions = {
  paper: string;
  orientation: string;
  autoRotate: boolean;
  mode: string;
  scale: number;
  copies: number;
};

const paperSizes: Record<string, Size> = {
  a4: { width: 210 * 72 / 25.4, height: 297 * 72 / 25.4 },
  letter: { width: 612, height: 792 }
};

export function printLayout(page: Size, options: PrintOptions) {
  const base = paperSizes[options.paper] ?? page;
  const landscape = options.orientation === 'auto' ? page.width > page.height : options.orientation === 'landscape';
  const short = Math.min(base.width, base.height);
  const long = Math.max(base.width, base.height);
  const paper = { width: landscape ? long : short, height: landscape ? short : long };
  const gap = options.copies > 1 ? Math.min(8, short / 40) : 0;
  let best;
  for (let columns = 1; columns <= options.copies; columns++) {
    const rows = Math.ceil(options.copies / columns);
    const width = (paper.width - gap * (columns - 1)) / columns;
    const height = (paper.height - gap * (rows - 1)) / rows;
    const fit = Math.min(width / page.width, height / page.height);
    const rotatedFit = Math.min(width / page.height, height / page.width);
    const rotate = options.autoRotate && rotatedFit > fit + 0.00001;
    const score = rotate ? rotatedFit : fit;
    if (!best || score > best.score) best = { columns, rows, width, height, rotate, score };
  }
  if (!best) throw new Error('无效的每页份数。');
  const { columns, rows, width, height, rotate, score } = best;
  const fill = Math.max(width / (rotate ? page.height : page.width), height / (rotate ? page.width : page.height));
  const scale = options.mode === 'custom' ? options.scale : options.mode === 'fill' ? fill : score;
  const cells = Array.from({ length: options.copies }, (_, index) => {
    const row = Math.floor(index / columns);
    const columnsInRow = Math.min(columns, options.copies - row * columns);
    return {
      x: (index % columns) * (width + gap) + (paper.width - columnsInRow * width - (columnsInRow - 1) * gap) / 2,
      y: row * (height + gap), width, height
    };
  });
  return { paper, cells, image: { width: page.width * scale, height: page.height * scale }, rotate, scale };
}

export function fillPrintSheet(sheet: HTMLElement, layout: ReturnType<typeof printLayout>, url: string) {
  const { paper, cells, image, rotate } = layout;
  sheet.style.aspectRatio = `${paper.width} / ${paper.height}`;
  sheet.replaceChildren(...cells.map(cell => {
    const frame = document.createElement('div');
    frame.className = 'print-cell';
    frame.style.left = `${cell.x / paper.width * 100}%`;
    frame.style.top = `${cell.y / paper.height * 100}%`;
    frame.style.width = `${cell.width / paper.width * 100}%`;
    frame.style.height = `${cell.height / paper.height * 100}%`;
    const content = new Image();
    content.alt = '';
    content.src = url;
    content.style.width = `${image.width / cell.width * 100}%`;
    content.style.height = `${image.height / cell.height * 100}%`;
    content.style.transform = `translate(-50%, -50%) rotate(${rotate ? 90 : 0}deg)`;
    frame.append(content);
    return frame;
  }));
}

import { AnnotationMode, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type RecognizedLine = { text: string; x: number; y: number; width: number; height: number };

type PageView = {
  div: HTMLDivElement;
  pdfPage: PDFPageProxy;
  viewport: { rotation: number };
};

const font = 'sans-serif';

export function createPageOcr(root: HTMLElement, recognize: (bytes: Uint8Array) => Promise<RecognizedLine[]>) {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `100px ${font}`;
  let pages = new WeakMap<Element, PageView>();
  let results = new WeakMap<PDFPageProxy, RecognizedLine[]>();
  const visible = new Set<PageView>();
  let active = false;
  let generation = 0;

  function show(view: PageView, lines: RecognizedLine[]) {
    const rotation = (view.viewport.rotation - view.pdfPage.rotate + 360) % 360;
    const current = view.div.querySelector<HTMLElement>('.ocr-layer');
    if (!lines.length || current?.dataset.rotation === String(rotation)) return;
    current?.remove();

    const layer = document.createElement('div');
    layer.className = 'ocr-layer';
    layer.dataset.rotation = String(rotation);
    const quarterTurn = rotation === 90 || rotation === 270;
    const { width, height } = view.pdfPage.getViewport({ scale: 1 });
    Object.assign(layer.style, {
      width: quarterTurn ? `${100 * width / height}%` : '100%',
      height: quarterTurn ? `${100 * height / width}%` : '100%',
      transform: `translate(-50%, -50%) rotate(${rotation}deg)`
    });
    for (const line of lines) {
      const measured = measure.measureText(line.text).width / 100;
      if (!measured || line.height <= 0 || line.width <= 0) continue;
      const span = document.createElement('span');
      const fontSize = line.height * height / width;
      span.textContent = line.text;
      Object.assign(span.style, {
        left: `${line.x * 100}%`,
        top: `${line.y * 100}%`,
        fontSize: `${fontSize * 100}cqw`,
        transform: `scaleX(${line.width / (measured * fontSize)})`
      });
      layer.append(span);
    }
    view.div.append(layer);
  }

  async function read(view: PageView, version: number) {
    const page = view.pdfPage;
    const { items } = await page.getTextContent();
    if (items.some(item => 'str' in item && item.str.trim())) return [];
    if (version !== generation || !visible.has(view)) return undefined;

    const size = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 2400 / Math.max(size.width, size.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
      await page.render({ canvas, viewport, background: '#fff', annotationMode: AnnotationMode.DISABLE }).promise;
      if (version !== generation || !visible.has(view)) return undefined;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve));
      if (blob && version === generation && visible.has(view)) return recognize(new Uint8Array(await blob.arrayBuffer()));
      return undefined;
    } finally {
      canvas.width = canvas.height = 1;
    }
  }

  async function processVisible() {
    if (active) return;
    const view = [...visible].find(page => !results.has(page.pdfPage));
    if (!view) return;
    active = true;
    const version = generation;
    try {
      const lines = await read(view, version);
      if (lines && version === generation) {
        results.set(view.pdfPage, lines);
        if (visible.has(view)) show(view, lines);
      }
    } catch (error) {
      if (version === generation) {
        results.set(view.pdfPage, []);
        console.warn('页面文字识别失败', error);
      }
    } finally {
      active = false;
      void processVisible();
    }
  }

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const view = pages.get(entry.target);
      if (!view) continue;
      if (entry.isIntersecting && entry.intersectionRatio > 0) {
        visible.add(view);
        const lines = results.get(view.pdfPage);
        if (lines) show(view, lines);
      } else {
        visible.delete(view);
      }
    }
    void processVisible();
  }, { root, threshold: [0, 0.001] });

  return {
    observe(view: PageView) {
      if (!pages.has(view.div)) {
        pages.set(view.div, view);
        observer.observe(view.div);
      }
      const lines = results.get(view.pdfPage);
      if (lines && visible.has(view)) show(view, lines);
    },
    reset() {
      generation++;
      observer.disconnect();
      observer.takeRecords();
      visible.clear();
      pages = new WeakMap();
      results = new WeakMap();
    }
  };
}

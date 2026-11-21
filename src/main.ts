import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  AnnotationMode, getDocument, GlobalWorkerOptions, PasswordResponses, PDFDataRangeTransport
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import 'lucide-static/font/lucide.css';
import './style.css';

type Kind = 'pdf' | 'image' | 'office';
type FileInfo = { id: string; kind: Kind; name: string; size: number };
type Output = { name: string; location: string; count?: number };
type ToolJob = { mode: string; ids: string[]; spec: string; groupSize: number; rotation: number; paper: string };
type Bridge = {
  pick(kind: Kind, multi: boolean): Promise<FileInfo[]>;
  drop(files: File[]): Promise<FileInfo[]>;
  read(id: string, start: number, end: number): Promise<Uint8Array>;
  release(id: string): Promise<void>;
  execute(job: ToolJob): Promise<Output | null>;
  saveImage(name: string, data: Uint8Array): Promise<Output | null>;
  reveal(path: string): Promise<void>;
  onFile(callback: (file: FileInfo) => void): void;
  onError(callback: (error: string) => void): void;
  onMenu(callback: (command: string) => void): void;
  ready(): Promise<void>;
};
const desktop = (window as Window & { desktop?: Bridge }).desktop!;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => byId<HTMLInputElement>(id);
const select = (id: string) => byId<HTMLSelectElement>(id);
const button = (id: string) => byId<HTMLButtonElement>(id);
const click = (id: string, action: () => void) => { button(id).onclick = action; };
const sizeText = (size: number) => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

const tools = {
  merge: { title: '合并 PDF', icon: 'layers', kind: 'pdf', multi: true, description: '按列表顺序把多份 PDF 合成一份。', hint: '至少添加两份 PDF', submit: '合并并保存' },
  split: { title: '拆分 PDF', icon: 'scissors', kind: 'pdf', multi: false, description: '按固定页数把一份 PDF 分成多个文件。', hint: '支持指定页码范围', submit: '选择目录并拆分' },
  extract: { title: '提取页面', icon: 'files', kind: 'pdf', multi: false, description: '把选中的页面导出为一份新 PDF。', hint: '选择一份 PDF', submit: '提取并保存' },
  organize: { title: '整理页面', icon: 'layout-grid', kind: 'pdf', multi: false, description: '按指定顺序排列页面，可删除不需要的页或旋转导出的页。', hint: '选择一份 PDF', submit: '保存整理后的 PDF' },
  image: { title: '图片转 PDF', icon: 'image', kind: 'image', multi: true, description: '按列表顺序把图片合成一份 PDF，每张图片一页。', hint: 'JPG、JPEG、PNG', submit: '转换并保存' },
  office: { title: '文档转 PDF', icon: 'file-type', kind: 'office', multi: false, description: '通过本机安装的 LibreOffice 将文档导出为 PDF。', hint: 'Word、Excel、PowerPoint、OpenDocument、RTF、TXT', submit: '转换并保存' }
} as const;

type Mode = 'read' | keyof typeof tools;
let mode: Mode = 'read';
let current: FileInfo | null = null;
let selections: FileInfo[] = [];
let output: Output | null = null;
let running = false;
let loadVersion = 0;
let task: ReturnType<typeof getDocument> | null = null;
let doc: Awaited<ReturnType<typeof getDocument>['promise']> | null = null;
let thumbnailObserver: IntersectionObserver | null = null;
type PageRender = ReturnType<Awaited<ReturnType<NonNullable<typeof doc>['getPage']>>['render']>;
const thumbnailTasks = new Map<HTMLCanvasElement, { cancel: () => void }>();
const drawnThumbnails = new WeakSet<HTMLCanvasElement>();
let outlineLoaded = false;
let thumbActive: HTMLElement | null = null;
let searchTimer = 0;
let exporting = false;

GlobalWorkerOptions.workerSrc = workerUrl;
Object.assign(globalThis, { pdfjsLib: pdfjs });
const { EventBus, PDFFindController, PDFLinkService, PDFViewer } = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
const asset = (directory: string) => new URL(`./pdfjs/${directory}/`, document.baseURI).href;
const bus = new EventBus();
const links = new PDFLinkService({ eventBus: bus });
links.externalLinkEnabled = false;
const finder = new PDFFindController({ eventBus: bus, linkService: links });
const viewer = new PDFViewer({
  container: byId<HTMLDivElement>('viewer-container'), viewer: byId<HTMLDivElement>('viewer'), eventBus: bus,
  linkService: links, findController: finder, annotationMode: AnnotationMode.ENABLE,
  annotationEditorMode: -1, imageResourcesPath: asset('web/images'), enableAutoLinking: false
});
links.setViewer(viewer);

function status(message: string, error = false, result: Output | null = null) {
  output = result;
  const text = byId('status-text');
  text.textContent = message;
  text.title = message;
  text.parentElement?.classList.toggle('error', error);
  button('reveal').hidden = !output;
}

function errorStatus(error: unknown) {
  status(error instanceof Error ? error.message : String(error), true);
}

function success(result: Output | null) {
  if (!result) return status('已取消保存。');
  status(result.count ? `已导出 ${result.count} 份 PDF` : `已保存 ${result.name}`, false, result);
}

function refreshSection() {
  byId('home').hidden = mode !== 'read' || !!doc;
  byId('reader').hidden = mode !== 'read' || !doc;
  byId('tools').hidden = mode === 'read';
  byId('section-title').textContent = mode === 'read' ? current?.name ?? '阅读 PDF' : tools[mode].title;
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(node => {
    const active = node.dataset.mode === mode;
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  if (mode !== 'read') button('use-current').hidden = !doc || tools[mode].kind !== 'pdf';
}

function releaseUnused(file: FileInfo) {
  if (file.id !== current?.id && !selections.some(item => item.id === file.id)) {
    void desktop.release(file.id).catch(() => {});
  }
}

function setMode(next: Mode) {
  if (next === mode) return;
  if (running) { status('正在处理文件，请稍候。'); return; }
  const previous = selections;
  selections = [];
  for (const file of previous) releaseUnused(file);
  mode = next;
  refreshSection();
  if (mode === 'read') return;
  const tool = tools[mode];
  byId('tool-icon').replaceChildren(icon(tool.icon));
  byId('tool-title').textContent = tool.title;
  byId('tool-description').textContent = tool.description;
  byId('pick-label').textContent = tool.multi ? '添加文件或拖到此处' : '选择文件或拖到此处';
  byId('pick-hint').textContent = tool.hint;
  byId('run-label').textContent = tool.submit;
  byId('page-options').hidden = !['split', 'extract', 'organize'].includes(mode);
  byId('split-options').hidden = mode !== 'split';
  byId('rotation-options').hidden = mode !== 'organize';
  byId('paper-options').hidden = mode !== 'image';
  (byId('tool-form') as HTMLFormElement).reset();
  refreshFiles();
}

function clearReader() {
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  for (const render of thumbnailTasks.values()) render.cancel();
  thumbnailTasks.clear();
  thumbActive = null;
  byId('thumbnails').replaceChildren();
  byId('outline').replaceChildren();
  outlineLoaded = false;
  input('search').value = '';
  closeSearch();
  const dialog = byId<HTMLDialogElement>('password-dialog');
  if (dialog.open) dialog.close('cancel');
  viewer.setDocument(null);
  links.setDocument(null);
  doc = null;
  const previous = current;
  current = null;
  const old = task;
  task = null;
  if (old) void old.destroy().catch(() => {});
  if (previous) releaseUnused(previous);
}

async function openDocument(file: FileInfo) {
  if (running) {
    releaseUnused(file);
    return status('正在处理文件，请稍候。');
  }
  const version = ++loadVersion;
  clearReader();
  current = file;
  setMode('read');
  refreshSection();
  status(`正在打开 ${file.name}…`);
  try {
    const transport = new class extends PDFDataRangeTransport {
      requestDataRange(start: number, end: number) {
        void desktop.read(file.id, start, end).then(data => {
          if (version === loadVersion) this.onDataRange(start, data);
        }).catch(error => {
          if (version !== loadVersion) return;
          ++loadVersion;
          clearReader();
          refreshSection();
          errorStatus(error);
        });
      }
    }(file.size, null, true);
    const loading = getDocument({
      range: transport, rangeChunkSize: 256 * 1024, disableStream: true, disableAutoFetch: true,
      cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'),
      wasmUrl: asset('wasm'), iccUrl: asset('iccs'), isEvalSupported: false,
      enableXfa: false, useSystemFonts: true, docBaseUrl: document.baseURI
    });
    task = loading;
    loading.onPassword = (submit, reason) => {
      if (version !== loadVersion) return;
      const dialog = byId<HTMLDialogElement>('password-dialog');
      byId('password-title').textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? '密码有误，请重新输入' : '输入 PDF 密码';
      input('password').value = '';
      dialog.returnValue = 'cancel';
      dialog.onclose = () => {
        const password = input('password').value;
        input('password').value = '';
        if (version !== loadVersion) return;
        if (dialog.returnValue === 'unlock') submit(password);
        else closeDocument();
      };
      dialog.showModal();
      input('password').focus();
    };
    const loaded = await loading.promise;
    if (version !== loadVersion) return;
    doc = loaded;
    refreshSection();
    links.setDocument(loaded);
    viewer.setDocument(loaded);
    input('number').max = String(loaded.numPages);
    byId('total').textContent = `/ ${loaded.numPages}`;
    makeThumbnails(loaded);
    if (!byId('outline').hidden) void renderOutline().catch(errorStatus);
    status(`${file.name} · ${loaded.numPages} 页 · ${sizeText(file.size)}`);
  } catch (error) {
    if (version !== loadVersion) return;
    clearReader();
    refreshSection();
    status(error instanceof Error && error.name === 'InvalidPDFException'
      ? '无法打开这个 PDF。请确认文件完整。' : `打开失败：${error instanceof Error ? error.message : String(error)}`, true);
  }
}

function closeDocument() {
  if (running || !current) return;
  ++loadVersion;
  clearReader();
  refreshSection();
  status('已关闭文档。');
}

function icon(name: string) {
  const element = document.createElement('i');
  element.className = `icon icon-${name}`;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function updatePage(page: number) {
  input('number').value = String(page);
  button('previous').disabled = page <= 1;
  button('next').disabled = !doc || page >= doc.numPages;
  thumbActive?.classList.remove('active');
  thumbActive?.removeAttribute('aria-current');
  thumbActive = byId(`thumb-${page}`);
  thumbActive?.classList.add('active');
  thumbActive?.setAttribute('aria-current', 'page');
}

function makeThumbnails(documentToRender: NonNullable<typeof doc>) {
  const list = byId('thumbnails');
  thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement;
      if (entry.isIntersecting && !thumbnailTasks.has(canvas) && !drawnThumbnails.has(canvas)) {
        void renderThumbnail(documentToRender, canvas);
      } else if (!entry.isIntersecting) {
        thumbnailTasks.get(canvas)?.cancel();
        thumbnailTasks.delete(canvas);
        if (drawnThumbnails.delete(canvas)) {
          canvas.width = 1;
          canvas.height = 1;
        }
      }
    }
  }, { root: list, rootMargin: '140px' });
  const fragment = document.createDocumentFragment();
  for (let number = 1; number <= documentToRender.numPages; number++) {
    const thumb = document.createElement('button');
    thumb.id = `thumb-${number}`;
    thumb.className = 'thumb';
    thumb.setAttribute('aria-label', `第 ${number} 页`);
    thumb.onclick = () => { viewer.currentPageNumber = number; };
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.page = String(number);
    thumb.append(canvas, String(number));
    fragment.append(thumb);
    thumbnailObserver.observe(canvas);
  }
  list.append(fragment);
  updatePage(1);
}

async function renderThumbnail(documentToRender: NonNullable<typeof doc>, canvas: HTMLCanvasElement) {
  let rendering: PageRender | undefined;
  const request = { cancel: () => rendering?.cancel() };
  thumbnailTasks.set(canvas, request);
  try {
    const page = await documentToRender.getPage(Number(canvas.dataset.page));
    if (doc !== documentToRender || thumbnailTasks.get(canvas) !== request) return;
    const initial = page.getViewport({ scale: 1 });
    const view = page.getViewport({ scale: 150 / Math.max(initial.width, initial.height) });
    canvas.width = Math.ceil(view.width);
    canvas.height = Math.ceil(view.height);
    rendering = page.render({ canvas, viewport: view, annotationMode: AnnotationMode.DISABLE });
    await rendering.promise;
    if (thumbnailTasks.get(canvas) === request) drawnThumbnails.add(canvas);
  } catch {
    if (thumbnailTasks.get(canvas) === request) {
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    if (thumbnailTasks.get(canvas) === request) thumbnailTasks.delete(canvas);
  }
}

async function renderOutline() {
  if (!doc || outlineLoaded) return;
  const active = doc;
  outlineLoaded = true;
  const entries = await active.getOutline();
  if (doc !== active) return;
  const target = byId('outline');
  if (!entries?.length) { target.textContent = '此文档没有目录。'; return; }
  function append(items: NonNullable<typeof entries>, depth: number) {
    for (const item of items) {
      const element = document.createElement('button');
      element.className = 'outline-link';
      element.style.paddingLeft = `${6 + Math.min(depth, 5) * 8}px`;
      element.textContent = item.title;
      element.disabled = !item.dest;
      element.onclick = () => { if (item.dest) void links.goToDestination(item.dest); };
      target.append(element);
      append(item.items, depth + 1);
    }
  }
  append(entries, 0);
}

function openSearch() {
  if (!doc || mode !== 'read') return;
  byId('find-bar').hidden = false;
  input('search').focus();
  input('search').select();
  if (input('search').value) find();
}

function closeSearch() {
  clearTimeout(searchTimer);
  byId('find-bar').hidden = true;
  byId('matches').textContent = '';
  bus.dispatch('findbarclose', { source: input('search') });
}

function find(again = false, previous = false) {
  bus.dispatch('find', {
    source: input('search'), type: again ? 'again' : '',
    query: input('search').value, phraseSearch: true, caseSensitive: false,
    entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false
  });
}

function findCount({ matchesCount }: { matchesCount?: { current: number; total: number } }) {
  byId('matches').textContent = !input('search').value || !matchesCount
    ? '' : matchesCount.total ? `${matchesCount.current} / ${matchesCount.total}` : '无匹配';
}

bus.on('pagesinit', () => { viewer.currentScaleValue = 'auto'; updatePage(1); });
bus.on('pagechanging', ({ pageNumber }) => updatePage(pageNumber));
bus.on('scalechanging', ({ scale, presetValue }) => {
  const zoom = select('zoom');
  const temporary = zoom.querySelector('option[data-custom]');
  temporary?.remove();
  const result = presetValue || String(Number(scale.toFixed(4)));
  if (!Array.from(zoom.options).some(option => option.value === result)) {
    const custom = new Option(`${Math.round(scale * 100)}%`, result);
    custom.dataset.custom = 'true';
    zoom.append(custom);
  }
  zoom.value = result;
});
bus.on('updatefindmatchescount', findCount);
bus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
  if (state === 3 && input('search').value) byId('matches').textContent = '搜索中…';
  else findCount({ matchesCount });
});

async function exportImage() {
  if (!doc || exporting) return;
  exporting = true;
  const active = doc;
  const number = viewer.currentPageNumber;
  const viewRotation = viewer.pagesRotation;
  const name = current!.name.replace(/\.pdf$/i, '');
  try {
    const page = await active.getPage(number);
    const rotation = (page.rotate + viewRotation) % 360;
    const initial = page.getViewport({ scale: 1, rotation });
    const view = page.getViewport({ scale: Math.min(2, 5000 / Math.max(initial.width, initial.height)), rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(view.width);
    canvas.height = Math.ceil(view.height);
    await page.render({ canvas, viewport: view }).promise;
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法生成 PNG。');
    if (active !== doc || mode !== 'read') return;
    success(await desktop.saveImage(`${name}-第${number}页.png`, new Uint8Array(await blob.arrayBuffer())));
  } catch (error) { errorStatus(error); }
  finally { exporting = false; }
}

function listAction(label: string, glyph: string, action: () => void, disabled = false) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'square';
  control.title = label;
  control.setAttribute('aria-label', label);
  control.disabled = disabled;
  control.append(icon(glyph));
  control.onclick = action;
  return control;
}

function refreshFiles() {
  if (mode === 'read') return;
  const list = byId('file-list');
  list.replaceChildren();
  selections.forEach((file, index) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = file.name;
    name.title = file.name;
    const size = document.createElement('small');
    size.textContent = sizeText(file.size);
    const move = (offset: number) => {
      const next = index + offset;
      [selections[index], selections[next]] = [selections[next], selections[index]];
      refreshFiles();
      list.children[next]?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    };
    item.append(icon('file-text'), name, size);
    if (tools[mode as keyof typeof tools].multi) {
      item.append(listAction('上移', 'arrow-up', () => move(-1), running || index === 0),
        listAction('下移', 'arrow-down', () => move(1), running || index === selections.length - 1));
    }
    item.append(listAction('移除', 'x', () => {
      selections.splice(index, 1);
      releaseUnused(file);
      refreshFiles();
    }, running));
    list.append(item);
  });
  button('run-tool').disabled = running || selections.length < (mode === 'merge' ? 2 : 1);
  button('tool-picker').disabled = running;
  button('use-current').disabled = running;
  if (doc && current && selections[0]?.id === current.id) {
    byId('spec-hint').textContent = `文档共有 ${doc.numPages} 页。留空使用全部页面。`;
  } else {
    byId('spec-hint').textContent = '留空使用全部页面。可按你输入的顺序导出。';
  }
}

function addFiles(files: FileInfo[], kind: Kind, multi: boolean) {
  const matching = files.filter(file => file.kind === kind);
  if (!matching.length) {
    files.forEach(releaseUnused);
    if (files.length) throw new Error('选择的文件与当前工具不匹配。');
    return;
  }
  const previous = selections;
  selections = multi ? [...previous, ...matching].slice(0, 300) : matching.slice(0, 1);
  for (const file of [...previous, ...files]) releaseUnused(file);
  refreshFiles();
  status(`已选择 ${selections.length} 个文件`);
}

async function pickPdf() {
  if (running) return;
  try {
    const [file] = await desktop.pick('pdf', false);
    if (file) await openDocument(file);
  } catch (error) { errorStatus(error); }
}

async function pickToolFiles() {
  if (mode === 'read' || running) return;
  const selectedMode = mode;
  const tool = tools[mode];
  try {
    const files = await desktop.pick(tool.kind, tool.multi);
    if (mode === selectedMode && !running) addFiles(files, tool.kind, tool.multi);
    else files.forEach(releaseUnused);
  } catch (error) { errorStatus(error); }
}

async function runTool(event: SubmitEvent) {
  event.preventDefault();
  if (running || mode === 'read' || !selections.length) return;
  running = true;
  const controls = Array.from(byId('tool-form').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'));
  controls.forEach(control => { control.disabled = true; });
  refreshFiles();
  status(`正在处理 · ${tools[mode].title}`);
  try {
    success(await desktop.execute({
      mode, ids: selections.map(file => file.id), spec: input('page-spec').value,
      groupSize: Number(input('group-size').value), rotation: Number(select('rotation').value), paper: select('paper').value
    }));
  } catch (error) { errorStatus(error); }
  finally {
    running = false;
    controls.forEach(control => { control.disabled = false; });
    refreshFiles();
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(element => {
  element.onclick = () => setMode(element.dataset.mode as Mode);
});
document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(element => {
  element.onclick = () => {
    document.querySelectorAll('[data-panel]').forEach(item => item.classList.toggle('active', item === element));
    byId('thumbnails').hidden = element.dataset.panel !== 'thumbnails';
    byId('outline').hidden = element.dataset.panel !== 'outline';
    if (element.dataset.panel === 'outline') void renderOutline().catch(errorStatus);
  };
});
click('open-file', () => void pickPdf());
click('home-open', () => void pickPdf());
click('close-file', closeDocument);
click('tool-picker', () => void pickToolFiles());
click('use-current', () => {
  if (current && mode !== 'read' && !running && !selections.some(file => file.id === current?.id)) {
    addFiles([current], 'pdf', tools[mode].multi);
  }
});
byId<HTMLFormElement>('tool-form').onsubmit = event => { void runTool(event); };
click('toggle-sidebar', () => {
  const sidebar = byId('sidebar');
  sidebar.hidden = !sidebar.hidden;
  button('toggle-sidebar').setAttribute('aria-expanded', String(!sidebar.hidden));
});
click('reveal', () => { if (output) void desktop.reveal(output.location).catch(errorStatus); });
click('previous', () => viewer.previousPage());
click('next', () => viewer.nextPage());
click('zoom-in', () => viewer.increaseScale());
click('zoom-out', () => viewer.decreaseScale());
click('rotate', () => { viewer.pagesRotation = (viewer.pagesRotation + 90) % 360; });
click('export-image', () => void exportImage());
click('find', openSearch);
click('find-close', closeSearch);
click('find-prev', () => find(true, true));
click('find-next', () => find(true));
input('search').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => find(), 120);
};
input('search').onkeydown = event => {
  if (event.key === 'Escape') closeSearch();
  if (event.key === 'Enter') {
    clearTimeout(searchTimer);
    find(true, event.shiftKey);
  }
};
input('number').onchange = () => {
  const page = Number(input('number').value);
  if (doc && Number.isInteger(page) && page > 0 && page <= doc.numPages) viewer.currentPageNumber = page;
  else updatePage(viewer.currentPageNumber);
};
input('number').onkeydown = event => { if (event.key === 'Enter') input('number').blur(); };
select('zoom').onchange = () => { viewer.currentScaleValue = select('zoom').value; };
byId('open-key').textContent = navigator.platform.startsWith('Mac') ? '⌘ O' : 'Ctrl+O';

document.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  if (!running) document.body.classList.add('drop-active');
});
document.addEventListener('dragleave', event => {
  if (!event.relatedTarget) document.body.classList.remove('drop-active');
});
document.addEventListener('drop', event => {
  event.preventDefault();
  document.body.classList.remove('drop-active');
  if (running || !event.dataTransfer?.files.length) return;
  const targetMode = mode;
  void desktop.drop(Array.from(event.dataTransfer.files)).then(async files => {
    if (targetMode !== mode || running) { files.forEach(releaseUnused); return; }
    if (mode !== 'read') {
      const tool = tools[mode];
      addFiles(files, tool.kind, tool.multi);
      return;
    }
    const pdf = files.find(file => file.kind === 'pdf');
    if (pdf) {
      files.filter(file => file !== pdf).forEach(releaseUnused);
      await openDocument(pdf);
    } else if (files.length) {
      setMode(files[0].kind === 'image' ? 'image' : 'office');
      const tool = tools[files[0].kind === 'image' ? 'image' : 'office'];
      addFiles(files, tool.kind, tool.multi);
    }
  }).catch(errorStatus);
});

desktop.onFile(file => void openDocument(file));
desktop.onError(errorStatus);
desktop.onMenu(command => {
  if (command === 'open') void pickPdf();
  if (command === 'close') closeDocument();
  if (command === 'find') openSearch();
});
void desktop.ready().catch(errorStatus);

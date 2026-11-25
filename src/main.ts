import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  AnnotationMode, getDocument, GlobalWorkerOptions, PasswordResponses, PDFDataRangeTransport
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import 'lucide-static/font/lucide.css';
import './style.css';
import { applyLanguage, localizedAttribute, localizedText, registerStaticTranslations, translate, type Language } from './i18n';
import { createPageOcr, type RecognizedLine } from './page-ocr';

type Kind = 'pdf' | 'image' | 'office';
type FileInfo = { id: string; kind: Kind; name: string; size: number };
type Output = { name: string; location: string; count?: number; kind?: 'images' };
type ToolResult = Output & { message?: string } | { message: string };
type PdfFormat = 'pages' | 'long' | 'flat' | 'pptx' | 'docx';
type ToolJob = { mode: string; ids: string[]; spec: string; groupSize: number; rotation: number; paper: string };
type PageEdit = { action: 'delete' | 'move' | 'insert'; page?: number; gap?: number };
type UpdateProgress = { version: string; phase: 'download' | 'install'; percent: number | null };
type UpdatePrompt = {
  id: string;
  type: 'info' | 'error';
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
};
type Bridge = {
  canRecognizePages: boolean;
  recognizePage(bytes: Uint8Array): Promise<RecognizedLine[]>;
  setToolSidebarHidden(hidden: boolean): Promise<void>;
  openFeedback(): Promise<void>;
  printDocument(): Promise<boolean>;
  pick(kind: Kind, multi: boolean): Promise<FileInfo[]>;
  drop(files: File[]): Promise<FileInfo[]>;
  read(id: string, start: number, end: number): Promise<Uint8Array>;
  release(id: string): Promise<void>;
  pageMenu(id: string, canDelete: boolean): Promise<'before' | 'after' | 'delete' | null>;
  editPages(id: string, edit: PageEdit & { ids: string[] }): Promise<FileInfo>;
  saveEditedPdf(id: string): Promise<Output | null>;
  execute(job: ToolJob): Promise<ToolResult | null>;
  saveImage(name: string, data: Uint8Array): Promise<Output | null>;
  beginImages(id: string, spec: string, count: number, format: PdfFormat): Promise<{ token: string; pages: number[] } | null>;
  writeImage(token: string, data: Uint8Array | string, width?: number, height?: number): Promise<void>;
  finishImages(token: string): Promise<Output>;
  cancelImages(token: string): Promise<void>;
  reveal(path: string): Promise<void>;
  onFile(callback: (file: FileInfo) => void): void;
  onError(callback: (error: string) => void): void;
  answerUpdatePrompt(id: string, choice: number): Promise<void>;
  onUpdatePrompt(callback: (prompt: UpdatePrompt) => void): void;
  onUpdateProgress(callback: (progress: UpdateProgress | null) => void): void;
  onMenu(callback: (command: string) => void): void;
  getLanguage(): Promise<Language>;
  onLanguage(callback: (language: Language) => void): void;
  ready(): Promise<void>;
};
const desktop = (window as Window & { desktop?: Bridge }).desktop!;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => byId<HTMLInputElement>(id);
const select = (id: string) => byId<HTMLSelectElement>(id);
const button = (id: string) => byId<HTMLButtonElement>(id);
const click = (id: string, action: () => void) => { button(id).onclick = action; };
const toolSidebar = byId('tool-sidebar');
const toolSidebarToggle = button('toggle-tool-sidebar');

function setToolSidebarHidden(hidden: boolean) {
  toolSidebar.hidden = hidden;
  const label = hidden ? '显示工具栏' : '隐藏工具栏';
  localizedAttribute(toolSidebarToggle, 'title', label);
  localizedAttribute(toolSidebarToggle, 'aria-label', label);
  toolSidebarToggle.setAttribute('aria-expanded', String(!hidden));
  toolSidebarToggle.querySelector('i')!.className = hidden ? 'icon icon-panel-left-open' : 'icon icon-panel-left-close';
}

registerStaticTranslations();
let languageChanged = false;
desktop.onLanguage(language => {
  languageChanged = true;
  applyLanguage(language);
});
const preferredLanguage = await desktop.getLanguage();
if (!languageChanged) applyLanguage(preferredLanguage);
setToolSidebarHidden(toolSidebar.hidden);

click('toggle-tool-sidebar', () => {
  setToolSidebarHidden(!toolSidebar.hidden);
  void desktop.setToolSidebarHidden(toolSidebar.hidden).catch(error => status(error.message));
});

const sizeText = (size: number) => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

const tools = {
  merge: { title: '合并 PDF', icon: 'layers', kind: 'pdf', multi: true, description: '按列表顺序把多份 PDF 合成一份。', hint: '至少添加两份 PDF', submit: '合并并保存' },
  split: { title: '拆分 PDF', icon: 'scissors', kind: 'pdf', multi: false, description: '按固定页数把一份 PDF 分成多个文件。', hint: '支持指定页码范围', submit: '选择目录并拆分' },
  extract: { title: '提取页面', icon: 'files', kind: 'pdf', multi: false, description: '把选中的页面导出为一份新 PDF。', hint: '选择一份 PDF', submit: '提取并保存' },
  organize: { title: '整理页面', icon: 'layout-grid', kind: 'pdf', multi: false, description: '按指定顺序排列页面，可删除不需要的页或旋转导出的页。', hint: '选择一份 PDF', submit: '保存整理后的 PDF' },
  raster: { title: 'PDF 转换', icon: 'images', kind: 'pdf', multi: false, description: '选择输出格式，转换全部或指定页面。', hint: '选择一份 PDF', submit: '选择目录并导出' },
  image: { title: '图片转 PDF', icon: 'image-plus', kind: 'image', multi: true, description: '按列表顺序把图片合成一份 PDF，每张图片一页。', hint: 'JPG、JPEG、PNG', submit: '转换并保存' },
  office: { title: '文档转 PDF', icon: 'file-type', kind: 'office', multi: false, description: '通过本机安装的 LibreOffice 将文档导出为 PDF。', hint: 'Word、Excel、PowerPoint、OpenDocument、RTF、TXT', submit: '转换并保存' }
} as const;

type Mode = 'read' | keyof typeof tools;
const toolSuccessLabels: Record<Exclude<Mode, 'read' | 'raster'> | PdfFormat, string> = {
  merge: '合并完成',
  split: '拆分完成',
  extract: '页面已提取',
  organize: '整理完成',
  pages: '逐页图已导出',
  long: '长图已保存',
  flat: '纯图 PDF 已保存',
  pptx: 'PPT 已保存',
  docx: 'Word 已保存',
  image: '图片已转为 PDF',
  office: '文档已转为 PDF'
};

let mode: Mode = 'read';
let pdfFormat: PdfFormat = 'pages';
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
const pageHistory: { file: FileInfo; page: number }[] = [];
let savedPageVersion: string | null = null;
let initialPage = 1;
let previewView: { page: number; scale: string; rotation: number; scrollLeft: number; offset: number; thumbnailScroll: number } | null = null;
let removePreviewSnapshot: (() => void) | null = null;
let draggedPage: number | null = null;
const thumbnails = byId('thumbnails');
let searchTimer = 0;
let exporting = false;
let printing = false;
let cancelImageRequested = false;
let imageRender: PageRender | null = null;
let imageLoading: ReturnType<typeof getDocument> | null = null;

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
const pageOcr = desktop.canRecognizePages
  ? createPageOcr(viewer.container, bytes => desktop.recognizePage(bytes))
  : null;
if (pageOcr) {
  bus.on('textlayerrendered', ({ source, error }) => {
    if (!error) pageOcr.observe(source);
  });
}

function status(message: string, error = false, result: Output | null = null) {
  output = result;
  const text = byId('status-text');
  localizedText(text, message);
  localizedAttribute(text, 'title', message);
  text.parentElement?.classList.toggle('error', error);
  button('reveal').hidden = !output;
}

function errorStatus(error: unknown) {
  status(error instanceof Error ? error.message : String(error), true);
}

let successToastTimer = 0;

function showSuccessToast(label: string) {
  const toast = byId('success-toast');
  localizedText(byId('success-toast-text'), label);
  toast.hidden = false;
  window.clearTimeout(successToastTimer);
  successToastTimer = window.setTimeout(() => { toast.hidden = true; }, 1600);
}

function success(result: ToolResult | null, label: string) {
  if (result && 'message' in result && result.message) {
    if ('location' in result) {
      status(result.message, false, result);
      showSuccessToast('下载成功');
    } else {
      status(result.message);
    }
    return;
  }
  if (!result || !('location' in result)) return status('已取消保存。');
  status(result.kind === 'images' ? `已导出 ${result.count} 张 PNG 图片` :
    result.count ? `已导出 ${result.count} 份 PDF` : `已保存 ${result.name}`, false, result);
  showSuccessToast(label);
}

function refreshSection() {
  byId('home').hidden = mode !== 'read' || !!doc;
  byId('reader').hidden = mode !== 'read' || !doc;
  byId('tools').hidden = mode === 'read';
  const title = byId('section-title');
  if (mode === 'read' && current) title.textContent = current.name;
  else localizedText(title, mode === 'read' ? '阅读 PDF' : mode === 'raster' ? pdfFormats[pdfFormat].title : tools[mode].title);
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(node => {
    const active = node.dataset.mode === mode && (mode !== 'raster' || node.dataset.pdfFormat === pdfFormat);
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  if (mode !== 'read') button('use-current').hidden = !doc || tools[mode].kind !== 'pdf';
}

function refreshPageEditing() {
  button('undo-page-edit').hidden = !pageHistory.length;
  button('save-page-edit').hidden = !pageHistory.length;
}

function resetPageEditing() {
  for (const entry of pageHistory.splice(0)) releaseUnused(entry.file);
  savedPageVersion = null;
  refreshPageEditing();
}

function hasUnsavedPageEdits() {
  return pageHistory.length > 0 && current?.id !== savedPageVersion;
}

function confirmDiscardEdits() {
  return !hasUnsavedPageEdits() || window.confirm(translate('页面改动尚未另存。要放弃改动吗？'));
}

window.addEventListener('beforeunload', event => {
  if (!hasUnsavedPageEdits()) return;
  event.preventDefault();
  event.returnValue = '';
});

function releaseUnused(file: FileInfo) {
  if (file.id !== current?.id && !selections.some(item => item.id === file.id) &&
      !pageHistory.some(entry => entry.file.id === file.id)) {
    void desktop.release(file.id).catch(() => {});
  }
}

function setMode(next: Mode, format = pdfFormat) {
  if (next === mode && (next !== 'raster' || format === pdfFormat)) return;
  if (running) { status('正在处理文件，请稍候。'); return; }
  if (next === 'raster') {
    pdfFormat = format;
    if (mode === 'raster') {
      refreshSection();
      refreshPdfFormat();
      showToolSelectionStatus();
      return;
    }
  }
  const previous = selections;
  selections = [];
  for (const file of previous) releaseUnused(file);
  mode = next;
  refreshSection();
  if (mode === 'read') {
    if (current && doc) showDocumentStatus(current, doc.numPages);
    else status('就绪');
    return;
  }
  const tool = tools[mode];
  byId('tool-icon').replaceChildren(icon(tool.icon));
  localizedText(byId('tool-title'), tool.title);
  localizedText(byId('tool-description'), tool.description);
  localizedText(byId('pick-label'), tool.multi ? '添加文件或拖到此处' : '选择文件或拖到此处');
  localizedText(byId('pick-hint'), tool.hint);
  localizedText(byId('run-label'), tool.submit);
  byId('page-options').hidden = !['split', 'extract', 'organize'].includes(mode);
  byId('image-range-options').hidden = mode !== 'raster';
  localizedText(byId('page-spec-label'), mode === 'raster' ? '页码范围' : '页码范围或新顺序');
  localizedAttribute(input('page-spec'), 'placeholder', mode === 'raster' ? '例如 2 或 1-3, 5' : '例如 1-3, 5, 8-6');
  byId('split-options').hidden = mode !== 'split';
  byId('rotation-options').hidden = mode !== 'organize';
  byId('paper-options').hidden = mode !== 'image';
  (byId('tool-form') as HTMLFormElement).reset();
  if (mode === 'raster') refreshPdfFormat();
  refreshFiles();
  showToolSelectionStatus();
}

function clearReader(preserveSearch = false) {
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  for (const render of thumbnailTasks.values()) render.cancel();
  thumbnailTasks.clear();
  thumbActive = null;
  draggedPage = null;
  clearPageDrop();
  byId('thumbnails').replaceChildren();
  byId('outline').replaceChildren();
  outlineLoaded = false;
  if (preserveSearch) {
    clearTimeout(searchTimer);
    localizedText(byId('matches'), '');
  } else {
    input('search').value = '';
    closeSearch();
  }
  const dialog = byId<HTMLDialogElement>('password-dialog');
  if (dialog.open) dialog.close('cancel');
  pageOcr?.reset();
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

function holdPreviewUntilRendered() {
  const body = viewer.container.closest<HTMLElement>('.reading-body')!;
  const snapshot = body.cloneNode(true) as HTMLElement;
  snapshot.classList.add('preview-snapshot');
  snapshot.inert = true;
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  // Keep the currently drawn PDF and thumbnail canvases visible while the new preview renders.
  const originalCanvases = body.querySelectorAll('canvas');
  snapshot.querySelectorAll('canvas').forEach((canvas, index) => {
    const original = originalCanvases[index];
    if (original.width > 1 && original.height > 1) canvas.getContext('2d')?.drawImage(original, 0, 0);
  });
  const scrollPositions = Array.from(body.querySelectorAll('.viewer-scroll, .side-content'), element =>
    [element.scrollLeft, element.scrollTop] as const);
  body.append(snapshot);
  snapshot.querySelectorAll('.viewer-scroll, .side-content').forEach((element, index) => {
    [element.scrollLeft, element.scrollTop] = scrollPositions[index];
  });
  let timeout = 0;
  const remove = () => {
    window.clearTimeout(timeout);
    bus.off('pagerendered', finish);
    snapshot.remove();
    removePreviewSnapshot = null;
  };
  const finish = ({ pageNumber, cssTransform }: { pageNumber: number; cssTransform: boolean }) => {
    if (pageNumber === viewer.currentPageNumber && !cssTransform) remove();
  };
  removePreviewSnapshot = remove;
  bus.on('pagerendered', finish);
  timeout = window.setTimeout(remove, 4000);
}

function showDocumentStatus(file: FileInfo, pageCount: number) {
  status(`${file.name} · ${pageCount} 页 · ${sizeText(file.size)}`);
}

async function openDocument(file: FileInfo, page?: number) {
  if (running) {
    releaseUnused(file);
    return status('正在处理文件，请稍候。');
  }
  if (page === undefined) {
    if (!confirmDiscardEdits()) { releaseUnused(file); return; }
    resetPageEditing();
  }
  removePreviewSnapshot?.();
  const preserveView = page !== undefined && doc && mode === 'read';
  previewView = preserveView ? {
    page: viewer.currentPageNumber,
    scale: viewer.currentScaleValue,
    rotation: viewer.pagesRotation,
    scrollLeft: viewer.container.scrollLeft,
    offset: viewer.container.scrollTop - (viewer.getPageView(viewer.currentPageNumber - 1)?.div.offsetTop ?? 0),
    thumbnailScroll: thumbnails.scrollTop
  } : null;
  if (preserveView) holdPreviewUntilRendered();
  const version = ++loadVersion;
  clearReader(!!preserveView);
  initialPage = page ?? 1;
  current = file;
  setMode('read');
  if (!preserveView) {
    refreshSection();
    status(`正在打开 ${file.name}…`);
  }
  try {
    const transport = new class extends PDFDataRangeTransport {
      requestDataRange(start: number, end: number) {
        void desktop.read(file.id, start, end).then(data => {
          if (version === loadVersion) this.onDataRange(start, data);
        }).catch(error => {
          if (version !== loadVersion) return;
          ++loadVersion;
          removePreviewSnapshot?.();
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
      localizedText(byId('password-title'), reason === PasswordResponses.INCORRECT_PASSWORD ? '密码有误，请重新输入' : '输入 PDF 密码');
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
    if (mode === 'read') showDocumentStatus(file, loaded.numPages);
  } catch (error) {
    if (version !== loadVersion) return;
    removePreviewSnapshot?.();
    clearReader();
    refreshSection();
    status(error instanceof Error && error.name === 'InvalidPDFException'
      ? '无法打开这个 PDF。请确认文件完整。' : `打开失败：${error instanceof Error ? error.message : String(error)}`, true);
  }
}

function closeDocument() {
  if (running || !current || !confirmDiscardEdits()) return;
  resetPageEditing();
  ++loadVersion;
  removePreviewSnapshot?.();
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
  revealActiveThumbnail();
}

function revealActiveThumbnail() {
  if (!thumbActive?.getClientRects().length) return;
  const options = { block: 'nearest', inline: 'nearest', container: 'nearest' } as const;
  thumbActive.scrollIntoView(options);
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
    localizedAttribute(thumb, 'aria-label', `第 ${number} 页`);
    thumb.onclick = () => { viewer.currentPageNumber = number; };
    thumb.draggable = true;
    thumb.ondragstart = event => {
      if (running || !event.dataTransfer) { event.preventDefault(); return; }
      draggedPage = number - 1;
      event.dataTransfer.setData('application/x-pdfsee-page', String(number));
      event.dataTransfer.effectAllowed = 'move';
    };
    thumb.ondragend = () => { draggedPage = null; clearPageDrop(); };
    thumb.oncontextmenu = event => {
      event.preventDefault();
      void showPageMenu(number - 1).catch(errorStatus);
    };
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.page = String(number);
    const label = document.createElement('span');
    label.className = 'thumb-number';
    label.textContent = String(number);
    thumb.append(canvas, label);
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
  if (!entries?.length) { localizedText(target, '此文档没有目录。'); return; }
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
  localizedText(byId('matches'), '');
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
  localizedText(byId('matches'), !input('search').value || !matchesCount
    ? '' : matchesCount.total ? `${matchesCount.current} / ${matchesCount.total}` : '无匹配');
}

bus.on('pagesinit', () => {
  const view = previewView;
  previewView = null;
  if (view) viewer.pagesRotation = view.rotation;
  viewer.currentScaleValue = view?.scale || 'auto';
  if (doc) viewer.currentPageNumber = Math.min(initialPage, doc.numPages);
  if (view) {
    viewer.container.scrollLeft = view.scrollLeft;
    const page = viewer.getPageView(viewer.currentPageNumber - 1);
    if (page && view.page === viewer.currentPageNumber) {
      viewer.container.scrollTop = page.div.offsetTop + Math.max(0, Math.min(view.offset, page.div.offsetHeight - 1));
    }
    thumbnails.scrollTop = view.thumbnailScroll;
    if (!byId('find-bar').hidden && input('search').value) find();
  }
  updatePage(viewer.currentPageNumber);
});
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
  if (state === 3 && input('search').value) localizedText(byId('matches'), '搜索中…');
  else findCount({ matchesCount });
});

async function printDocument() {
  if (printing) return;
  const source = doc;
  if (!source || mode !== 'read') {
    status('请先打开要打印的 PDF。');
    return;
  }

  printing = true;
  const control = button('print-document');
  control.disabled = true;
  const container = byId('print-pages');
  const pageStyles = document.createElement('style');
  document.head.append(pageStyles);
  const paperSizes = new Map<string, string>();
  const urls: string[] = [];
  const canvas = document.createElement('canvas');
  const rotation = viewer.pagesRotation;
  const active = () => doc === source && mode === 'read';

  try {
    status('正在准备打印…');
    const permissions = await source.getPermissions();
    const { PRINT, PRINT_HIGH_QUALITY } = pdfjs.PermissionFlag;
    if (permissions && !permissions.includes(PRINT) && !permissions.includes(PRINT_HIGH_QUALITY)) {
      throw new Error('这份 PDF 禁止打印。');
    }

    const dpi = !permissions || permissions.includes(PRINT_HIGH_QUALITY) ? 160 : 150;
    const printAnnotationStorage = source.annotationStorage.print;
    for (let number = 1; number <= source.numPages; number++) {
      if (!active()) return;
      status(`正在准备打印 · ${number} / ${source.numPages}`);
      const page = await source.getPage(number);
      if (!active()) return;
      const angle = (page.rotate + rotation) % 360;
      const paper = page.getViewport({ scale: 1, rotation: angle });
      const scale = Math.min(dpi / 72, 5000 / Math.max(paper.width, paper.height),
        Math.sqrt(16000000 / (paper.width * paper.height)));
      const viewport = page.getViewport({ scale, rotation: angle });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, intent: 'print', background: '#fff',
        annotationMode: AnnotationMode.ENABLE_STORAGE, printAnnotationStorage }).promise;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!active()) return;
      if (!blob) throw new Error('无法准备打印页面。');

      const width = `${paper.width.toFixed(3)}pt`;
      const height = `${paper.height.toFixed(3)}pt`;
      const size = `${width} ${height}`;
      let pageName = paperSizes.get(size);
      if (!pageName) {
        pageName = `pdfsee-paper-${paperSizes.size}`;
        paperSizes.set(size, pageName);
        pageStyles.sheet!.insertRule(`@page ${pageName} { size: ${size}; margin: 0; }`);
      }
      const sheet = document.createElement('div');
      sheet.style.setProperty('page', pageName);
      sheet.style.setProperty('--paper-width', width);
      sheet.style.setProperty('--paper-height', height);
      const image = new Image();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      image.src = url;
      await image.decode();
      sheet.append(image);
      container.append(sheet);
    }

    if (!active()) return;
    const sent = await desktop.printDocument();
    if (active()) {
      status(sent ? '已提交打印。' : '已取消打印。');
      if (sent) showSuccessToast('已提交打印');
    }
  } catch (error) {
    if (active()) errorStatus(error);
  } finally {
    container.replaceChildren();
    pageStyles.remove();
    urls.forEach(url => URL.revokeObjectURL(url));
    canvas.width = canvas.height = 1;
    printing = false;
    control.disabled = false;
  }
}

async function canvasPng(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('无法生成 PNG。');
  return new Uint8Array(await blob.arrayBuffer());
}

type PdfPage = Awaited<ReturnType<NonNullable<typeof doc>['getPage']>>;

async function renderPageCanvas(page: PdfPage, view: ReturnType<PdfPage['getViewport']>, canvas: HTMLCanvasElement, batch: boolean) {
  canvas.width = Math.max(1, Math.ceil(view.width));
  canvas.height = Math.max(1, Math.ceil(view.height));
  const rendering = page.render({ canvas, viewport: view, background: '#ffffff' });
  if (batch) imageRender = rendering;
  try { await rendering.promise; }
  finally { if (batch) imageRender = null; }
}

async function renderPng(page: PdfPage, rotation = page.rotate, batch = false) {
  const initial = page.getViewport({ scale: 1, rotation });
  const scale = Math.min(2, 5000 / Math.max(initial.width, initial.height), Math.sqrt(16000000 / (initial.width * initial.height)));
  const canvas = document.createElement('canvas');
  try {
    await renderPageCanvas(page, page.getViewport({ scale, rotation }), canvas, batch);
    return await canvasPng(canvas);
  } finally {
    canvas.width = canvas.height = 1;
  }
}

async function longImage(source: NonNullable<typeof doc>, pages: number[], checkCanceled: () => void, cleanup: boolean) {
  const sizes = [];
  let width = 0;
  let height = 0;
  for (const index of pages) {
    checkCanceled();
    const page = await source.getPage(index + 1);
    const view = page.getViewport({ scale: 1 });
    sizes.push(view);
    width = Math.max(width, view.width);
    height += view.height;
    if (cleanup) page.cleanup();
  }
  const scale = Math.min(2, 5000 / width, (30000 - pages.length) / height,
    Math.sqrt(24000000 / (width * height)));
  if (scale <= 0 || (width * scale < 320 && pages.length > 1)) {
    throw new Error('所选页面太多，长图会过窄。请缩小页码范围后重试。');
  }
  const output = document.createElement('canvas');
  const temp = document.createElement('canvas');
  output.width = Math.max(1, Math.ceil(width * scale));
  output.height = sizes.reduce((sum, view) => sum + Math.ceil(view.height * scale), 0);
  const context = output.getContext('2d');
  if (!context) throw new Error('无法创建长图。');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, output.width, output.height);
  try {
    let y = 0;
    for (const [i, index] of pages.entries()) {
      checkCanceled();
      status(`正在拼接 · ${i + 1} / ${pages.length}`);
      const page = await source.getPage(index + 1);
      try {
        checkCanceled();
        await renderPageCanvas(page, page.getViewport({ scale }), temp, true);
        context.drawImage(temp, Math.floor((output.width - temp.width) / 2), y);
        y += temp.height;
      } finally { if (cleanup) page.cleanup(); }
    }
    checkCanceled();
    return await canvasPng(output);
  } finally {
    output.width = output.height = temp.width = temp.height = 1;
  }
}

const pdfFormats: Record<PdfFormat, { title: string; icon: string; hint: string; action: string }> = {
  pages: { title: 'PDF 逐页转图', icon: 'images', hint: '每页一张 PNG，文件名保留原始页码。', action: '选择目录并导出' },
  long: { title: 'PDF 转长图', icon: 'rectangle-vertical', hint: '将页面按顺序纵向拼接为一张 PNG。', action: '保存长图' },
  flat: { title: 'PDF 转纯图 PDF', icon: 'file-image', hint: '保留页面尺寸和外观，文字无法搜索或复制。', action: '保存纯图 PDF' },
  pptx: { title: 'PDF 转 PPT', icon: 'presentation', hint: '每页作为一张图片放入幻灯片，文字和图形不单独编辑。', action: '保存 PPT' },
  docx: { title: 'PDF 转 Word', icon: 'file-text', hint: '提取 PDF 内已有的文字。图片、表格结构和原排版不保留，扫描件需要 OCR。', action: '保存 Word' }
};

function refreshPdfFormat() {
  const format = pdfFormats[pdfFormat];
  localizedText(byId('tool-title'), format.title);
  localizedText(byId('tool-description'), format.hint);
  byId('tool-icon').replaceChildren(icon(format.icon));
  localizedText(byId('run-label'), format.action);
}

async function exportImage() {
  if (!doc || exporting || running) return;
  exporting = true;
  const active = doc;
  const number = viewer.currentPageNumber;
  const viewRotation = viewer.pagesRotation;
  const name = current!.name.replace(/\.pdf$/i, '');
  try {
    const page = await active.getPage(number);
    const rotation = (page.rotate + viewRotation) % 360;
    const bytes = await renderPng(page, rotation);
    if (active !== doc || mode !== 'read') return;
    success(await desktop.saveImage(`${name}-第${number}页.png`, bytes), '当前页已导出');
  } catch (error) { errorStatus(error); }
  finally { exporting = false; }
}

async function exportImages() {
  const file = selections[0];
  let loading: ReturnType<typeof getDocument> | null = null;
  let token: string | null = null;
  cancelImageRequested = false;
  const checkCanceled = () => {
    if (cancelImageRequested) throw new DOMException('已取消转换。', 'AbortError');
  };
  try {
    let source = current?.id === file.id ? doc : null;
    if (!source) {
      let readError: unknown;
      const transport = new class extends PDFDataRangeTransport {
        requestDataRange(start: number, end: number) {
          void desktop.read(file.id, start, end).then(data => this.onDataRange(start, data)).catch(error => {
            readError = error;
            void loading?.destroy();
          });
        }
      }(file.size, null, true);
      loading = getDocument({
        range: transport, rangeChunkSize: 256 * 1024, disableStream: true,
        cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'),
        wasmUrl: asset('wasm'), iccUrl: asset('iccs'), isEvalSupported: false, enableXfa: false,
        useSystemFonts: true, docBaseUrl: document.baseURI
      });
      imageLoading = loading;
      loading.onPassword = () => {
        readError = new Error('此 PDF 已加密，请先在阅读器中打开并解锁，再选择“使用正在阅读的 PDF”。');
        void loading?.destroy();
      };
      try { source = await loading.promise; }
      catch (error) { throw readError ?? error; }
    }
    checkCanceled();
    const spec = select('image-range').value === 'all' ? '' : input('page-spec').value;
    if (select('image-range').value === 'custom' && !spec.trim()) throw new Error('请输入要导出的页码，例如 2 或 1-3, 5。');
    const format = pdfFormat;
    const session = await desktop.beginImages(file.id, spec, source.numPages, format);
    if (!session) return null;
    token = session.token;

    if (format === 'long') {
      const image = await longImage(source, session.pages, checkCanceled, !!loading);
      checkCanceled();
      await desktop.writeImage(token, image);
    } else {
      for (const [index, pageIndex] of session.pages.entries()) {
        checkCanceled();
        const number = pageIndex + 1;
        status(`正在转换第 ${number} 页 · ${index + 1} / ${session.pages.length}`);
        const page = await source.getPage(number);
        try {
          checkCanceled();
          if (format === 'docx') {
            const { items } = await page.getTextContent();
            const text = items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')
              .join('').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trimEnd();
            checkCanceled();
            await desktop.writeImage(token, text);
          } else {
            const size = page.getViewport({ scale: 1 });
            const bytes = await renderPng(page, page.rotate, true);
            checkCanceled();
            await desktop.writeImage(token, bytes, size.width, size.height);
          }
        } finally { if (loading) page.cleanup(); }
      }
    }
    checkCanceled();
    button('cancel-images').hidden = true;
    status('正在保存…');
    const result = await desktop.finishImages(token);
    token = null;
    return result;
  } catch (error) {
    checkCanceled();
    throw error;
  } finally {
    try { if (token) await desktop.cancelImages(token).catch(() => {}); }
    finally { imageLoading = null; await loading?.destroy(); }
  }
}

function listAction(label: string, glyph: string, action: () => void, disabled = false) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'square';
  localizedAttribute(control, 'title', label);
  localizedAttribute(control, 'aria-label', label);
  control.disabled = disabled;
  control.append(icon(glyph));
  control.onclick = action;
  return control;
}

function showToolSelectionStatus() {
  const count = selections.length;
  if (mode === 'merge' && count < 2) status(`已添加 ${count} 份 PDF，至少需要 2 份。`);
  else status(count ? `已选择 ${count} 个文件` : '尚未添加文件。');
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
      showToolSelectionStatus();
    }, running));
    list.append(item);
  });
  button('run-tool').disabled = running || selections.length < (mode === 'merge' ? 2 : 1);
  button('tool-picker').disabled = running;
  button('use-current').disabled = running;
  if (mode === 'raster') {
    const count = doc && current && selections[0]?.id === current.id ? `文档共有 ${doc.numPages} 页。` : '';
    localizedText(byId('spec-hint'), `${count}输入单个页码或页码范围，每个页面只导出一次。`);
  } else if (doc && current && selections[0]?.id === current.id) {
    localizedText(byId('spec-hint'), `文档共有 ${doc.numPages} 页。留空使用全部页面。`);
  } else {
    localizedText(byId('spec-hint'), '留空使用全部页面。可按你输入的顺序导出。');
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
  showToolSelectionStatus();
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
  button('cancel-images').hidden = mode !== 'raster';
  const controls = Array.from(byId('tool-form').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'));
  controls.forEach(control => { control.disabled = true; });
  refreshFiles();
  status(`正在处理 · ${mode === 'raster' ? pdfFormats[pdfFormat].title : tools[mode].title}`);
  const successLabel = toolSuccessLabels[mode === 'raster' ? pdfFormat : mode];
  try {
    success(mode === 'raster' ? await exportImages() : await desktop.execute({
      mode, ids: selections.map(file => file.id), spec: input('page-spec').value,
      groupSize: Number(input('group-size').value), rotation: Number(select('rotation').value), paper: select('paper').value
    }), successLabel);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') status('已取消转换。');
    else errorStatus(error);
  }
  finally {
    running = false;
    button('cancel-images').hidden = true;
    controls.forEach(control => { control.disabled = false; });
    refreshFiles();
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(element => {
  element.onclick = () => setMode(element.dataset.mode as Mode, element.dataset.pdfFormat as PdfFormat | undefined);
});
document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(element => {
  element.onclick = () => {
    document.querySelectorAll('[data-panel]').forEach(item => item.classList.toggle('active', item === element));
    byId('thumbnails').hidden = element.dataset.panel !== 'thumbnails';
    byId('outline').hidden = element.dataset.panel !== 'outline';
    if (element.dataset.panel === 'outline') void renderOutline().catch(errorStatus);
    else revealActiveThumbnail();
  };
});
click('open-feedback', () => { void desktop.openFeedback().catch(errorStatus); });
click('open-file', () => void pickPdf());
click('home-open', () => void pickPdf());
click('close-file', closeDocument);
click('tool-picker', () => void pickToolFiles());
click('use-current', () => {
  if (current && mode !== 'read' && !running && !selections.some(file => file.id === current?.id)) {
    addFiles([current], 'pdf', tools[mode].multi);
  }
});
select('image-range').onchange = () => {
  byId('page-options').hidden = select('image-range').value !== 'custom';
  if (!byId('page-options').hidden) input('page-spec').focus();
};
click('cancel-images', () => {
  cancelImageRequested = true;
  imageRender?.cancel();
  void imageLoading?.destroy();
  status('正在取消转换…');
});
byId<HTMLFormElement>('tool-form').onsubmit = event => { void runTool(event); };
click('toggle-sidebar', () => {
  const sidebar = byId('sidebar');
  sidebar.hidden = !sidebar.hidden;
  button('toggle-sidebar').setAttribute('aria-expanded', String(!sidebar.hidden));
  if (!sidebar.hidden) revealActiveThumbnail();
});
click('reveal', () => { if (output) void desktop.reveal(output.location).catch(errorStatus); });
click('previous', () => viewer.previousPage());
click('next', () => viewer.nextPage());
click('zoom-in', () => viewer.increaseScale());
click('zoom-out', () => viewer.decreaseScale());
click('rotate', () => { viewer.pagesRotation = (viewer.pagesRotation + 90) % 360; });
click('print-document', () => void printDocument());
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

async function editReaderPages(edit: PageEdit, targetPage: number, getFiles?: () => Promise<FileInfo[]>) {
  if (running || exporting || printing || !current || !doc || removePreviewSnapshot) return;
  const previous = { file: current, page: viewer.currentPageNumber };
  let files: FileInfo[] = [];
  let preview: FileInfo | undefined;
  running = true;
  try {
    if (getFiles) {
      files = await getFiles();
      if (!files.length) return;
      if (files.some(file => file.kind !== 'pdf')) throw new Error('请仅拖入 PDF 文件。');
    }
    status('正在更新页面…');
    preview = await desktop.editPages(previous.file.id, { ...edit, ids: files.map(file => file.id) });
    pageHistory.push(previous);
  } catch (error) {
    errorStatus(error);
  } finally {
    files.forEach(releaseUnused);
    running = false;
  }
  if (!preview) return;
  const previewVersion = loadVersion + 1;
  await openDocument(preview, targetPage);
  if (loadVersion !== previewVersion) return;
  if (!doc) {
    pageHistory.pop();
    await openDocument(previous.file, previous.page);
  }
  refreshPageEditing();
}

async function showPageMenu(page: number) {
  if (running || !current || !doc) return;
  const id = current.id;
  const action = await desktop.pageMenu(id, doc.numPages > 1);
  if (!action || current?.id !== id) return;
  if (action === 'delete') {
    await editReaderPages({ action, page }, page + 1);
    return;
  }
  const gap = action === 'before' ? page : page + 1;
  await editReaderPages({ action: 'insert', gap }, gap + 1, () => desktop.pick('pdf', true));
}

click('undo-page-edit', () => {
  if (running || exporting || printing || !doc || removePreviewSnapshot) return;
  const previous = pageHistory.pop();
  if (previous) void openDocument(previous.file, previous.page).then(refreshPageEditing);
});
click('save-page-edit', () => {
  if (running || exporting || printing || !current || !doc || removePreviewSnapshot || !pageHistory.length) return;
  const id = current.id;
  running = true;
  void desktop.saveEditedPdf(id).then(result => {
    if (result) savedPageVersion = id;
    success(result, '已另存 PDF');
  }).catch(errorStatus).finally(() => { running = false; });
});

function clearPageDrop() {
  thumbnails.querySelector('.drop-before, .drop-after')?.classList.remove('drop-before', 'drop-after');
}

function pageDropPosition(event: DragEvent) {
  const target = event.target;
  if (!(target instanceof Element) || !thumbnails.contains(target)) return null;
  const thumb = target.closest<HTMLElement>('.thumb');
  const anchor = thumb ?? Array.from(thumbnails.children).find(element => event.clientY < element.getBoundingClientRect().bottom)
    ?? thumbnails.lastElementChild;
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const after = event.clientY >= (rect.top + rect.bottom) / 2;
  return { anchor, after, gap: Number(anchor.id.slice('thumb-'.length)) - (after ? 0 : 1) };
}

thumbnails.addEventListener('dragover', event => {
  const external = event.dataTransfer?.types.includes('Files');
  if ((!external && draggedPage === null) || !event.dataTransfer) return;
  event.preventDefault();
  event.stopPropagation();
  document.body.classList.remove('drop-active');
  clearPageDrop();
  event.dataTransfer.dropEffect = running ? 'none' : external ? 'copy' : 'move';
  if (running) return;
  const bounds = thumbnails.getBoundingClientRect();
  if (event.clientY < bounds.top + 24) thumbnails.scrollTop -= 12;
  else if (event.clientY > bounds.bottom - 24) thumbnails.scrollTop += 12;
  const position = pageDropPosition(event);
  position?.anchor.classList.add(position.after ? 'drop-after' : 'drop-before');
});

thumbnails.addEventListener('dragleave', event => {
  if (!(event.relatedTarget instanceof Node) || !thumbnails.contains(event.relatedTarget)) clearPageDrop();
});

thumbnails.addEventListener('drop', event => {
  event.preventDefault();
  event.stopPropagation();
  clearPageDrop();
  const position = pageDropPosition(event);
  if (!position) return;
  const { gap } = position;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) {
    void editReaderPages({ action: 'insert', gap }, gap + 1, () => desktop.drop(files));
  } else if (draggedPage !== null && gap !== draggedPage && gap !== draggedPage + 1) {
    const page = draggedPage;
    void editReaderPages({ action: 'move', page, gap }, gap > page ? gap : gap + 1);
  }
  draggedPage = null;
});

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
desktop.onUpdatePrompt(prompt => {
  const dialog = byId<HTMLDialogElement>('update-dialog');
  const detail = byId('update-detail');
  localizedText(byId('update-title'), prompt.message);
  localizedText(detail, prompt.detail ?? '');
  detail.hidden = !prompt.detail;
  const labels = prompt.buttons ?? ['确定'];
  const primary = prompt.defaultId ?? 0;
  const order = labels.map((_, index) => index).reverse();
  byId('update-icon').className = `icon icon-${prompt.type === 'error' ? 'circle-alert' : prompt.buttons ? 'arrow-down-to-line' : 'info'}`;
  const actions = order.map(index => {
    const action = document.createElement('button');
    action.className = index === primary ? 'button primary' : index === 2 ? 'update-ignore' : 'button secondary';
    action.value = String(index);
    localizedText(action, labels[index]);
    action.autofocus = index === primary;
    return action;
  });
  byId('update-actions').replaceChildren(...actions);
  dialog.returnValue = String(prompt.cancelId ?? 0);
  dialog.onclose = () => {
    void desktop.answerUpdatePrompt(prompt.id, Number(dialog.returnValue)).catch(errorStatus);
  };
  if (!dialog.open) dialog.showModal();
});
desktop.onUpdateProgress(progress => {
  byId('update-progress').hidden = !progress;
  if (!progress) return;
  const { version, phase, percent } = progress;
  const label = phase === 'download' ? `正在下载 ${version}` : `正在准备安装 ${version}`;
  localizedText(byId('update-label'), percent === null ? label : `${label} · ${percent}%`);
  const meter = byId<HTMLProgressElement>('update-meter');
  if (percent === null) meter.removeAttribute('value');
  else meter.value = percent;
});
desktop.onMenu(command => {
  if (command === 'open') void pickPdf();
  if (command === 'close') closeDocument();
  if (command === 'print') void printDocument();
  if (command === 'find') openSearch();
});
void desktop.ready().catch(errorStatus);

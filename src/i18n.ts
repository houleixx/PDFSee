import translations from '../desktop/translations.json';

export type Language = 'zh-CN' | 'en';

let language: Language = 'zh-CN';
const catalog: Record<string, string> = translations;
const templates = Object.entries(catalog)
  .filter(([source]) => source.includes('{0}'))
  .map(([source, target]) => ({
    source,
    target,
    pattern: new RegExp('^' + source.split(/\{\d+\}/)
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('([\\s\\S]+?)') + '$')
  }));

export function translate(message: string): string {
  if (language === 'zh-CN') return message;
  if (Object.hasOwn(catalog, message)) return catalog[message];
  if (!/[\u3400-\u9fff]/.test(message)) return message;
  for (const { source, target, pattern } of templates) {
    const match = pattern.exec(message);
    if (!match) continue;
    return target.replace(/\{(\d+)\}/g, (_, index) => {
      const value = match[Number(index) + 1];
      return source === '正在处理 · {0}' || source === '打开失败：{0}' ? translate(value) : value;
    });
  }
  return message;
}

type LocalizedAttribute = 'aria-label' | 'title' | 'placeholder';
const textSources = new WeakMap<Text, string>();
const attributeSources = new WeakMap<Element, Map<LocalizedAttribute, string>>();

export function localizedText(element: Element, source: string) {
  const node = document.createTextNode(translate(source));
  textSources.set(node, source);
  element.replaceChildren(node);
}

export function localizedAttribute(element: Element, attribute: LocalizedAttribute, source: string) {
  let attributes = attributeSources.get(element);
  if (!attributes) attributeSources.set(element, attributes = new Map());
  attributes.set(attribute, source);
  element.setAttribute(attribute, translate(source));
}

function walkText(root: Element, visit: (node: Text) => void) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) visit(walker.currentNode as Text);
}

export function registerStaticTranslations() {
  walkText(document.body, node => {
    const source = node.data.trim();
    if (Object.hasOwn(catalog, source)) textSources.set(node, source);
  });
  for (const attribute of ['aria-label', 'title', 'placeholder'] as const) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      const source = element.getAttribute(attribute)!;
      if (Object.hasOwn(catalog, source)) localizedAttribute(element, attribute, source);
    }
  }
}

export function applyLanguage(next: Language) {
  language = next;
  document.documentElement.lang = next;
  walkText(document.body, node => {
    const source = textSources.get(node);
    if (source !== undefined) node.data = translate(source);
  });
  for (const element of document.body.querySelectorAll('[aria-label], [title], [placeholder]')) {
    attributeSources.get(element)?.forEach((source, attribute) => {
      element.setAttribute(attribute, translate(source));
    });
  }
}

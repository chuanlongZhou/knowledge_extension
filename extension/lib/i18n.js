import { messages } from './messages.js';

export const LANGUAGE_KEY = 'uiLanguage';
export const LANGUAGES = { en: 'English', 'zh-CN': '中文', fr: 'Français', ja: '日本語' };
export function normalizeLanguage(value) {
  const base = String(value || '')
    .toLowerCase()
    .split(/[-_]/)[0];
  return ['en', 'fr', 'ja'].includes(base) ? base : 'zh-CN';
}
let language = 'zh-CN';
export async function initI18n() {
  try {
    if (globalThis.chrome?.storage?.local)
      language = normalizeLanguage((await chrome.storage.local.get(LANGUAGE_KEY))[LANGUAGE_KEY]);
  } catch {
    // The original Chinese interface remains available when preferences cannot be read.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    translateStatic(document);
  }
  return language;
}
export const getLanguage = () => language;
export async function saveLanguage(value) {
  const next = normalizeLanguage(value);
  await chrome.storage.local.set({ [LANGUAGE_KEY]: next });
  return next;
}
export function t(source, ...values) {
  const index = { en: 0, fr: 1, ja: 2 }[language];
  const text = index === undefined ? source : messages[source]?.[index] || source;
  return String(text).replace(/\{(\d+)\}/g, (match, n) =>
    n < values.length ? String(values[n]) : match,
  );
}
export function msg(parts, ...values) {
  return t(
    parts.reduce((key, part, i) => key + part + (i < values.length ? `{${i}}` : ''), ''),
    ...values,
  );
}
// Only authored UI markers are translated. Record text and editable values never pass here.
export function translateStatic(root) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const attribute of ['placeholder', 'title', 'aria-label', 'alt'])
    for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`))
      node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
}

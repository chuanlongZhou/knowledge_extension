import { t } from './i18n.js';
import { websiteTitle, linkDropTitles, shortWebsiteTitle, isPlaceholderTitle } from './websites.js';
import { safeUrl } from './model.js';
export async function openWebsiteTabs() {
  return (await chrome.tabs.query({ lastFocusedWindow: true }))
    .filter((tab) => safeUrl(tab.url) && !tab.pinned)
    .map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: shortWebsiteTitle(tab.title, tab.url),
      window_id: tab.windowId,
    }));
}
export const websiteItem = (tab) => ({
  id: crypto.randomUUID(),
  url: safeUrl(tab.url),
  title: shortWebsiteTitle(tab.title, tab.url),
  added_at: new Date().toISOString(),
  read_at: null,
});
export async function closeCapturedTabs(pending, record) {
  const saved = new Set(
      record.url_list.filter((item) => !item.removed_at).map((item) => safeUrl(item.url)),
    ),
    closed = [],
    skipped = [];
  for (const tab of new Map(pending.map((tab) => [tab.id, tab])).values()) {
    try {
      const current = await chrome.tabs.get(tab.id);
      if (
        current.pinned ||
        safeUrl(current.url) !== safeUrl(tab.url) ||
        (current.pendingUrl && safeUrl(current.pendingUrl) !== safeUrl(tab.url)) ||
        !saved.has(safeUrl(tab.url))
      ) {
        skipped.push(tab.id);
        continue;
      }
      await chrome.tabs.remove(tab.id);
      closed.push(tab.id);
    } catch {
      skipped.push(tab.id);
    }
  }
  return { closed, skipped };
}
export async function droppedWebsites(data) {
  const snapshot = Object.fromEntries(
    ['application/x-pkm-tab', 'text/uri-list', 'text/plain', 'text/html'].map((key) => [
      key,
      data.getData(key),
    ]),
  );
  data = { getData: (key) => snapshot[key] || '' };
  const internal = data.getData('application/x-pkm-tab');
  if (internal) {
    let values;
    try {
      values = JSON.parse(internal);
    } catch {
      throw new Error(t('拖入的标签页格式不正确。'));
    }
    if (!Array.isArray(values) || values.length > 1000)
      throw new Error(t('拖入的标签页格式不正确。'));
    const tabs = [];
    for (const value of values) {
      const tab = await chrome.tabs.get(value.id);
      if (tab.url === value.url && safeUrl(tab.url) && !tab.pinned)
        tabs.push({ id: tab.id, url: tab.url, title: tab.title, window_id: tab.windowId });
    }
    return { items: tabs.map(websiteItem), tabs };
  }
  const urls = (data.getData('text/uri-list') || data.getData('text/plain'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const tabs = await openWebsiteTabs(),
    matched = [];
  const hints = linkDropTitles(data.getData('text/html'));
  const items = [];
  for (const url of urls) {
    if (!safeUrl(url)) throw new Error(t('只能拖入 HTTP / HTTPS 网页链接。'));
    const matches = tabs.filter((tab) => safeUrl(tab.url) === safeUrl(url));
    if (matches.length === 1) matched.push(matches[0]);
    const known = matches[0]?.title;
    if (!isPlaceholderTitle(known, url)) items.push(websiteItem({ url, title: known }));
    else
      items.push(
        websiteItem({
          url,
          title: await websiteTitle(url, { hint: hints.get(safeUrl(url)) || '' }),
        }),
      );
  }
  return { items, tabs: matched };
}

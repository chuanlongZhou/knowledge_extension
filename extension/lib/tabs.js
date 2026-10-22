import { t } from './i18n.js';
import { websiteTitle, linkDropTitles, shortWebsiteTitle, isPlaceholderTitle } from './websites.js';
import { safeUrl } from './model.js';
const pendingOrCurrentUrl = (tab) => safeUrl(tab.pendingUrl || tab.url);
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
export async function openWebsiteGroup(
  record,
  { tabs = globalThis.chrome?.tabs, groups = globalThis.chrome?.tabGroups } = {},
) {
  if (!groups?.update || !tabs?.group) throw new Error(t('请重新加载扩展并允许标签页组权限。'));
  const urls = (record.url_list || []).filter((item) => !item.removed_at && safeUrl(item.url));
  if (!urls.length) throw new Error(t('网页组没有可打开的网页。'));
  const [active] = await tabs.query({ active: true, lastFocusedWindow: true });
  const created = [];
  try {
    for (const item of urls) {
      const tab = await tabs.create({
        url: safeUrl(item.url),
        active: false,
        ...(active ? { windowId: active.windowId } : {}),
      });
      created.push(tab.id);
    }
    const groupId = await tabs.group({
      tabIds: created,
      ...(active ? { createProperties: { windowId: active.windowId } } : {}),
    });
    await groups.update(groupId, { title: record.title || t('网页组'), collapsed: false });
    await tabs.update(created[0], { active: true });
    return { groupId, tabIds: created };
  } catch (error) {
    // Roll back only the tabs created by this action; existing browser groups stay intact.
    if (created.length) await tabs.remove(created).catch(() => {});
    throw error;
  }
}
export async function browserTabGroups({
  tabs = globalThis.chrome?.tabs,
  groups = globalThis.chrome?.tabGroups,
} = {}) {
  if (!groups?.get) throw new Error(t('请重新加载扩展并允许标签页组权限。'));
  const current = await tabs.query({ lastFocusedWindow: true });
  if (!current.length) return [];
  const ids = [
    ...new Set(
      current
        .filter(
          (tab) =>
            Number.isInteger(tab.groupId) &&
            tab.groupId >= 0 &&
            pendingOrCurrentUrl(tab) &&
            !tab.pinned,
        )
        .map((tab) => tab.groupId),
    ),
  ];
  const found = (await Promise.all(ids.map((id) => groups.get(id).catch(() => null)))).filter(
    Boolean,
  );
  return found
    .map((group) => ({
      id: group.id,
      title: group.title || t('未命名标签页组'),
      windowId: group.windowId,
      active: current.some((tab) => tab.active && tab.groupId === group.id),
      tabs: current
        .filter((tab) => tab.groupId === group.id && pendingOrCurrentUrl(tab) && !tab.pinned)
        .sort((a, b) => a.index - b.index)
        .map((tab) => ({
          id: tab.id,
          url: pendingOrCurrentUrl(tab),
          title: shortWebsiteTitle(tab.title, pendingOrCurrentUrl(tab)),
          window_id: tab.windowId,
        })),
    }))
    .filter((group) => group.tabs.length);
}
export async function captureBrowserTabGroup(
  groupId,
  { tabs = globalThis.chrome?.tabs, groups = globalThis.chrome?.tabGroups } = {},
) {
  if (!groups?.get) throw new Error(t('请重新加载扩展并允许标签页组权限。'));
  const group = await groups.get(groupId);
  const current = (await tabs.query({ groupId, windowId: group.windowId }))
    .filter((tab) => pendingOrCurrentUrl(tab) && !tab.pinned)
    .sort((a, b) => a.index - b.index);
  if (!current.length) throw new Error(t('这个标签页组没有可收集的网页。'));
  const captured = current.map((tab) => ({
    id: tab.id,
    url: pendingOrCurrentUrl(tab),
    title: shortWebsiteTitle(tab.title, pendingOrCurrentUrl(tab)),
    window_id: tab.windowId,
  }));
  return {
    title: group.title || t('未命名标签页组'),
    tabs: captured,
    items: captured.map(websiteItem),
  };
}
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

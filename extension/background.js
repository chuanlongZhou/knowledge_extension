import { t, msg, initI18n, LANGUAGE_KEY } from './lib/i18n.js';
import { Database } from './lib/db.js';
import { APP_NAME } from './lib/brand.js';
import { newRecord, safeUrl, MAX_ASSET_BYTES } from './lib/model.js';
import { enqueueCollected } from './lib/collected.js';
import { protectStorage } from './lib/config.js';
import { handleDriveCommand } from './lib/drive-service.js';

const db = new Database();
const languageReady = initI18n();
protectStorage().catch(() => {});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install')
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }).catch(() => {});
  languageReady.then(() =>
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'capture-selection',
        title: msg`收集选中文字到 ${APP_NAME}`,
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: 'capture-page',
        title: msg`收集当前网页到 ${APP_NAME}`,
        contexts: ['page'],
      });
      chrome.contextMenus.create({
        id: 'capture-link',
        title: msg`收集链接到 ${APP_NAME}`,
        contexts: ['link'],
      });
      chrome.contextMenus.create({
        id: 'capture-image',
        title: msg`收集图片到 ${APP_NAME}`,
        contexts: ['image'],
      });
    }),
  );
});
const menuTitles = () => ({
  'capture-selection': msg`收集选中文字到 ${APP_NAME}`,
  'capture-page': msg`收集当前网页到 ${APP_NAME}`,
  'capture-link': msg`收集链接到 ${APP_NAME}`,
  'capture-image': msg`收集图片到 ${APP_NAME}`,
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[LANGUAGE_KEY]) return;
  initI18n()
    .then(() => {
      for (const [id, title] of Object.entries(menuTitles()))
        chrome.contextMenus.update(id, { title }, () => {
          void chrome.runtime.lastError;
        });
      chrome.action.setTitle({ title: t('打开 GUGA Knowledge') }).catch(() => {});
    })
    .catch(() => {});
});
languageReady
  .then(() => chrome.action.setTitle({ title: t('打开 GUGA Knowledge') }))
  .catch(() => {});
async function badge() {
  const captures = await db.captures();
  await chrome.action.setBadgeText({ text: captures.length ? String(captures.length) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#b56824' });
}
async function pageAccessError(tab, snapshot) {
  const url = new URL(tab.url);
  const origins = [snapshot ? '<all_urls>' : `${url.protocol}//${url.hostname}/*`];
  if (await chrome.permissions.contains({ origins })) return null;
  return Object.assign(new Error(t('需要授权后才能捕获，请点击编辑器中的授权按钮。')), {
    access: { origins, site: url.hostname, tabId: tab.id, url: tab.url, snapshot },
  });
}
async function preparePage(
  tab,
  selectedText = null,
  pageUrl = null,
  snapshot = false,
  { frameId, fallbackText } = {},
) {
  await languageReady;
  let text = selectedText;
  if (text === null && tab?.id) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, ...(Number.isInteger(frameId) ? { frameIds: [frameId] } : {}) },
        func: () => ({
          text: window.getSelection()?.toString() || '',
          url: location.href,
          title: document.title,
        }),
      });
      const captured = results[0]?.result;
      text =
        fallbackText !== undefined &&
        captured?.text?.replace(/\s+/g, ' ').trim() !== fallbackText.replace(/\s+/g, ' ').trim()
          ? fallbackText
          : captured?.text || fallbackText || '';
      if (captured) {
        pageUrl = captured.url;
        tab = { ...tab, title: captured.title };
      }
    } catch (error) {
      if (fallbackText !== undefined) text = fallbackText;
      else if (/^https?:\/\//.test(tab?.url || '')) {
        throw (await pageAccessError(tab, snapshot)) || error;
      } else text = '';
    }
  }
  const url = pageUrl || tab?.url || '';
  if (!url)
    throw new Error(
      t('浏览器尚未授权访问当前网页，请用网页右键或 Alt + Shift + S 收集，也可以手动粘贴链接。'),
    );
  if (!/^https?:\/\//.test(url))
    throw new Error(t('这个页面不允许读取，请打开侧边栏手动粘贴内容。'));
  const now = new Date().toISOString();
  const record = newRecord({
    type: snapshot ? 'snapshot' : 'note',
    title: tab?.title || url,
    content: snapshot ? '' : text || '',
    sources: [
      {
        url,
        title: tab?.title || '',
        captured_at: now,
        kind: !snapshot && text ? 'web_selection' : 'web_page',
      },
    ],
  });
  if (snapshot) {
    const before = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
    if (before?.id !== tab.id) throw new Error(t('请先切回要截图的网页。'));
    let image;
    try {
      image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (error) {
      throw (await pageAccessError(tab, true)) || error;
    }
    const current = await chrome.tabs.get(tab.id),
      after = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
    if (
      current.url !== url ||
      (current.pendingUrl && current.pendingUrl !== url) ||
      after?.id !== tab.id
    )
      throw new Error(t('截图时网页发生切换或导航，请重新截图。'));
    const bytes = Uint8Array.from(atob(image.split(',')[1]), (char) => char.charCodeAt(0));
    const descriptor = await db.storeAsset(
      new Blob([bytes], { type: 'image/png' }),
      `${(tab.title || t('页面截图')).replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.png`,
    );
    record.attachments = [descriptor];
    record.snapshot = {
      url,
      title: tab.title || url,
      captured_at: now,
      format: 'png',
      asset_id: descriptor.id,
    };
  }
  return { record };
}
async function queueEditor(result, windowId) {
  await enqueueCollected(db, result.record, windowId);
}
async function captureImage(tab, info) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: {
        tabId: tab.id,
        ...(Number.isInteger(info.frameId) ? { frameIds: [info.frameId] } : {}),
      },
      args: [info.srcUrl],
      func: (url) => {
        const image = [...document.images].find((img) => img.currentSrc === url || img.src === url);
        if (
          !image?.complete ||
          !image.naturalWidth ||
          image.naturalWidth * image.naturalHeight > 40_000_000
        )
          return null;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          return canvas.toDataURL('image/png');
        } catch {
          return null;
        }
      },
    });
    if (result?.result && result.result.length < (MAX_ASSET_BYTES * 4) / 3) {
      const bytes = Uint8Array.from(atob(result.result.split(',')[1]), (c) => c.charCodeAt(0));
      return await db.storeAsset(new Blob([bytes], { type: 'image/png' }), t('收集图片.png'));
    }
  } catch {
    /* Retain the original URL if pixels cannot be read. */
  }
  if (!safeUrl(info.srcUrl)) return null;
  const url = new URL(info.srcUrl);
  try {
    const response = await fetch(url.href, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_ASSET_BYTES)
      return null;
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_ASSET_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return await db.storeAsset(
      new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0] }),
      t('收集图片'),
    );
  } catch {
    return null;
  }
}
async function prepareContext(info, tab) {
  const image = info.menuItemId === 'capture-image',
    link = info.menuItemId === 'capture-link';
  if (!image && !link)
    return preparePage(
      tab,
      info.menuItemId === 'capture-selection' ? null : '',
      info.frameUrl || info.pageUrl,
      false,
      { frameId: info.frameId, fallbackText: info.selectionText || '' },
    );
  const target = image ? info.srcUrl : info.linkUrl;
  if (!safeUrl(target)) throw new Error(t('只能收集 HTTP / HTTPS 图片或链接。'));
  let text = info.selectionText || '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: {
        tabId: tab.id,
        ...(Number.isInteger(info.frameId) ? { frameIds: [info.frameId] } : {}),
      },
      args: [target, image],
      func: (url, image) =>
        image
          ? [...document.images].find((img) => img.currentSrc === url || img.src === url)?.alt || ''
          : [...document.links].find((a) => a.href === url)?.textContent?.trim() || '',
    });
    text ||= result?.result || '';
  } catch {
    /* The URL and page metadata remain available without website access. */
  }
  const { record } = await preparePage(tab, text, info.frameUrl || info.pageUrl);
  record.sources[0].kind = 'web_page';
  record.sources.push({
    url: target,
    title: text,
    kind: image ? 'web_image' : 'web_link',
    captured_at: new Date().toISOString(),
  });
  if (image) {
    const asset = await captureImage(tab, info);
    if (asset) record.attachments.push(asset);
    else
      return {
        record,
        warning: t(
          '未能取得图片原文件，目前只保留图片链接。需要离线保存或同步图片时，请复制图片后粘贴到正文，或用“添加图片”上传原文件。',
        ),
      };
  }
  return { record };
}
let collectionChain = Promise.resolve();
function collectContext(info, tab) {
  // Read the selection immediately; serialize only queue commits so rapid captures keep their order.
  const prepared = prepareContext(info, tab).then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
  collectionChain = collectionChain
    .catch(() => {})
    .then(async () => {
      const { result, error } = await prepared;
      if (error) throw error;
      await queueEditor(result, tab?.windowId);
      if (result.warning)
        await db.setState('notice', {
          text: result.warning,
          error: false,
          at: new Date().toISOString(),
        });
      return result.record.id;
    });
  return collectionChain;
}
function openPanel(tab) {
  if (tab?.windowId !== undefined)
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
}
function handleError(error) {
  return db.setState('notice', {
    text: error.message || t('操作失败，请重试。'),
    error: true,
    at: new Date().toISOString(),
  });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  openPanel(tab);
  collectContext(info, tab).catch(handleError);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    return;
  }
  if (command === 'capture') {
    openPanel(tab);
    (tab
      ? Promise.resolve(tab)
      : chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0])
    )
      .then((t) => preparePage(t))
      .then((result) => queueEditor(result, tab?.windowId))
      .catch(handleError);
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'collect-context') {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    chrome.tabs
      .get(message.tabId)
      .then((tab) => collectContext(message.info, tab))
      .then((id) => respond({ ok: true, id }))
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'drive-command') {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    languageReady
      .then(() => handleDriveCommand(db, message))
      .then((result) => respond({ ok: true, result }))
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'capture-active') {
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then((tabs) => {
        const tab = tabs[0];
        if (message.target && (message.target.tabId !== tab?.id || message.target.url !== tab?.url))
          throw new Error(t('网页已切换，请回到目标网页后重新点击捕获。'));
        return preparePage(tab, null, null, message.snapshot === true);
      })
      .then((result) => respond({ ok: true, result }))
      .catch((error) => respond({ ok: false, error: error.message, access: error.access }));
    return true;
  }
  if (message?.type === 'refresh-badge') {
    badge().then(() => respond({ ok: true }));
    return true;
  }
});

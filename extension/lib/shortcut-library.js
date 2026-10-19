import { digest, safeUrl } from './model.js';

export const SHORTCUT_LIBRARY_ID = 'guga-shortcut-library';
export const SHORTCUTS_KEY = 'library:shortcuts';
export const SHORTCUT_REVISION = 'library:shortcuts:revision';

export function normalizeShortcutUrl(input) {
  if (typeof input !== 'string') throw new Error('常用网站地址不正确。');
  const raw = input.trim();
  const url = safeUrl(/^[a-z][\w+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  if (!url) throw new Error('常用网站地址必须是不含账号密码的 HTTP / HTTPS 地址。');
  return url;
}

export function normalizeShortcutLibrary(input) {
  if (
    !input ||
    input.id !== SHORTCUT_LIBRARY_ID ||
    input.type !== 'shortcut_library' ||
    input.version !== 1 ||
    !Array.isArray(input.shortcuts) ||
    input.shortcuts.length > 12 ||
    Object.keys(input).some((key) => !['id', 'type', 'version', 'title', 'shortcuts'].includes(key))
  )
    throw new Error('常用网站格式不正确。');
  const ids = new Set();
  const shortcuts = input.shortcuts.map((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name !== item.name.trim() ||
      item.name.length > 40 ||
      typeof item.url !== 'string' ||
      Object.keys(item).some((key) => !['id', 'name', 'url'].includes(key))
    )
      throw new Error('常用网站名称、地址或 ID 不正确。');
    ids.add(item.id);
    const url = normalizeShortcutUrl(item.url);
    if (url !== item.url) throw new Error('常用网站地址未规范化。');
    return { id: item.id, name: item.name, url };
  });
  return {
    id: SHORTCUT_LIBRARY_ID,
    type: 'shortcut_library',
    version: 1,
    title: '常用网站',
    shortcuts,
  };
}

export function shortcutLibraryFromState(shortcuts = []) {
  return normalizeShortcutLibrary({
    id: SHORTCUT_LIBRARY_ID,
    type: 'shortcut_library',
    version: 1,
    shortcuts,
  });
}

export function writeShortcutLibrary(store, input, revision) {
  const record = normalizeShortcutLibrary(input);
  store.put({ key: SHORTCUTS_KEY, value: record.shortcuts });
  store.put({ key: SHORTCUT_REVISION, value: revision });
}

export async function prepareShortcutLibrary(input) {
  const record = normalizeShortcutLibrary(input);
  return { record, hash: await digest(record) };
}

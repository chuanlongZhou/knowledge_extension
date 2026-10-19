import { t } from './i18n.js';
import { Database, StaleEditError } from './db.js';
import { SHORTCUTS_KEY, normalizeShortcutUrl as shortcutUrl } from './shortcut-library.js';
export const START_KEY = 'startPage';
export function normalizeShortcutUrl(input) {
  try {
    return shortcutUrl(input);
  } catch {
    throw new Error(t('请填写有效的 HTTP / HTTPS 网站地址。'));
  }
}
export function normalizeStartConfig(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const shortcuts = (Array.isArray(value.shortcuts) ? value.shortcuts : [])
    .slice(0, 12)
    .flatMap((item) => {
      try {
        if (
          typeof item.id !== 'string' ||
          !/^[\w-]{1,100}$/.test(item.id) ||
          typeof item.name !== 'string' ||
          !item.name.trim()
        )
          return [];
        return [
          { id: item.id, name: item.name.trim().slice(0, 40), url: normalizeShortcutUrl(item.url) },
        ];
      } catch {
        return [];
      }
    });
  return {
    favoritesLimit: [5, 8, 10].includes(value.favoritesLimit) ? value.favoritesLimit : 8,
    shortcuts: [...new Map(shortcuts.map((item) => [item.id, item])).values()],
  };
}
async function readStartConfigFrom(db) {
  const local = normalizeStartConfig((await chrome.storage.local.get(START_KEY))[START_KEY]);
  const shortcuts = await db.getState(SHORTCUTS_KEY, null);
  if (shortcuts === null && local.shortcuts.length) {
    try {
      await db.setShortcutLibrary(local.shortcuts, 0);
    } catch (error) {
      if (!(error instanceof StaleEditError)) throw error;
    }
  }
  const row = await db.shortcutLibrary();
  return { config: { ...local, shortcuts: row.record.shortcuts }, revision: row.rev };
}
export async function migrateStartShortcuts(db) {
  if (!globalThis.chrome?.storage?.local) return;
  await readStartConfigFrom(db);
}
export async function readStartConfig() {
  const db = new Database();
  try {
    return (await readStartConfigFrom(db)).config;
  } finally {
    await db.close();
  }
}
export async function updateStartConfig(patch) {
  const write = async () => {
    const db = new Database();
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { config: current, revision } = await readStartConfigFrom(db);
        const next = normalizeStartConfig({
          ...current,
          ...(typeof patch === 'function' ? patch(current) : patch),
        });
        try {
          if (JSON.stringify(next.shortcuts) !== JSON.stringify(current.shortcuts))
            await db.setShortcutLibrary(next.shortcuts, revision);
          await chrome.storage.local.set({ [START_KEY]: next });
          return next;
        } catch (error) {
          if (!(error instanceof StaleEditError) || attempt === 4) throw error;
        }
      }
    } finally {
      await db.close();
    }
  };
  return globalThis.navigator?.locks
    ? navigator.locks.request('guga:start-preferences', write)
    : write();
}

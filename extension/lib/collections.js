import { LIST_ID, newRecord, upgradeRecord, urlKey } from './model.js';
import { StaleEditError } from './db.js';
export async function singletonList(db) {
  let row = await db.get(LIST_ID);
  if (row?.record.kind === 'tombstone') throw new Error('清单已移除，请先处理删除状态。');
  if (row?.record.deleted_at) {
    await db.restore(LIST_ID);
    row = await db.get(LIST_ID);
  }
  return row || { id: LIST_ID, rev: 0, record: newRecord({ type: 'list' }) };
}
export async function migrateTodos(db) {
  const migrate = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await migrateOnce(db);
        return;
      } catch (error) {
        if (!(error instanceof StaleEditError) || attempt === 4) throw error;
      }
    }
  };
  if (globalThis.navigator?.locks)
    return navigator.locks.request(`pkm-nexus:migrate-todos:${db.name}`, migrate);
  return migrate();
}
async function migrateOnce(db) {
  const candidates = (await db.allCatalog()).filter((r) => r.type === 'todo' && !r.deleted_at);
  if (!candidates.length) return;
  const todos = [];
  for (const candidate of candidates) {
    const row = await db.get(candidate.id);
    if (row?.record.type === 'todo' && !row.record.deleted_at) todos.push(row);
  }
  if (!todos.length) return;
  const row = await singletonList(db),
    items = new Map(row.record.list.map((i) => [i.id, i]));
  for (const { record } of todos) {
    const id = `old-${record.id}`;
    if (!items.has(id))
      items.set(id, {
        id,
        kind: 'item',
        text: [record.title, record.content].filter(Boolean).join(' — ').slice(0, 5000),
        is_checkbox: true,
        checked: ['completed', 'archived'].includes(record.task_status),
      });
  }
  await db.save(
    {
      ...row.record,
      list: [...items.values()],
      content: listDocument([...items.values()], row.record.content, row.record.list),
      updated_at: new Date().toISOString(),
    },
    { expectedRev: row.rev },
  );
  for (const row of todos) await db.save(upgradeRecord(row.record), { expectedRev: row.rev });
}
export function mergeUrls(existing, incoming) {
  const map = new Map(existing.map((u) => [urlKey(u.url), u]));
  for (const item of incoming) if (!map.has(urlKey(item.url))) map.set(urlKey(item.url), item);
  return [...map.values()];
}
export async function appendWebsites(db, id, items) {
  return db.mutate(id, (record) => {
    if (record.type !== 'website_group' || record.deleted_at)
      throw new Error('请拖入有效的网页组。');
    return {
      ...record,
      url_list: mergeUrls(record.url_list, items),
      updated_at: new Date().toISOString(),
    };
  });
}
export function listMarkdown(items, mode) {
  return items
    .filter((i) => i.is_checkbox === mode)
    .map((i) =>
      i.kind === 'divider'
        ? '---'
        : mode
          ? `- [${i.checked ? 'x' : ' '}] ${i.text}`
          : `- ${i.text}`,
    )
    .join('\n');
}
export function listDocument(items, previous = '', previousItems = items) {
  const oldBody = previous ? listDocument(previousItems).trimEnd() : '';
  const oldText = previous.trimEnd();
  const prefix = (
    oldBody && oldText.endsWith(oldBody) ? oldText.slice(0, -oldBody.length) : oldText
  ).trimEnd();
  const body = [true, false]
    .map((mode) => `## ${mode ? 'Todo' : 'Idea'}\n\n${listMarkdown(items, mode)}`)
    .join('\n\n');
  return [prefix, body].filter(Boolean).join('\n\n');
}
export function parseListMarkdown(text, mode, existing = []) {
  const pool = existing.filter((i) => i.is_checkbox === mode),
    used = new Set();
  const parsed = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const divider = /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);
      const checkbox = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/.exec(line);
      const value = divider
        ? ''
        : (checkbox ? checkbox[2] : line.replace(/^\s*[-*+]\s+/, '')).trim();
      const kind = divider ? 'divider' : 'item';
      const old = pool.find((i) => !used.has(i.id) && i.kind === kind && i.text === value);
      if (old) used.add(old.id);
      return {
        id: old?.id || crypto.randomUUID(),
        kind,
        text: value,
        is_checkbox: mode,
        checked: mode && !!checkbox && checkbox[1].toLowerCase() === 'x',
      };
    });
  return [...existing.filter((i) => i.is_checkbox !== mode), ...parsed];
}

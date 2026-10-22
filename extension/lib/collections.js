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
export async function moveWebsite(db, sourceId, targetId, itemId) {
  if (sourceId === targetId) return { moved: false };
  for (let attempt = 0; attempt < 4; attempt++) {
    const [source, target] = await Promise.all([db.get(sourceId), db.get(targetId)]);
    if (
      [source, target].some(
        (row) => !row || row.record.type !== 'website_group' || row.record.deleted_at,
      )
    )
      throw new Error('请选择仍在使用的网页组。');
    const item = source.record.url_list.find((item) => item.id === itemId && !item.removed_at);
    if (!item) throw new Error('这个网页已经移动或删除，请刷新后重试。');
    const incoming = structuredClone(item),
      urls = structuredClone(target.record.url_list),
      duplicate = urls.find((other) => urlKey(other.url) === urlKey(item.url)),
      now = new Date().toISOString();
    if (duplicate) {
      // Keep the destination identity/title, restore removed URLs, and never lose a read mark.
      duplicate.removed_at = null;
      duplicate.read_at ||= incoming.read_at;
    } else {
      if (urls.some((other) => other.id === incoming.id)) incoming.id = crypto.randomUUID();
      urls.push(incoming);
    }
    try {
      await db.saveMany([
        {
          record: {
            ...upgradeRecord(source.record),
            url_list: source.record.url_list.filter((i) => i.id !== itemId),
            updated_at: now,
          },
          expectedRev: source.rev,
        },
        {
          record: { ...upgradeRecord(target.record), url_list: urls, updated_at: now },
          expectedRev: target.rev,
        },
      ]);
      return { moved: true, merged: !!duplicate };
    } catch (error) {
      if (!(error instanceof StaleEditError) || attempt === 3) throw error;
    }
  }
}
export async function moveWebsiteGroups(db, sourceIds, targetId) {
  if (
    !Array.isArray(sourceIds) ||
    sourceIds.length > 1000 ||
    sourceIds.some((id) => typeof id !== 'string')
  )
    throw new Error('没有识别到可并入的网页组。');
  const ids = [...new Set(sourceIds)].filter((id) => id !== targetId);
  if (!ids.length) return { moved: 0 };
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await Promise.all([targetId, ...ids].map((id) => db.get(id)));
    if (rows.some((row) => !row || row.record.type !== 'website_group' || row.record.deleted_at))
      throw new Error('整组并入只支持仍在使用的网页组，普通记录请移到项目或标签。');
    const [target, ...sources] = rows,
      urls = structuredClone(target.record.url_list),
      byUrl = new Map(urls.map((item) => [urlKey(item.url), item])),
      usedIds = new Set(urls.map((item) => item.id)),
      now = new Date().toISOString();
    let moved = 0;
    const changes = [];
    for (const source of sources) {
      const active = source.record.url_list.filter((item) => !item.removed_at);
      if (!active.length) continue;
      for (const item of active) {
        const duplicate = byUrl.get(urlKey(item.url));
        if (duplicate) {
          duplicate.removed_at = null;
          duplicate.read_at ||= item.read_at;
        } else {
          const copy = structuredClone(item);
          if (usedIds.has(copy.id)) copy.id = crypto.randomUUID();
          urls.push(copy);
          byUrl.set(urlKey(copy.url), copy);
          usedIds.add(copy.id);
        }
        moved++;
      }
      changes.push({
        record: {
          ...upgradeRecord(source.record),
          url_list: source.record.url_list.filter((item) => item.removed_at),
          updated_at: now,
        },
        expectedRev: source.rev,
      });
    }
    if (!moved) return { moved: 0 };
    changes.push({
      record: { ...upgradeRecord(target.record), url_list: urls, updated_at: now },
      expectedRev: target.rev,
    });
    try {
      await db.saveMany(changes);
      return { moved };
    } catch (error) {
      if (!(error instanceof StaleEditError) || attempt === 3) throw error;
    }
  }
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
  // Match unchanged rows first (including reorder), then retain IDs for text edits.
  // This keeps file associations attached to the same item in Markdown mode.
  if (parsed.length === pool.length) {
    const remaining = pool.filter((old) => !used.has(old.id));
    for (const item of parsed) {
      if (used.has(item.id)) continue;
      const index = remaining.findIndex((old) => old.kind === item.kind);
      if (index !== -1) item.id = remaining.splice(index, 1)[0].id;
    }
  }
  return [...existing.filter((i) => i.is_checkbox !== mode), ...parsed];
}

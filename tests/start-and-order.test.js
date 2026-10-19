import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../extension/lib/db.js';
import { newRecord, LIST_ID } from '../extension/lib/model.js';
import { editStartList } from '../extension/lib/start-list.js';
import { RecordOrder, sortPreference } from '../extension/lib/record-order.js';
import { normalizeStartConfig, normalizeShortcutUrl } from '../extension/lib/start-config.js';
const dbFor = (t) => {
  const db = new Database(`start-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  return db;
};

test('updated-time order stays stable before pagination and changes only on the next list entry', async (t) => {
  const db = dbFor(t),
    order = new RecordOrder();
  const notes = [3, 2, 1].map((n) =>
    newRecord({
      title: `记录${n}`,
      created_at: `2025-01-0${n}T00:00:00.000Z`,
      updated_at: `2025-01-0${n}T00:00:00.000Z`,
    }),
  );
  await db.saveMany(notes.map((record) => ({ record })));
  const first = order.reconcile(await db.allCatalog(), 'all', {
    mode: 'updated_at',
    direction: 'desc',
  });
  assert.deepEqual(
    (await db.list({ view: 'all', orderedIds: first, limit: 2 })).items.map((r) => r.id),
    notes.slice(0, 2).map((r) => r.id),
  );
  await db.mutate(notes[1].id, (r) => ({
    ...r,
    title: '改完仍在原位',
    updated_at: '2024-01-01T00:00:00.000Z',
  }));
  const held = order.reconcile(await db.allCatalog(), 'all', {
    mode: 'updated_at',
    direction: 'desc',
  });
  assert.equal(order.pending, true);
  assert.deepEqual(
    (await db.list({ view: 'all', orderedIds: held, limit: 2 })).items.map((r) => r.id),
    notes.slice(0, 2).map((r) => r.id),
  );
  order.reset();
  const next = order.reconcile(await db.allCatalog(), 'all', {
    mode: 'updated_at',
    direction: 'desc',
  });
  assert.deepEqual(next, [notes[0].id, notes[2].id, notes[1].id]);
  assert.equal(order.pending, false);
  assert.deepEqual(
    (await db.list({ view: 'all', orderedIds: next, query: '原位' })).items.map((r) => r.id),
    [notes[1].id],
  );
});

test('created-time, title, tag and project modes handle directions, empty values and new records', () => {
  const project = newRecord({ schema_version: 5, type: 'project', title: '项目A' });
  const a = newRecord({
    title: 'Alpha',
    tags: ['Beta'],
    project_ids: [project.id],
    created_at: '2025-01-01T00:00:00.000Z',
  });
  const b = newRecord({ title: 'Beta', tags: ['Alpha'], created_at: '2025-01-02T00:00:00.000Z' });
  const c = newRecord({ title: 'Gamma', created_at: '2025-01-03T00:00:00.000Z' });
  const order = new RecordOrder();
  assert.deepEqual(order.reconcile([a, b, c], 'x', { mode: 'created_at', direction: 'asc' }), [
    a.id,
    b.id,
    c.id,
  ]);
  assert.deepEqual(order.reconcile([a, b, c], 'x', { mode: 'tag', direction: 'asc' }), [
    b.id,
    a.id,
    c.id,
  ]);
  const byProject = order.reconcile([a, b, c, project], 'x', { mode: 'project' });
  assert.equal(byProject[0], a.id);
  assert.deepEqual(order.reconcile([a, b, c], 'x', { mode: 'title', direction: 'desc' }), [
    c.id,
    b.id,
    a.id,
  ]);
  const newest = newRecord({ title: 'Zebra' });
  assert.deepEqual(order.reconcile([a, b, c, newest], 'x', { mode: 'title', direction: 'desc' }), [
    c.id,
    b.id,
    a.id,
    newest.id,
  ]);
  assert.equal(
    order.reconcile([a, b, c, newest], 'next-entry', { mode: 'title', direction: 'desc' })[0],
    newest.id,
  );
  assert.deepEqual(sortPreference(null), { mode: 'updated_at', direction: 'desc' });
});

test('start-page Todo and Idea share the existing singleton without replacing each other or prose', async (t) => {
  const db = dbFor(t),
    todo = {
      id: crypto.randomUUID(),
      kind: 'item',
      text: '待办',
      is_checkbox: true,
      checked: false,
    },
    idea = {
      id: crypto.randomUUID(),
      kind: 'item',
      text: '灵感',
      is_checkbox: false,
      checked: false,
    };
  await db.save(newRecord({ type: 'list', content: '保留原备注' }));
  await Promise.all([
    editStartList(db, (list) => [...list, todo]),
    editStartList(db, (list) => [...list, idea]),
  ]);
  let row = await db.get(LIST_ID);
  assert.equal(row.record.list.length, 2);
  assert.match(row.record.content, /保留原备注/);
  await editStartList(db, (list) =>
    list.map((item) => (item.id === todo.id ? { ...item, checked: true } : item)),
  );
  row = await db.get(LIST_ID);
  assert.equal(row.record.list.find((item) => item.id === todo.id).checked, true);
  assert.equal(row.record.list.find((item) => item.id === idea.id).text, '灵感');
  assert.equal((await db.allRows()).length, 1);
});

test('start settings keep safe URLs and Dock entries while ignoring retired new-tab preferences', () => {
  assert.equal(
    Object.hasOwn(normalizeStartConfig({ enabled: true, decided: true }), 'enabled'),
    false,
  );
  assert.equal(normalizeStartConfig(null).favoritesLimit, 8);
  assert.equal(normalizeShortcutUrl('example.com/docs'), 'https://example.com/docs');
  assert.throws(() => normalizeShortcutUrl('javascript:alert(1)'), /有效/);
  assert.throws(() => normalizeShortcutUrl('https://user:password@example.com'), /有效/);
  const config = normalizeStartConfig({
    enabled: true,
    shortcuts: [
      { id: 'one', name: '网站', url: 'example.com' },
      { id: 'bad', name: 'bad', url: 'data:text/html,test' },
    ],
  });
  assert.equal(config.shortcuts.length, 1);
  assert.equal(config.shortcuts[0].url, 'https://example.com/');
});

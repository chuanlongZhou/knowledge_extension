import { SyncHarness } from './sync-fixture.js';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../extension/lib/db.js';
import {
  newRecord,
  normalizeRecord,
  upgradeRecord,
  LIST_ID,
  digest,
  toMarkdown,
} from '../extension/lib/model.js';
import { shortWebsiteTitle, websiteTitle } from '../extension/lib/websites.js';
import {
  singletonList,
  migrateTodos,
  mergeUrls,
  appendWebsites,
  moveWebsite,
  moveWebsiteGroups,
} from '../extension/lib/collections.js';
import { closeCapturedTabs } from '../extension/lib/tabs.js';
const database = (t) => {
  const db = new Database(`types-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  return db;
};
const item = (text, is_checkbox = false, kind = 'item') => ({
  id: crypto.randomUUID(),
  text,
  is_checkbox,
  kind,
  checked: false,
});
const url = (address, title = '网页') => ({
  id: crypto.randomUUID(),
  url: address,
  title,
  added_at: new Date().toISOString(),
  read_at: null,
});

test('moving a website changes both groups atomically and retains its identity and read state', async (t) => {
  const db = database(t),
    item = { ...url('https://example.com/article', '已读文章'), read_at: new Date().toISOString() },
    source = newRecord({
      type: 'website_group',
      title: '来源',
      url_list: [item, url('https://example.com/keep')],
    }),
    target = newRecord({ type: 'website_group', title: '目标' });
  await db.saveMany([source, target].map((record) => ({ record })));
  const sourceRev = (await db.get(source.id)).rev;
  assert.deepEqual(await moveWebsite(db, source.id, source.id, item.id), { moved: false });
  assert.equal((await db.get(source.id)).rev, sourceRev);
  await moveWebsite(db, source.id, target.id, item.id);
  assert.equal((await db.get(source.id)).record.url_list.length, 1);
  assert.deepEqual((await db.get(target.id)).record.url_list[0], item);
  await assert.rejects(moveWebsite(db, source.id, target.id, item.id), /已经移动或删除/);
});
test('whole website groups combine atomically, retain read marks and source annotations, and merge duplicate URLs', async (t) => {
  const db = database(t),
    shared = { ...url('https://example.com/shared'), read_at: new Date().toISOString() },
    a = newRecord({
      type: 'website_group',
      title: 'A',
      content: '保留的说明',
      tags: ['来源'],
      url_list: [shared, url('https://example.com/a')],
    }),
    b = newRecord({ type: 'website_group', title: 'B', url_list: [url('https://example.com/b')] }),
    target = newRecord({
      type: 'website_group',
      title: '目标',
      url_list: [url('https://example.com/shared', '目标标题')],
    });
  await db.saveMany([a, b, target].map((record) => ({ record })));
  assert.deepEqual(await moveWebsiteGroups(db, [a.id, b.id, a.id, target.id], target.id), {
    moved: 3,
  });
  const after = (await db.get(target.id)).record;
  assert.equal(after.url_list.length, 3);
  assert.equal(after.url_list[0].title, '目标标题');
  assert.equal(after.url_list[0].read_at, shared.read_at);
  assert.deepEqual((await db.get(a.id)).record.tags, ['来源']);
  assert.equal((await db.get(a.id)).record.content, '保留的说明');
  assert.equal((await db.get(a.id)).record.url_list.length, 0);
  assert.equal((await db.get(b.id)).record.url_list.length, 0);
});
test('a full destination or non-group selection cannot partially empty source website groups', async (t) => {
  const db = database(t),
    a = newRecord({ type: 'website_group', url_list: [url('https://example.com/new')] }),
    target = newRecord({
      type: 'website_group',
      url_list: Array.from({ length: 1000 }, (_, i) => url(`https://example.com/${i}`)),
    }),
    note = newRecord({ title: '普通记录' });
  await db.saveMany([a, target, note].map((record) => ({ record })));
  await assert.rejects(moveWebsiteGroups(db, [a.id], target.id), /最多 1000/);
  await assert.rejects(moveWebsiteGroups(db, [a.id, note.id], target.id), /只支持/);
  assert.equal((await db.get(a.id)).record.url_list.length, 1);
  assert.equal((await db.get(target.id)).record.url_list.length, 1000);
});
test('moving onto an existing URL merges read state, restores a removed destination, and keeps its identity', async (t) => {
  const db = database(t),
    item = {
      ...url('https://example.com/article?utm_source=a'),
      read_at: new Date().toISOString(),
    },
    other = {
      ...url('https://example.com/article', '目标自定义标题'),
      removed_at: new Date().toISOString(),
    },
    source = newRecord({ type: 'website_group', url_list: [item] }),
    target = newRecord({ schema_version: 5, type: 'website_group', url_list: [other] });
  await db.saveMany([source, target].map((record) => ({ record })));
  assert.deepEqual(await moveWebsite(db, source.id, target.id, item.id), {
    moved: true,
    merged: true,
  });
  const moved = (await db.get(target.id)).record.url_list;
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, other.id);
  assert.equal(moved[0].title, other.title);
  assert.equal(moved[0].read_at, item.read_at);
  assert.equal(moved[0].removed_at, null);
});
test('website moves retry concurrent group edits and never remove the source when target validation fails', async (t) => {
  const db = database(t),
    item = url('https://example.com/move'),
    source = newRecord({ type: 'website_group', url_list: [item] }),
    target = newRecord({ type: 'website_group' });
  await db.saveMany([source, target].map((record) => ({ record })));
  const save = db.saveMany.bind(db);
  let race = true;
  db.saveMany = async (changes) => {
    if (race) {
      race = false;
      const current = await db.get(target.id);
      await save([
        { record: { ...current.record, title: '并发编辑的标题' }, expectedRev: current.rev },
      ]);
    }
    return save(changes);
  };
  await moveWebsite(db, source.id, target.id, item.id);
  assert.equal((await db.get(target.id)).record.title, '并发编辑的标题');
  await moveWebsite(db, target.id, source.id, item.id);
  await db.mutate(target.id, (record) => ({
    ...record,
    url_list: Array.from({ length: 1000 }, (_, i) => url(`https://example.com/full/${i}`)),
  }));
  await assert.rejects(moveWebsite(db, source.id, target.id, item.id), /最多 1000/);
  assert.equal((await db.get(source.id)).record.url_list.length, 1);
  await db.trash(target.id);
  await assert.rejects(moveWebsite(db, source.id, target.id, item.id), /仍在使用/);
});
const sync = (db, cloud) => cloud.sync(db);

test('four v4 record types share fields, no purpose, and incorrect type fields are rejected', () => {
  const fields = Object.keys(newRecord()).sort();
  for (const type of ['snapshot', 'list', 'website_group'])
    assert.deepEqual(Object.keys(newRecord({ type })).sort(), fields);
  assert.equal(fields.includes('purpose'), false);
  assert.throws(() => normalizeRecord({ ...newRecord(), purpose: 'obsolete' }), /用途/);
  assert.throws(() => newRecord({ type: 'note', list: [item('bad')] }), /专用字段/);
  assert.throws(
    () => newRecord({ type: 'note', url_list: [url('https://example.com')] }),
    /专用字段/,
  );
});
test('singleton list prevents alternate IDs and simultaneous creation cannot produce two lists', async (t) => {
  const db = database(t),
    one = await singletonList(db),
    two = await singletonList(db);
  assert.equal(one.id, LIST_ID);
  assert.equal(two.id, LIST_ID);
  await db.save({ ...one.record, list: [item('待办', true)] }, { expectedRev: 0 });
  await assert.rejects(db.save(two.record, { expectedRev: 0 }), /其他窗口/);
  assert.throws(() => normalizeRecord({ ...one.record, id: 'another-list' }), /固定/);
  assert.equal((await db.allRows()).filter((r) => r.record.type === 'list').length, 1);
});
test('checkbox and bullet items plus dividers retain order and completion, searchable by text', async (t) => {
  const db = database(t),
    record = newRecord({
      type: 'list',
      list: [
        { ...item('finish-test', true), checked: true },
        item('灵感区', false, 'divider'),
        item('idea-test'),
      ],
    });
  await db.save(record);
  const saved = (await db.get(LIST_ID)).record;
  assert.equal(saved.list[0].checked, true);
  assert.equal(saved.list[1].kind, 'divider');
  assert.equal(saved.list[2].is_checkbox, false);
  assert.equal((await db.list({ view: 'all', query: 'idea-test' })).items[0].id, LIST_ID);
});
test('legacy todo migration consolidates into one list, preserves old records as notes, and repeats safely', async (t) => {
  const db = database(t),
    one = newRecord({
      schema_version: 2,
      type: 'todo',
      title: '旧待办',
      content: '重要细节',
      task_status: 'completed',
      purpose: '旧用途',
    }),
    two = newRecord({ schema_version: 2, type: 'todo', title: '另一条待办' });
  await db.save(one);
  await db.save(two);
  const oldHash = await digest(one);
  assert.equal((await db.get(one.id)).hash, oldHash);
  await migrateTodos(db);
  await migrateTodos(db);
  const list = (await db.get(LIST_ID)).record;
  assert.equal(list.list.length, 2);
  assert.equal(list.list.find((i) => i.id === `old-${one.id}`).checked, true);
  const saved = (await db.get(one.id)).record;
  assert.equal(saved.type, 'note');
  assert.equal(saved.id, one.id);
  assert.equal(saved.purpose, undefined);
  assert.match(saved.content, /旧用途/);
  assert.equal((await db.allRows()).length, 3);
});
test('legacy record upgrades only when edited and keeps source, attachment, ID and timestamps', () => {
  const old = newRecord({ schema_version: 2, type: 'web', content: '摘录', purpose: '保存理由' }),
    hash = JSON.stringify(normalizeRecord(old)),
    modern = upgradeRecord(old);
  assert.equal(JSON.stringify(normalizeRecord(old)), hash);
  assert.equal(modern.id, old.id);
  assert.equal(modern.created_at, old.created_at);
  assert.equal(modern.updated_at, old.updated_at);
  assert.equal(modern.type, 'note');
  assert.match(modern.content, /摘录.*保存理由/s);
});
test('URL groups deduplicate tracking variants, preserve reading state, and append to the original ID', async (t) => {
  const db = database(t),
    first = { ...url('https://example.com/page?item=1'), read_at: new Date().toISOString() },
    incoming = url('https://example.com/page?item=1&utm_source=ad'),
    different = url('https://example.com/page?item=2');
  assert.equal(mergeUrls([first], [incoming, different]).length, 2);
  const group = newRecord({ type: 'website_group', url_list: [first] });
  await db.save(group);
  await appendWebsites(db, group.id, [incoming, different]);
  const saved = (await db.get(group.id)).record;
  assert.equal(saved.id, group.id);
  assert.equal(saved.url_list[0].read_at, first.read_at);
  assert.equal(saved.url_list.length, 2);
  assert.equal((await db.list({ view: 'all', query: 'item=2' })).items.length, 1);
  assert.throws(() => normalizeRecord({ ...group, url_list: [first, incoming] }), /重复/);
});
test('legacy MHTML snapshot remains readable and stores verified binary bytes and synchronizes with its snapshot metadata', async (t) => {
  const a = database(t),
    b = database(t),
    repo = new SyncHarness(t),
    descriptor = await a.storeAsset(
      new Blob(['MIME-Version: 1.0\r\nContent-Type: multipart/related\r\n\r\nArchived page'], {
        type: 'application/x-mimearchive',
      }),
      'page.mhtml',
    ),
    record = newRecord({
      type: 'snapshot',
      attachments: [descriptor],
      snapshot: {
        url: 'https://example.com',
        title: '快照',
        captured_at: new Date().toISOString(),
        format: 'mhtml',
        asset_id: descriptor.id,
      },
    });
  assert.equal(descriptor.kind, 'snapshot');
  await a.save(record);
  await sync(a, repo);
  await sync(b, repo);
  assert.deepEqual((await b.get(record.id)).record, record);
  assert.equal((await repo.asset(b, descriptor)).size, descriptor.size_bytes);
  assert.throws(() => normalizeRecord({ ...record, attachments: [] }), /快照/);
});
test('same singleton list edited independently produces a conflict and never a second list', async (t) => {
  const a = database(t),
    b = database(t),
    repo = new SyncHarness(t);
  await a.save(newRecord({ type: 'list', list: [item('共同项')] }));
  await sync(a, repo);
  await sync(b, repo);
  await a.mutate(LIST_ID, (r) => ({ ...r, list: [...r.list, item('A')] }));
  await b.mutate(LIST_ID, (r) => ({ ...r, list: [...r.list, item('B')] }));
  await sync(a, repo);
  assert.equal((await sync(b, repo)).status, 'conflicts');
  assert.equal((await b.allRows()).length, 1);
  assert.ok((await repo.versions(b, LIST_ID)).some((v) => v.record.list.length === 2));
});
test('tabs close only if the committed group contains the same URL; changed, pinned or failed tabs remain', async (t) => {
  const original = globalThis.chrome;
  t.after(() => (globalThis.chrome = original));
  const removed = [],
    tabs = new Map([
      [1, { id: 1, url: 'https://example.com/a' }],
      [2, { id: 2, url: 'https://example.com/changed' }],
      [3, { id: 3, url: 'https://example.com/a', pinned: true }],
      [4, { id: 4, url: 'https://example.com/a', pendingUrl: 'https://example.com/loading' }],
    ]);
  globalThis.chrome = {
    tabs: {
      get: async (id) => {
        if (!tabs.has(id)) throw new Error('gone');
        return tabs.get(id);
      },
      remove: async (id) => removed.push(id),
    },
  };
  const pending = [1, 2, 3, 4, 5].map((id) => ({ id, url: 'https://example.com/a' }));
  assert.equal(
    (await closeCapturedTabs(pending, newRecord({ type: 'website_group' }))).closed.length,
    0,
  );
  const group = newRecord({ type: 'website_group', url_list: [url('https://example.com/a')] });
  const result = await closeCapturedTabs(pending, group);
  assert.deepEqual(result.closed, [1]);
  assert.deepEqual(removed, [1]);
  assert.equal(result.skipped.length, 4);
});

test('new snapshots reference a PNG image and Markdown embeds that picture', async (t) => {
  const db = database(t),
    descriptor = await db.storeAsset(
      new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
      'page.png',
    ),
    record = newRecord({
      type: 'snapshot',
      attachments: [descriptor],
      snapshot: {
        url: 'https://example.com',
        title: '页面图片',
        captured_at: new Date().toISOString(),
        format: 'png',
        asset_id: descriptor.id,
      },
    });
  assert.equal(record.schema_version, 4);
  assert.equal(record.snapshot.format, 'png');
  assert.match(toMarkdown(record), /!\[页面快照\]\(assets\//);
  assert.throws(() => normalizeRecord({ ...record, attachments: [] }), /快照/);
});
test('legacy v3 list hash remains stable on read; explicit upgrade removes list and divider names', async () => {
  const old = newRecord({
      schema_version: 3,
      type: 'list',
      title: '旧名字',
      list: [item('待办', true), item('旧分区名称', false, 'divider')],
    }),
    hash = await digest(old);
  assert.equal(normalizeRecord(old).title, '旧名字');
  assert.equal(await digest(normalizeRecord(old)), hash);
  const upgraded = upgradeRecord(old);
  assert.equal(upgraded.schema_version, 4);
  assert.equal(upgraded.title, '');
  assert.equal(upgraded.list[1].text, '');
  assert.equal(upgraded.list[0].text, '待办');
  assert.equal(upgraded.id, old.id);
});
test('nameless dividers remember Todo or Idea section without becoming a checkbox', () => {
  const record = newRecord({
    type: 'list',
    title: 'ignored',
    list: [item('ignored', true, 'divider'), item('ignored', false, 'divider')],
  });
  assert.equal(record.title, '');
  assert.deepEqual(
    record.list.map((i) => [i.text, i.is_checkbox, i.checked]),
    [
      ['', true, false],
      ['', false, false],
    ],
  );
});
test('unavailable website titles use dragged link text or a short hostname, never a raw long URL', async () => {
  const address = 'https://www.example.com/a/long/url?tracking=lots';
  assert.equal(shortWebsiteTitle(address, address), 'example.com');
  assert.equal(shortWebsiteTitle('example.com/a/long/url', address), 'example.com');
  assert.equal(
    await websiteTitle(address, {
      hint: '文章标题',
      fetchImpl: async () => new Response('blocked', { status: 403 }),
    }),
    '文章标题',
  );
});

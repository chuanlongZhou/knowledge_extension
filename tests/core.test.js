import { SyncHarness } from './sync-fixture.js';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database, StaleEditError } from '../extension/lib/db.js';
import {
  newRecord,
  normalizeRecord,
  urlKey,
  normalizeText,
  matchingProjects,
  duplicateIds,
} from '../extension/lib/model.js';
import { captureInto, appendCapture } from '../extension/lib/capture.js';

function database(t) {
  const db = new Database(`test-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  return db;
}
const sync = (db, cloud, options) => cloud.sync(db, options);
const source = (url = 'https://example.com/article') => [
  { url, title: '网页', captured_at: new Date().toISOString(), kind: 'web_selection' },
];

test('offline saves survive reopening; list reads metadata and full-text finds body', async (t) => {
  const db = database(t),
    note = newRecord({
      title: '测试笔记',
      content: '只有正文包含 elusive-word',
      sources: source(),
    });
  await db.save(note, { expectedRev: 0 });
  const reopened = new Database(db.name, { broadcast: false });
  t.after(() => reopened.close());
  assert.equal((await reopened.get(note.id)).record.content, note.content);
  const list = await reopened.list({ view: 'all', query: 'elusive-word' });
  assert.equal(list.items[0].id, note.id);
  assert.equal(list.items[0].content, undefined);
  assert.equal((await reopened.get(note.id)).dirty, true);
});

test('Todo and pinned records stay ahead of recent records before filtering and pagination', async (t) => {
  const db = database(t);
  const list = newRecord({ type: 'list', updated_at: '2020-01-01T00:00:00.000Z' });
  const pinned = newRecord({
    title: 'Pinned match',
    tags: ['work'],
    updated_at: '2021-01-01T00:00:00.000Z',
  });
  const recent = newRecord({
    title: 'Recent match',
    tags: ['work'],
    updated_at: '2026-01-01T00:00:00.000Z',
  });
  for (const record of [list, pinned, recent]) await db.save(record);
  const options = { view: 'all', pinnedIds: [pinned.id, list.id, 'missing'], limit: 1 };
  const first = await db.list(options);
  assert.deepEqual(
    first.items.map((m) => m.id),
    [list.id],
  );
  assert.equal(first.hasMore, true);
  assert.deepEqual(
    (await db.list({ ...options, offset: 1 })).items.map((m) => m.id),
    [pinned.id],
  );
  assert.deepEqual(
    (await db.list({ ...options, offset: 2 })).items.map((m) => m.id),
    [recent.id],
  );
  assert.deepEqual(
    (await db.list({ ...options, query: 'match' })).items.map((m) => m.id),
    [pinned.id],
  );
  assert.deepEqual(
    (await db.list({ ...options, tag: 'work' })).items.map((m) => m.id),
    [pinned.id],
  );
  assert.deepEqual(
    (await db.list({ ...options, type: 'note' })).items.map((m) => m.id),
    [pinned.id],
  );
  const keywordProject = { keywords: ['recent'], match_fields: ['title'] };
  assert.deepEqual(
    (await db.list({ ...options, keywordProject })).items.map((m) => m.id),
    [recent.id],
  );
  await db.trash(pinned.id);
  assert.deepEqual(
    (await db.list(options)).items.map((m) => m.id),
    [list.id],
  );
  assert.deepEqual(
    (await db.list({ ...options, view: 'trash' })).items.map((m) => m.id),
    [pinned.id],
  );
});
test('capture always enters inbox; saved captures are queued for local handoff', async (t) => {
  const db = database(t),
    result = await captureInto(
      db,
      { title: '本地笔记', organization_state: 'organized' },
      { scope: 'local' },
    );
  const row = await db.get(result.id);
  assert.equal(row.record.organization_state, 'inbox');
  assert.equal(row.dirty, true);
  const repo = new SyncHarness(t);
  await sync(db, repo);
  assert.equal((await repo.device(db)).service.vault.list().total, 1);
});
test('URL matching preserves meaningful queries and fragments; text matching preserves indentation', () => {
  assert.equal(
    urlKey('https://example.com/?item=1&utm_source=x#/detail'),
    'https://example.com/?item=1#/detail',
  );
  assert.notEqual(urlKey('https://example.com/?item=1'), urlKey('https://example.com/?item=2'));
  assert.notEqual(urlKey('https://example.com/#a'), urlKey('https://example.com/#b'));
  assert.equal(normalizeText('\n  code\r\n    child\n'), '  code\n    child');
});
test('same URL with different excerpts is related, not exact; explicit duplicate append is atomic', async (t) => {
  const db = database(t),
    original = newRecord({ title: '文章', content: '第一段', sources: source() });
  await db.save(original);
  const result = await captureInto(db, { title: '文章', content: '第二段', sources: source() });
  assert.equal(result.status, 'duplicate');
  assert.equal((await db.captures())[0].matches[0].match, 'related');
  const capture = (await db.captures())[0];
  await appendCapture(db, original.id, capture);
  assert.match((await db.get(original.id)).record.content, /第一段.*第二段/s);
  assert.equal((await db.captures()).length, 0);
  await assert.rejects(appendCapture(db, original.id, capture), /另一窗口/);
  assert.equal((await db.allRows()).length, 1);
});
test('exact duplicates can be explicitly saved separately and are eligible for manual sync', async (t) => {
  const db = database(t),
    note = newRecord({ title: '原记录', content: '相同文字', sources: source() });
  await db.save(note);
  await captureInto(
    db,
    { title: '副本', content: '相同文字', sources: source() },
    { scope: 'local' },
  );
  const capture = (await db.captures())[0];
  assert.equal(capture.matches[0].match, 'exact');
  await db.finishCapture(capture.id, capture.record, 0, capture.scope);
  assert.equal((await db.allRows()).length, 2);
});
test('stale editor cannot overwrite changes from another window', async (t) => {
  const db = database(t),
    record = newRecord({ title: '原版' });
  await db.save(record);
  const before = await db.get(record.id);
  await db.mutate(record.id, (r) => ({ ...r, content: '新内容' }));
  await assert.rejects(
    db.save({ ...before.record, content: '旧窗口的内容' }, { expectedRev: before.rev }),
    StaleEditError,
  );
  assert.equal((await db.get(record.id)).record.content, '新内容');
});
test('backup restores projects, trash and pending capture; all saved data remains eligible for handoff', async (t) => {
  const a = database(t),
    b = database(t),
    project = newRecord({
      type: 'project',
      title: '项目',
      keywords: ['插件'],
      match_fields: ['content'],
      organization_state: 'organized',
    });
  const note = newRecord({
    title: '笔记',
    content: '插件参考',
    project_ids: [project.id],
    sources: source(),
  });
  await a.save(project);
  await a.save(note, { scope: 'local' });
  await a.trash(note.id);
  await captureInto(
    a,
    { title: '重复', content: '插件参考', sources: source() },
    { scope: 'local' },
  );
  const exported = await a.exportData();
  assert.equal(exported.records[0].baseHash, undefined);
  assert.equal(exported.googleToken, undefined);
  await b.applyImport(await b.previewImport(exported));
  assert.ok((await b.get(note.id)).record.deleted_at);
  const repeat = await b.previewImport(exported);
  assert.equal(repeat.entries.filter((e) => e.status === 'new').length, 0);
  await b.applyImport(repeat);
  assert.equal((await b.allRows()).length, 2);
  assert.equal((await b.captures()).length, 1);
  assert.equal(matchingProjects(note, [project]).length, 1);
  assert.equal((await a.get(note.id)).record.organization_state, 'inbox');
});
test('import has no partial writes when a record changes after preview', async (t) => {
  const db = database(t),
    note = newRecord({ title: '原版' }),
    added = newRecord({ title: '导入新增' });
  await db.save(note);
  const plan = await db.previewImport({
    format: 'pkm-nexus-backup',
    schema_version: 1,
    records: [
      { record: added, scope: 'sync' },
      { record: { ...note, content: '导入覆盖' }, scope: 'sync' },
    ],
  });
  await db.mutate(note.id, (r) => ({ ...r, content: '预览后编辑' }));
  await assert.rejects(db.applyImport(plan, true), StaleEditError);
  assert.equal(await db.get(added.id), undefined);
  assert.equal((await db.get(note.id)).record.content, '预览后编辑');
});
test('malformed future schema and unsafe links do not enter the database', async (t) => {
  const db = database(t),
    note = newRecord();
  await assert.rejects(
    db.previewImport({
      format: 'pkm-nexus-backup',
      schema_version: 1,
      records: [{ record: { ...note, schema_version: 6 }, scope: 'sync' }],
    }),
    /版本/,
  );
  assert.throws(() => newRecord({ sources: source('javascript:alert(1)') }), /HTTP/);
  assert.throws(() => normalizeRecord({ ...note, secret_new_field: 'do not drop' }), /未支持/);
  assert.equal((await db.allRows()).length, 0);
});
test('duplicates collected on separate computers are discoverable after sync; manual merge retains source in trash', async (t) => {
  const a = database(t),
    b = database(t),
    repo = new SyncHarness(t);
  const first = newRecord({
      title: '第一段',
      content: '第一段正文',
      tags: ['A'],
      sources: source(),
    }),
    second = newRecord({ title: '第二段', content: '第二段正文', tags: ['B'], sources: source() });
  await a.save(first);
  await b.save(second);
  await sync(a, repo);
  await sync(b, repo);
  await sync(a, repo);
  assert.equal(duplicateIds(await a.allCatalog()).size, 0); // Same page with different excerpts is related, not a duplicate.
  const sourceRow = await a.get(second.id),
    targetRow = await a.get(first.id);
  await a.mergeRecords(second.id, first.id, sourceRow.rev, targetRow.rev);
  const merged = await a.get(first.id);
  assert.match(merged.record.content, /第一段正文.*第二段正文/s);
  assert.deepEqual(merged.record.tags, ['A', 'B']);
  assert.ok((await a.get(second.id)).record.deleted_at);
  assert.equal(duplicateIds(await a.allCatalog()).size, 0);
  await sync(a, repo);
  await sync(b, repo);
  assert.ok((await b.get(second.id)).record.deleted_at);
  await a.restore(second.id);
  assert.equal((await a.get(second.id)).record.content, '第二段正文');
});
test('a merge cannot overwrite a newer target and unchanged mutation does not create a false revision', async (t) => {
  const db = database(t),
    first = newRecord({ title: '源', content: '源内容' }),
    second = newRecord({ title: '目标', content: '目标内容' });
  await db.save(first);
  await db.save(second);
  const before = await db.get(first.id);
  await db.mutate(first.id, (r) => r);
  assert.equal((await db.get(first.id)).rev, before.rev);
  const target = await db.get(second.id);
  await db.mutate(second.id, (r) => ({ ...r, content: '其他窗口新内容' }));
  await assert.rejects(
    db.mergeRecords(first.id, second.id, before.rev, target.rev),
    StaleEditError,
  );
  assert.equal((await db.get(first.id)).record.deleted_at, null);
  assert.equal((await db.get(second.id)).record.content, '其他窗口新内容');
});
test('draft backup preserves unfinished input and does not overwrite another local draft', async (t) => {
  const a = database(t),
    b = database(t),
    record = newRecord({ title: '未保存', content: '草稿正文' });
  const original = {
    record,
    rawUrls: 'https://example.com/not-finished ',
    expectedRev: 3,
    scope: 'local',
  };
  await a.setState('draft:editor:new', original);
  await b.setState('draft:editor:new', {
    ...original,
    record: { ...record, content: '本机其他草稿' },
  });
  const data = await a.exportData();
  assert.equal(data.drafts.length, 1);
  await b.applyImport(await b.previewImport(data));
  assert.equal((await b.getState('draft:editor:new')).record.content, '本机其他草稿');
  assert.equal((await b.drafts()).length, 2);
  await b.applyImport(await b.previewImport(data));
  assert.equal((await b.drafts()).length, 2);
});
test('unknown nested source fields are rejected instead of silently discarded', () => {
  const record = newRecord({ sources: source() });
  record.sources[0].custom_note = '不能丢';
  assert.throws(() => normalizeRecord(record), /未支持的字段/);
});

test('draft backup imports UI and collection state while dropping live browser tab handles', async (t) => {
  const a = database(t),
    b = database(t);
  const key = 'draft:panel',
    record = newRecord({ title: '带控件状态的草稿', content: '## collected:\n\n- 保留摘录' });
  await a.setState(key, {
    record,
    rawUrls: 'https://example.com/source',
    expectedRev: 0,
    scope: 'sync',
    savedAt: Date.now(),
    pendingTabs: [{ id: 45, url: 'https://example.com/another', window_id: 4 }],
    ui: {
      listMode: false,
      previewing: true,
      closeTabs: false,
      urlInput: 'https://example.com/unfinished',
      urlTitle: '尚未加入',
      selectedTabs: [45],
      tabDrawerOpen: true,
      collectedIds: ['capture-one'],
    },
  });
  const backup = await a.exportData();
  await b.applyImport(await b.previewImport(backup));
  const restored = await b.getState(key);
  assert.equal(restored.record.content, record.content);
  assert.equal(restored.ui.previewing, true);
  assert.equal(restored.ui.listMode, false);
  assert.equal(restored.ui.closeTabs, false);
  assert.equal(restored.ui.urlInput, 'https://example.com/unfinished');
  assert.deepEqual(restored.ui.collectedIds, ['capture-one']);
  assert.deepEqual(restored.pendingTabs, []);
  assert.deepEqual(restored.ui.selectedTabs, []);
  assert.equal(restored.ui.tabDrawerOpen, false);
  assert.equal((await b.previewImport(backup)).drafts.length, 0);
  backup.drafts[0].value.ui.previewing = 'invalid';
  await assert.rejects(b.previewImport(backup), /控件状态/);
});
test('import cannot silently overwrite pending capture content or requeue an already-saved capture', async (t) => {
  const db = database(t),
    record = newRecord({ title: '待处理', content: '原草稿' });
  await db.enqueueCapture(record, []);
  const data = {
    format: 'pkm-nexus-backup',
    schema_version: 1,
    records: [],
    pending_captures: [{ record: { ...record, content: '备份不同内容' }, scope: 'sync' }],
  };
  await assert.rejects(db.applyImport(await db.previewImport(data)), /内容不同/);
  assert.equal((await db.captures())[0].record.content, '原草稿');
  await db.finishCapture(record.id, record, 0, 'sync');
  await db.applyImport(
    await db.previewImport({ ...data, pending_captures: [{ record, scope: 'sync' }] }),
  );
  assert.equal((await db.captures()).length, 0);
});

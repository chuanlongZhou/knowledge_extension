import { SyncHarness } from './sync-fixture.js';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../extension/lib/db.js';
import { newRecord, digest, normalizeRecord, duplicateIds } from '../extension/lib/model.js';
import {
  upgradeProject,
  projectTree,
  saveProjectEdge,
  setProjectMemberships,
} from '../extension/lib/projects.js';
import { listMarkdown, listDocument, parseListMarkdown } from '../extension/lib/collections.js';
import { handoffCompanion } from '../extension/lib/companion.js';

test('tag rename updates records, queued captures, drafts and styles without losing other metadata; color-only edits preserve revisions', async (t) => {
  const db = database(t);
  const a = newRecord({
    title: '标签改名',
    content: '保留正文',
    tags: ['原名', '其他', '新名'],
    summary: '保留总结',
  });
  const b = newRecord({ title: '待处理', content: '捕获内容', tags: ['原名'] });
  await db.save(a);
  await db.enqueueCapture(b, []);
  await db.setState('draft:rename', { record: { ...a }, ui: { previewing: true } });
  await db.setState('ui:tag-styles', {
    原名: { color: '#2764b7', icon: '#' },
    其他: { color: '#285f49' },
  });
  await db.renameTag('原名', '新名', '#a3466b');
  const row = await db.get(a.id);
  assert.deepEqual(row.record.tags, ['新名', '其他']);
  assert.equal(row.record.content, '保留正文');
  assert.equal(row.record.summary, '保留总结');
  assert.deepEqual((await db.captures())[0].record.tags, ['新名']);
  assert.deepEqual((await db.getState('draft:rename')).record.tags, ['新名', '其他']);
  assert.deepEqual(await db.getState('ui:tag-styles'), {
    新名: { color: '#a3466b' },
    其他: { color: '#285f49' },
  });
  await db.renameTag('新名', '新名', '#2764b7');
  assert.equal((await db.get(a.id)).rev, row.rev);
});

test('concurrent tag rename fails atomically and cannot overwrite a newly edited record or preferences', async (t) => {
  const db = database(t);
  const a = newRecord({ title: 'A', tags: ['原名'] }),
    b = newRecord({ title: 'B', tags: ['原名'] });
  await db.saveMany([a, b].map((record) => ({ record })));
  const original = db.prepare.bind(db);
  let changed = false;
  db.prepare = async (record) => {
    const prepared = await original(record);
    if (record.tags.includes('新名') && !changed) {
      changed = true;
      await db.mutate(a.id, (r) => ({ ...r, content: '另一窗口的新正文' }));
    }
    return prepared;
  };
  await assert.rejects(db.renameTag('原名', '新名', '#2764b7'), /其他窗口修改/);
  assert.equal((await db.get(a.id)).record.content, '另一窗口的新正文');
  assert.deepEqual((await db.get(b.id)).record.tags, ['原名']);
  assert.equal(await db.getState('ui:tag-styles'), null);
});

test('canonical list Markdown preserves both sections, checks and dividers and exports once', async () => {
  const { toMarkdown } = await import('../extension/lib/model.js');
  const items = parseListMarkdown('- [x] task1\n---', true, parseListMarkdown('idea1', false));
  const record = newRecord({ type: 'list', list: items, content: listDocument(items) });
  assert.match(record.content, /## Todo\n\n- \[x\] task1\n---\n\n## Idea\n\n- idea1/);
  assert.equal((toMarkdown(record).match(/## Todo/g) || []).length, 1);
  const legacy = newRecord({ type: 'list', list: items });
  assert.match(toMarkdown(legacy), /- \[x\] task1/);
  legacy.content = '历史清单的额外备注';
  assert.match(toMarkdown(legacy), /历史清单的额外备注/);
  assert.match(toMarkdown(legacy), /- \[x\] task1/);
  const nextItems = parseListMarkdown('new task', true, items);
  const body = listDocument(items, legacy.content);
  const editedBody = listDocument(nextItems, body, items);
  assert.match(editedBody, /^历史清单的额外备注/);
  assert.match(editedBody, /- \[ \] new task/);
  assert.equal((editedBody.match(/## Todo/g) || []).length, 1);
});

const project = (title, parent = null) =>
  newRecord({
    schema_version: 5,
    type: 'project',
    title,
    parent_project_id: parent,
    graph: { edges: [] },
  });
const edge = (source, target, label = '参考') => ({
  id: crypto.randomUUID(),
  source,
  target,
  label,
});
function database(t) {
  const db = new Database(`projects-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  return db;
}
async function fixture(t) {
  const db = database(t),
    parent = project('研究'),
    child = project('实验', parent.id),
    other = project('其他');
  await db.saveMany([parent, child, other].map((record) => ({ record, expectedRev: 0 })));
  const a = newRecord({ title: 'A', tags: ['方法', '待读'], project_ids: [child.id, other.id] });
  const b = newRecord({ title: 'B', project_ids: [child.id] });
  const c = newRecord({ title: 'C', project_ids: [parent.id] });
  await db.saveMany([a, b, c].map((record) => ({ record, expectedRev: 0 })));
  return { db, parent, child, other, a, b, c };
}
test('projects form a tree while tags and direct project memberships remain many-to-many', async (t) => {
  const { db, parent, child, other, a } = await fixture(t);
  assert.deepEqual((await db.get(a.id)).record.tags, ['方法', '待读']);
  assert.deepEqual(
    (await db.list({ view: 'all', project: parent.id })).items.map((m) => m.title),
    ['C'],
  );
  assert.equal((await db.list({ view: 'all', project: child.id })).items.length, 2);
  assert.equal((await db.list({ view: 'all', project: other.id })).items.length, 1);
  assert.equal(projectTree([parent, child, other])[1].breadcrumb, '研究 / 实验');
});
test('cycles, missing parents, and deleting a parent with active children are rejected', async (t) => {
  const { db, parent, child } = await fixture(t);
  await assert.rejects(db.save({ ...parent, parent_project_id: child.id }), /循环/);
  await assert.rejects(db.save({ ...child, parent_project_id: 'missing' }), /父项目/);
  await assert.rejects(db.trash(parent.id), /子项目/);
  assert.equal((await db.get(parent.id)).record.deleted_at, null);
});
test('graph only permits two direct members; parent, sibling and self links are rejected', async (t) => {
  const { db, child, other, a, b, c } = await fixture(t);
  await saveProjectEdge(db, child.id, edge(a.id, b.id));
  await assert.rejects(saveProjectEdge(db, child.id, edge(a.id, c.id)), /直接成员/);
  await assert.rejects(saveProjectEdge(db, other.id, edge(a.id, b.id)), /直接成员/);
  await assert.rejects(saveProjectEdge(db, child.id, edge(a.id, a.id)), /自身/);
  await assert.rejects(saveProjectEdge(db, child.id, edge(b.id, a.id)), /一条关系/);
});
test('relation labels can be edited, and graphs are independent for shared records', async (t) => {
  const { db, child, other, a, b } = await fixture(t);
  await setProjectMemberships(db, b.id, [other.id], { add: true });
  const first = edge(a.id, b.id);
  await saveProjectEdge(db, child.id, first);
  await saveProjectEdge(db, child.id, { ...first, label: '补充' });
  await saveProjectEdge(db, other.id, edge(a.id, b.id, '比较'));
  assert.equal((await db.get(child.id)).record.graph.edges[0].label, '补充');
  assert.equal((await db.get(other.id)).record.graph.edges[0].label, '比较');
});
test('removing membership atomically removes only incident edges in that project', async (t) => {
  const { db, child, other, a, b } = await fixture(t);
  await setProjectMemberships(db, b.id, [other.id], { add: true });
  await saveProjectEdge(db, child.id, edge(a.id, b.id));
  await saveProjectEdge(db, other.id, edge(a.id, b.id));
  await setProjectMemberships(db, a.id, [other.id]);
  assert.equal((await db.get(child.id)).record.graph.edges.length, 0);
  assert.equal((await db.get(other.id)).record.graph.edges.length, 1);
  assert.deepEqual((await db.get(a.id)).record.tags, ['方法', '待读']);
});
test('deleting a record cleans its graph edges and restoring does not resurrect edges', async (t) => {
  const { db, child, a, b } = await fixture(t);
  await saveProjectEdge(db, child.id, edge(a.id, b.id));
  await db.trash(a.id);
  assert.equal((await db.get(child.id)).record.graph.edges.length, 0);
  await db.restore(a.id);
  assert.equal((await db.get(child.id)).record.graph.edges.length, 0);
});
test('simultaneous opposite moves cannot create a cycle', async (t) => {
  const db = database(t),
    a = project('A'),
    b = project('B');
  await db.saveMany([a, b].map((record) => ({ record })));
  const results = await Promise.allSettled([
    db.save({ ...a, parent_project_id: b.id }),
    db.save({ ...b, parent_project_id: a.id }),
  ]);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
});
test('malformed imported edges abort the full import without partial records', async (t) => {
  const db = database(t),
    p = project('P'),
    a = newRecord({ project_ids: [p.id] }),
    b = newRecord();
  p.graph.edges = [edge(a.id, b.id)];
  const plan = await db.previewImport({
    format: 'pkm-nexus-backup',
    schema_version: 5,
    records: [p, a, b].map((record) => ({ record })),
    pending_captures: [],
  });
  await assert.rejects(db.applyImport(plan), /直接成员/);
  assert.equal((await db.allRows()).length, 0);
});
test('hierarchy and graph IDs roundtrip through backup and Companion/Drive synchronization', async (t) => {
  const { db, child, a, b } = await fixture(t),
    remote = database(t),
    restored = database(t),
    repo = new SyncHarness(t);
  await saveProjectEdge(db, child.id, edge(a.id, b.id));
  await restored.applyImport(await restored.previewImport(await db.exportData()));
  assert.deepEqual((await restored.get(child.id)).record, (await db.get(child.id)).record);
  await repo.sync(db);
  await repo.sync(remote);
  assert.deepEqual((await remote.get(child.id)).record, (await db.get(child.id)).record);
});
test('old project hashes remain stable until explicit conversion, which keeps identity and members', async (t) => {
  const db = database(t),
    old = newRecord({
      schema_version: 2,
      type: 'project',
      title: '旧项目',
      keywords: ['旧词'],
      match_fields: ['title'],
    });
  const hash = await digest(old);
  await db.save(old);
  assert.equal(await digest(normalizeRecord((await db.get(old.id)).record)), hash);
  const upgraded = upgradeProject(old);
  await db.save(upgraded);
  assert.equal(upgraded.id, old.id);
  assert.equal(upgraded.schema_version, 5);
  assert.equal(upgraded.keywords, undefined);
  assert.deepEqual(upgraded.graph, { edges: [] });
});
test('child projects are nodes at the parent level, with no access to their internal records', async (t) => {
  const { db, parent, child, a, b, c } = await fixture(t);
  await saveProjectEdge(db, parent.id, edge(c.id, child.id));
  await assert.rejects(saveProjectEdge(db, parent.id, edge(c.id, b.id)), /直接成员/);
  await db.mutate(child.id, (p) => ({
    ...p,
    graph: { ...p.graph, positions: { [a.id]: { x: 140, y: 80 } } },
  }));
  await saveProjectEdge(db, child.id, edge(a.id, b.id));
  assert.deepEqual((await db.get(child.id)).record.graph.positions[a.id], { x: 140, y: 80 });
});
test('favorite and struck-through websites survive backup without changing legacy record hashes', async (t) => {
  const db = database(t),
    restored = database(t);
  const old = newRecord({
    type: 'website_group',
    url_list: [
      {
        id: crypto.randomUUID(),
        url: 'https://example.com',
        title: '网页',
        added_at: new Date().toISOString(),
        read_at: null,
      },
    ],
  });
  const before = await digest(old);
  assert.equal(await digest(normalizeRecord(old)), before);
  const record = normalizeRecord({
    ...old,
    schema_version: 5,
    favorite: true,
    url_list: old.url_list.map((u) => ({ ...u, removed_at: new Date().toISOString() })),
  });
  await db.save(record);
  assert.equal((await db.list({ view: 'favorites' })).items.length, 1);
  await restored.applyImport(await restored.previewImport(await db.exportData()));
  assert.deepEqual((await restored.get(record.id)).record, record);
});
test('Markdown list parsing retains IDs, completion, idea section and dividers', () => {
  const todo = parseListMarkdown('- [ ] 研究方法\n- [x] 已读资料\n---', true);
  const all = parseListMarkdown('- 有个想法', false, todo);
  const updated = parseListMarkdown('- [x] 研究方法\n- [x] 已读资料\n---', true, all);
  assert.equal(updated.find((i) => i.text === '研究方法').id, todo[0].id);
  assert.equal(updated.find((i) => i.text === '研究方法').checked, true);
  assert.equal(updated.filter((i) => i.kind === 'divider').length, 1);
  assert.equal(listMarkdown(updated, false), '- 有个想法');
});
test('Companion pulls dependency records as one validated batch even when project graph arrives first', async (t) => {
  const { db, child, a, b } = await fixture(t),
    target = database(t);
  await saveProjectEdge(db, child.id, edge(a.id, b.id));
  const records = (await db.allRows())
    .map((r) => r.record)
    .sort((a, b) => (b.type === 'project') - (a.type === 'project'));
  const items = await Promise.all(
    records.map(async (record, i) => ({
      record,
      hash: await digest(record),
      revision: String(i),
      heads: ['head'],
    })),
  );
  const client = {
    call: async (method, { cursor = 0 } = {}) =>
      method === 'status'
        ? { vaultId: 'test', pendingUploads: 0 }
        : method === 'records.changes'
          ? {
              items: items.slice(cursor, cursor + 1),
              cursor: cursor + 1,
              hasMore: cursor + 1 < items.length,
            }
          : {},
    close() {},
  };
  await handoffCompanion(target, { client, pullOnly: true });
  assert.deepEqual((await target.get(child.id)).record, (await db.get(child.id)).record);
});

test('membership removal also cleans a trashed project so that it can be restored', async (t) => {
  const { db, child, other, a, b } = await fixture(t);
  await saveProjectEdge(db, child.id, edge(a.id, b.id));
  await db.trash(child.id);
  await setProjectMemberships(db, a.id, [other.id]);
  await db.restore(child.id);
  assert.deepEqual((await db.get(child.id)).record.graph.edges, []);
});
test('duplicate check includes identical bodies but excludes different excerpts of the same page', async (t) => {
  const db = database(t),
    sources = [
      {
        url: 'https://example.com/page',
        title: '原页',
        kind: 'web_page',
        captured_at: new Date().toISOString(),
      },
    ];
  const a = newRecord({ content: '相同正文', sources }),
    b = newRecord({ content: '相同正文', sources }),
    c = newRecord({ content: '不同摘录', sources });
  await db.saveMany([a, b, c].map((record) => ({ record })));
  assert.deepEqual([...duplicateIds(await db.allCatalog())].sort(), [a.id, b.id].sort());
});

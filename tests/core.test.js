import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Database, StaleEditError} from '../extension/lib/db.js';
import {newRecord, normalizeRecord, digest, recordPath, urlKey, normalizeText, matchingProjects, duplicateIds} from '../extension/lib/model.js';
import {captureInto, appendCapture} from '../extension/lib/capture.js';
import {GitHub} from '../extension/lib/github.js';
import {synchronize, withSyncLock} from '../extension/lib/sync.js';
import {MockGitHub} from './mock-github.js';

function database(t) { const db = new Database(`test-${crypto.randomUUID()}`, {broadcast: false}); t.after(() => db.close()); return db; }
const config = {owner: 'test-owner', repo: 'knowledge', branch: ''};
function api(repo, opts = {}) { return new GitHub(config, 'fake-token-only-for-tests', {fetchImpl: repo.fetch.bind(repo), ...opts}); }
const sync = (db, repo, opts) => synchronize(db, api(repo), opts);
const source = (url = 'https://example.com/article') => [{url, title: '网页', captured_at: new Date().toISOString(), kind: 'web_selection'}];

test('offline saves survive reopening; list reads metadata and full-text finds body', async t => {
  const db = database(t), note = newRecord({title: '测试笔记', content: '只有正文包含 elusive-word', sources: source()});
  await db.save(note, {expectedRev: 0});
  const reopened = new Database(db.name, {broadcast: false}); t.after(() => reopened.close());
  assert.equal((await reopened.get(note.id)).record.content, note.content);
  const list = await reopened.list({view: 'all', query: 'elusive-word'});
  assert.equal(list.items[0].id, note.id); assert.equal(list.items[0].content, undefined);
  assert.equal((await reopened.get(note.id)).dirty, true);
});
test('capture always enters inbox; legacy local-only flags no longer prevent manual synchronization', async t => {
  const db = database(t), result = await captureInto(db, {title: '本地笔记', organization_state: 'organized'}, {scope: 'local'});
  const row = await db.get(result.id); assert.equal(row.record.organization_state, 'inbox'); assert.equal(row.dirty, true);
  const repo = new MockGitHub();assert.equal(repo.calls.length,0); await sync(db, repo); assert.equal(repo.json('index/global_index.json').entries.length,1);
  assert.equal((await db.get(row.id)).scope, 'sync');
});
test('URL matching preserves meaningful queries and fragments; text matching preserves indentation', () => {
  assert.equal(urlKey('https://example.com/?item=1&utm_source=x#/detail'), 'https://example.com/?item=1#/detail');
  assert.notEqual(urlKey('https://example.com/?item=1'), urlKey('https://example.com/?item=2'));
  assert.notEqual(urlKey('https://example.com/#a'), urlKey('https://example.com/#b'));
  assert.equal(normalizeText('\n  code\r\n    child\n'), '  code\n    child');
});
test('same URL with different excerpts is related, not exact; explicit duplicate append is atomic', async t => {
  const db = database(t), original = newRecord({title: '文章', content: '第一段', sources: source()}); await db.save(original);
  const result = await captureInto(db, {title: '文章', content: '第二段', sources: source()});
  assert.equal(result.status, 'duplicate'); assert.equal((await db.captures())[0].matches[0].match, 'related');
  const capture = (await db.captures())[0]; await appendCapture(db, original.id, capture);
  assert.match((await db.get(original.id)).record.content, /第一段.*第二段/s); assert.equal((await db.captures()).length, 0);
  await assert.rejects(appendCapture(db, original.id, capture), /另一窗口/);
  assert.equal((await db.allRows()).length, 1);
});
test('exact duplicates can be explicitly saved separately and are eligible for manual sync', async t => {
  const db = database(t), note = newRecord({title: '原记录', content: '相同文字', sources: source()}); await db.save(note);
  await captureInto(db, {title: '副本', content: '相同文字', sources: source()}, {scope: 'local'});
  const capture = (await db.captures())[0]; assert.equal(capture.matches[0].match, 'exact');
  await db.finishCapture(capture.id, capture.record, 0, capture.scope);
  assert.equal((await db.get(capture.id)).scope, 'sync'); assert.equal((await db.allRows()).length, 2);
});
test('stale editor cannot overwrite changes from another window', async t => {
  const db = database(t), record = newRecord({title: '原版'}); await db.save(record);
  const before = await db.get(record.id); await db.mutate(record.id, r => ({...r, content: '新内容'}));
  await assert.rejects(db.save({...before.record, content: '旧窗口的内容'}, {expectedRev: before.rev}), StaleEditError);
  assert.equal((await db.get(record.id)).record.content, '新内容');
});
test('two independent computers push, pull and edit through actual Git API adapter', async t => {
  const a = database(t), b = database(t), repo = new MockGitHub(), note = newRecord({title: '跨电脑', content: 'A 的原文'});
  await a.save(note); await sync(a, repo);
  assert.equal(repo.json(recordPath(note)).content, 'A 的原文'); assert.equal(repo.json('index/global_index.json').entries.length, 1);
  await sync(b, repo); assert.equal((await b.get(note.id)).record.content, 'A 的原文');
  await b.mutate(note.id, r => ({...r, content: 'B 修改'})); await sync(b, repo); await sync(a, repo);
  assert.equal((await a.get(note.id)).record.content, 'B 修改'); assert.equal((await a.get(note.id)).dirty, false);
  assert.equal((await a.snapshot()).rows.get(note.id).record, undefined, 'clean bodies are not loaded into sync snapshots');
});
test('simultaneous edits preserve both versions and explicit manual merge can be synchronized', async t => {
  const a = database(t), b = database(t), repo = new MockGitHub(), note = newRecord({title: '冲突', content: '共同版本'});
  await a.save(note); await sync(a, repo); await sync(b, repo);
  await a.mutate(note.id, r => ({...r, content: 'A 修改'})); await b.mutate(note.id, r => ({...r, content: 'B 修改'})); await sync(a, repo);
  const result = await sync(b, repo); assert.equal(result.status, 'conflicts');
  const conflict = (await b.conflicts())[0]; assert.equal(conflict.remoteRecord.content, 'A 修改'); assert.equal((await b.get(note.id)).record.content, 'B 修改');
  await b.resolveConflict(note.id, 'merge', {...(await b.get(note.id)).record, content: 'A 修改\nB 修改'});
  await sync(b, repo); await sync(a, repo); assert.equal((await a.get(note.id)).record.content, 'A 修改\nB 修改');
});
test('edit versus delete conflicts, restoration keeps ID, and purge removes current body without resurrection', async t => {
  const a = database(t), b = database(t), repo = new MockGitHub(), note = newRecord({title: '删除测试', content: '重要内容'});
  await a.save(note); await sync(a, repo); await sync(b, repo);
  await a.trash(note.id); await b.mutate(note.id, r => ({...r, content: '离线修改'})); await sync(a, repo);
  assert.equal((await sync(b, repo)).status, 'conflicts'); assert.ok((await b.conflicts())[0].remoteRecord.deleted_at);
  await b.resolveConflict(note.id, 'remote'); await b.restore(note.id); await sync(b, repo); await sync(a, repo);
  assert.equal((await a.get(note.id)).record.deleted_at, null);
  await a.trash(note.id); await a.purge(note.id); await sync(a, repo);
  assert.equal(repo.json(recordPath(note)), null); assert.equal(repo.json(`tombstones/${note.id}.json`).content, undefined);
  await b.mutate(note.id, r => ({...r, content: '又一条离线修改'})); assert.equal((await sync(b, repo)).status, 'conflicts');
  await assert.rejects(b.resolveConflict(note.id, 'local'), /另存/);
  await b.resolveConflict(note.id, 'remote'); await sync(b, repo); assert.equal((await b.get(note.id)).record.kind, 'tombstone');
});
test('edits made while uploading remain pending instead of being acknowledged with an older snapshot', async t => {
  const db = database(t), repo = new MockGitHub(), note = newRecord({title: '上传中', content: '第一版'}); await db.save(note);
  repo.beforeUpdate = async () => { await db.mutate(note.id, r => ({...r, content: '上传中又编辑'})); };
  await sync(db, repo); assert.equal(repo.json(recordPath(note)).content, '第一版');
  assert.equal((await db.get(note.id)).record.content, '上传中又编辑'); assert.equal((await db.get(note.id)).dirty, true);
  await sync(db, repo); assert.equal(repo.json(recordPath(note)).content, '上传中又编辑'); assert.equal((await db.get(note.id)).dirty, false);
});
test('concurrent remote ref updates retry without losing an unrelated remote record', async t => {
  const a = database(t), b = database(t), repo = new MockGitHub(), first = newRecord({title: '已有记录'}), local = newRecord({title: '本地新增'}), other = newRecord({title: '另一电脑新增'});
  await a.save(first); await sync(a, repo); await b.save(other);
  await a.save(local); repo.beforeUpdate = async () => { await sync(b, repo); };
  await sync(a, repo); assert.equal(repo.json('index/global_index.json').entries.length, 3); assert.ok(await a.get(other.id));
  assert.ok(repo.calls.filter(call => call.method === 'PATCH').every(call => call.body.force === false));
});
test('request failure preserves durable changes; lost successful response is verified without duplicates', async t => {
  const db = database(t), repo = new MockGitHub(), note = newRecord({title: '重试', content: '数据'}); await db.save(note);
  repo.failNext = {method: 'POST', status: 503}; await assert.rejects(sync(db, repo), /失败/); assert.equal((await db.get(note.id)).dirty, true);
  repo.loseUpdateResponse = true; await sync(db, repo); assert.equal((await db.get(note.id)).dirty, false);
  await sync(db, repo); assert.equal(repo.json('index/global_index.json').entries.length, 1);
});
test('public repositories and invalid tokens fail before any write', async t => {
  const db = database(t), repo = new MockGitHub(); repo.private = false; await db.save(newRecord({title: '私有内容'}));
  await assert.rejects(sync(db, repo), /私有仓库/); assert.equal(repo.calls.filter(c => c.method !== 'GET').length, 0);
  await assert.rejects(synchronize(db, new GitHub(config, 'wrong', {fetchImpl: repo.fetch.bind(repo)})), /Token/);
});
test('index hash mismatch fails safely; explicit scanning rebuilds metadata from user-modified files', async t => {
  const db = database(t), repo = new MockGitHub(), note = newRecord({title: '索引恢复', content: '原版'}); await db.save(note); await sync(db, repo);
  const changed = {...note, content: '在仓库手动修改'}; repo.externalWrite(recordPath(note), changed);
  const another = database(t); await assert.rejects(sync(another, repo), /索引不一致/);
  await sync(db, repo, {scan: true}); assert.equal((await db.get(note.id)).record.content, '在仓库手动修改');
  assert.equal(repo.json('index/global_index.json').entries[0].hash, await digest(normalizeRecord(changed)));
});
test('a missing previously-synced record is never silently re-uploaded', async t => {
  const db = database(t), repo = new MockGitHub(), note = newRecord({title: '防复活'}); await db.save(note); await sync(db, repo);
  repo.externalWrite('index/global_index.json', {format: 'pkm-nexus-index', schema_version: 1, entries: []});
  await assert.rejects(sync(db, repo), /缺少曾同步/); assert.equal((await db.get(note.id)).record.title, '防复活');
});
test('backup restores projects, trash and pending capture; legacy scope flags migrate to sync', async t => {
  const a = database(t), b = database(t), project = newRecord({type: 'project', title: '项目', keywords: ['插件'], match_fields: ['content'], organization_state: 'organized'});
  const note = newRecord({title: '笔记', content: '插件参考', project_ids: [project.id], sources: source()}); await a.save(project); await a.save(note, {scope: 'local'}); await a.trash(note.id);
  await captureInto(a, {title: '重复', content: '插件参考', sources: source()}, {scope: 'local'});
  const exported = await a.exportData(); assert.equal(exported.records[0].baseHash, undefined); assert.equal(exported.githubToken, undefined);
  await b.applyImport(await b.previewImport(exported)); assert.equal((await b.get(note.id)).scope, 'sync'); assert.ok((await b.get(note.id)).record.deleted_at); assert.equal((await b.captures())[0].scope, 'sync');
  const repeat = await b.previewImport(exported); assert.equal(repeat.entries.filter(e => e.status === 'new').length, 0); await b.applyImport(repeat); assert.equal((await b.allRows()).length, 2); assert.equal((await b.captures()).length, 1);
  assert.equal(matchingProjects(note, [project]).length, 1); assert.equal((await a.get(note.id)).record.organization_state, 'inbox');
});
test('import has no partial writes when a record changes after preview', async t => {
  const db = database(t), note = newRecord({title: '原版'}), added = newRecord({title: '导入新增'}); await db.save(note);
  const plan = await db.previewImport({format: 'pkm-nexus-backup', schema_version: 1, records: [{record: added, scope: 'sync'}, {record: {...note, content: '导入覆盖'}, scope: 'sync'}]});
  await db.mutate(note.id, r => ({...r, content: '预览后编辑'})); await assert.rejects(db.applyImport(plan, true), StaleEditError);
  assert.equal(await db.get(added.id), undefined); assert.equal((await db.get(note.id)).record.content, '预览后编辑');
});
test('malformed future schema and unsafe links do not enter the database', async t => {
  const db = database(t), note = newRecord();
  await assert.rejects(db.previewImport({format: 'pkm-nexus-backup', schema_version: 1, records: [{record: {...note, schema_version: 5}, scope: 'sync'}]}), /版本/);
  assert.throws(() => newRecord({sources: source('javascript:alert(1)')}), /HTTP/); assert.throws(() => normalizeRecord({...note, secret_new_field: 'do not drop'}), /未支持/);
  assert.equal((await db.allRows()).length, 0);
});
test('a repository binding prevents accidental mixing of databases', async t => {
  const db = database(t), repo = new MockGitHub(); await sync(db, repo); await assert.rejects(db.assertRepo('someone/other#main'), /绑定另一仓库/);
});
test('exclusive sync lock rejects a second window instead of concurrent uploads', async () => {
  const locks = {request: async (name, options, callback) => callback(null)};
  await assert.rejects(withSyncLock(() => { throw new Error('should never execute'); }, locks), /另一个/);
});
test('duplicates collected on separate computers are discoverable after sync; manual merge retains source in trash', async t => {
  const a = database(t), b = database(t), repo = new MockGitHub();
  const first = newRecord({title: '第一段', content: '第一段正文', tags: ['A'], sources: source()}), second = newRecord({title: '第二段', content: '第二段正文', tags: ['B'], sources: source()});
  await a.save(first); await b.save(second); await sync(a, repo); await sync(b, repo); await sync(a, repo);
  assert.equal(duplicateIds(await a.allCatalog()).size, 2);
  const sourceRow = await a.get(second.id), targetRow = await a.get(first.id); await a.mergeRecords(second.id, first.id, sourceRow.rev, targetRow.rev);
  const merged = await a.get(first.id); assert.match(merged.record.content, /第一段正文.*第二段正文/s); assert.deepEqual(merged.record.tags, ['A', 'B']);
  assert.ok((await a.get(second.id)).record.deleted_at); assert.equal(duplicateIds(await a.allCatalog()).size, 0);
  await sync(a, repo); await sync(b, repo); assert.ok((await b.get(second.id)).record.deleted_at);
  await a.restore(second.id); assert.equal((await a.get(second.id)).record.content, '第二段正文');
});
test('a merge cannot overwrite a newer target and unchanged mutation does not create a false revision', async t => {
  const db = database(t), first = newRecord({title: '源', content: '源内容'}), second = newRecord({title: '目标', content: '目标内容'}); await db.save(first); await db.save(second);
  const before = await db.get(first.id); await db.mutate(first.id, r => r); assert.equal((await db.get(first.id)).rev, before.rev);
  const target = await db.get(second.id); await db.mutate(second.id, r => ({...r, content: '其他窗口新内容'}));
  await assert.rejects(db.mergeRecords(first.id, second.id, before.rev, target.rev), StaleEditError); assert.equal((await db.get(first.id)).record.deleted_at, null); assert.equal((await db.get(second.id)).record.content, '其他窗口新内容');
});
test('draft backup preserves unfinished input and does not overwrite another local draft', async t => {
  const a = database(t), b = database(t), record = newRecord({title: '未保存', content: '草稿正文'});
  const original = {record, rawUrls: 'https://example.com/not-finished ', expectedRev: 3, scope: 'local'};
  await a.setState('draft:editor:new', original); await b.setState('draft:editor:new', {...original, record: {...record, content: '本机其他草稿'}});
  const data = await a.exportData(); assert.equal(data.drafts.length, 1);
  await b.applyImport(await b.previewImport(data)); assert.equal((await b.getState('draft:editor:new')).record.content, '本机其他草稿'); assert.equal((await b.drafts()).length, 2);
  await b.applyImport(await b.previewImport(data)); assert.equal((await b.drafts()).length, 2);
});
test('unknown nested source fields are rejected instead of silently discarded', () => {
  const record = newRecord({sources: source()}); record.sources[0].custom_note = '不能丢'; assert.throws(() => normalizeRecord(record), /未支持的字段/);
});
test('import cannot silently overwrite pending capture content or requeue an already-saved capture', async t => {
  const db = database(t), record = newRecord({title: '待处理', content: '原草稿'}); await db.enqueueCapture(record, []);
  const data = {format: 'pkm-nexus-backup', schema_version: 1, records: [], pending_captures: [{record: {...record, content: '备份不同内容'}, scope: 'sync'}]};
  await assert.rejects(db.applyImport(await db.previewImport(data)), /内容不同/); assert.equal((await db.captures())[0].record.content, '原草稿');
  await db.finishCapture(record.id, record, 0, 'sync');
  await db.applyImport(await db.previewImport({...data, pending_captures: [{record, scope: 'sync'}]})); assert.equal((await db.captures()).length, 0);
});

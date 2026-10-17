import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database, StaleEditError } from '../extension/lib/db.js';
import { newRecord, digest } from '../extension/lib/model.js';
import { handoffCompanion, synchronizeCompanion } from '../extension/lib/companion.js';
import { buildLocalBackup, previewZipImport } from '../extension/lib/backup.js';
import { SyncHarness } from './sync-fixture.js';

function browser(t) {
  const db = new Database(`sync-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  return db;
}

test('two browser databases synchronize edits in both directions through independent local vaults and Drive', async (t) => {
  const cloud = new SyncHarness(t),
    a = browser(t),
    b = browser(t);
  const note = newRecord({ title: 'Shared', content: 'A initial' });
  await a.save(note);
  await cloud.sync(a);
  assert.equal((await a.get(note.id)).dirty, false);
  await cloud.sync(b);
  assert.equal((await b.get(note.id)).record.content, 'A initial');
  assert.equal((await b.list({ view: 'pending' })).items.length, 0);
  await b.mutate(note.id, (r) => ({ ...r, content: 'B edit' }));
  await cloud.sync(b);
  await cloud.sync(a);
  assert.equal((await a.get(note.id)).record.content, 'B edit');
  const status = await a.getState('companion:last');
  assert.equal(status.driveConnected, true);
  assert.equal(status.driveBound, true);
  assert.equal(status.drivePending, 0);
  assert.ok(status.lastDriveSync);
});

test('offline concurrent edits retain both branches, allow unrelated records, and propagate explicit resolution', async (t) => {
  const cloud = new SyncHarness(t),
    a = browser(t),
    b = browser(t);
  const note = newRecord({ title: 'Conflict', content: 'base' });
  await a.save(note);
  await cloud.sync(a);
  await cloud.sync(b);
  await a.mutate(note.id, (r) => ({ ...r, content: 'A offline' }));
  await b.mutate(note.id, (r) => ({ ...r, content: 'B offline' }));
  const unrelated = newRecord({ title: 'Unrelated' });
  await b.save(unrelated);
  await cloud.sync(a);
  assert.equal((await cloud.sync(b)).conflicts, 1);
  await cloud.sync(a);
  assert.ok(await a.get(unrelated.id));
  const versions = await cloud.versions(b, note.id);
  assert.deepEqual(versions.map((v) => v.record.content).sort(), ['A offline', 'B offline']);
  await cloud.resolve(b, { ...note, content: 'manual merge' });
  await cloud.sync(a);
  assert.equal((await a.get(note.id)).record.content, 'manual merge');
  assert.deepEqual(await a.getState('companion:conflicts'), []);
});

test('edit versus deletion produces a conflict; restoration and minimal deletion markers preserve identity', async (t) => {
  const cloud = new SyncHarness(t),
    a = browser(t),
    b = browser(t);
  const note = newRecord({ title: 'Delete me' });
  await a.save(note);
  await cloud.sync(a);
  await cloud.sync(b);
  await a.trash(note.id);
  await b.mutate(note.id, (r) => ({ ...r, content: 'offline edit' }));
  await cloud.sync(a);
  await cloud.sync(b);
  const versions = await cloud.versions(b, note.id);
  assert.equal(versions.length, 2);
  const deletion = versions.find((v) => v.record.deleted_at).record;
  await cloud.resolve(b, deletion);
  await cloud.sync(a);
  assert.ok((await a.get(note.id)).record.deleted_at);
  await a.restore(note.id);
  await cloud.sync(a);
  await cloud.sync(b);
  assert.equal((await b.get(note.id)).record.deleted_at, null);
  await a.trash(note.id);
  await a.purge(note.id);
  await cloud.sync(a);
  await cloud.sync(b);
  assert.equal((await b.get(note.id)).record.kind, 'tombstone');
  assert.equal((await b.get(note.id)).record.content, undefined);
  await cloud.sync(a);
  assert.equal((await a.list({ view: 'all' })).items.length, 0);
});

test('browser edits during local handoff remain queued and are delivered on retry', async (t) => {
  const cloud = new SyncHarness(t),
    db = browser(t);
  const note = newRecord({ title: 'During handoff', content: 'first' });
  await db.save(note);
  const { client, service } = await cloud.device(db);
  let changed = false;
  const delayed = {
    close() {},
    call: async (command, payload) => {
      const result = await client.call(command, payload);
      if (command === 'records.put' && !changed) {
        changed = true;
        await db.mutate(note.id, (r) => ({ ...r, content: 'second' }));
      }
      return result;
    },
  };
  await handoffCompanion(db, { client: delayed, locks: null });
  assert.equal(service.vault.get(note.id).record.content, 'first');
  assert.equal((await db.get(note.id)).dirty, true);
  await cloud.sync(db);
  assert.equal(service.vault.get(note.id).record.content, 'second');
  assert.equal((await db.get(note.id)).dirty, false);
});

test('lost local acknowledgement retries without duplicating revisions or losing browser data', async (t) => {
  const cloud = new SyncHarness(t),
    db = browser(t);
  const note = newRecord({ title: 'Retry' });
  await db.save(note);
  const { client, service } = await cloud.device(db);
  let fail = true;
  const flaky = {
    close() {},
    call: async (command, payload) => {
      const result = await client.call(command, payload);
      if (command === 'records.put' && fail) {
        fail = false;
        throw new Error('Lost local response');
      }
      return result;
    },
  };
  await assert.rejects(handoffCompanion(db, { client: flaky, locks: null }), /Lost local/);
  assert.equal((await db.get(note.id)).dirty, true);
  await cloud.sync(db);
  assert.equal(service.vault.db.prepare('SELECT count(*) AS n FROM revisions').get().n, 1);
  assert.equal((await db.get(note.id)).dirty, false);
});

test('cloud failure reports local success and pending cloud work; a later retry clears the failure', async (t) => {
  const cloud = new SyncHarness(t),
    db = browser(t);
  const note = newRecord({ title: 'Durable offline' });
  await db.save(note);
  const { client, service } = await cloud.device(db);
  cloud.remote.failNext = { status: 403 };
  const result = await synchronizeCompanion(db, { client, locks: null, remote: true });
  assert.match(result.driveError, /权限/);
  assert.ok(service.vault.get(note.id));
  assert.equal((await db.getState('companion:last')).drivePending, 1);
  assert.ok((await db.getState('companion:last')).driveError);
  assert.equal(await db.getState('companion:error'), null);
  await cloud.sync(db);
  assert.equal((await db.getState('companion:last')).driveError, null);
  assert.equal((await db.getState('companion:last')).drivePending, 0);
});

test('cloud setup errors preserve the local handoff without claiming a successful Drive sync', async (t) => {
  const cloud = new SyncHarness(t),
    db = browser(t);
  const { client, service } = await cloud.device(db);
  service.vault.setState('drive:binding', null);
  service.auth.status = async () => ({ configured: false, connected: false });
  const note = newRecord({ title: 'Before Google sign-in' });
  await db.save(note);
  const result = await synchronizeCompanion(db, { client, locks: null, remote: true });
  assert.match(result.driveError, /资料库/);
  assert.equal(result.lastDriveSync, null);
  assert.equal(result.driveConnected, false);
  assert.equal(result.driveBound, false);
  assert.ok(service.vault.get(note.id));
});

test('incoming browser changes and cursor commit atomically, retaining a concurrent edit on failure', async (t) => {
  const db = browser(t),
    note = newRecord({ title: 'CAS', content: 'base' });
  await db.save(note);
  const before = await db.get(note.id);
  await db.mutate(note.id, (r) => ({ ...r, content: 'new browser edit' }));
  const remote = { ...note, content: 'remote edit' },
    link = { hash: await digest(remote), revision: 'remote' };
  await assert.rejects(
    db.applyCompanionChanges(
      [{ record: remote, expectedRev: before.rev }],
      new Map([[note.id, link]]),
      99,
      [],
    ),
    StaleEditError,
  );
  assert.equal(await db.getState('companion:cursor', 0), 0);
  assert.equal(await db.getState(`companion:row:${note.id}`), null);
  assert.equal((await db.get(note.id)).record.content, 'new browser edit');
});

test('a damaged dependency batch cannot advance the browser cursor or partially install a project', async (t) => {
  const db = browser(t);
  const missing = crypto.randomUUID(),
    project = newRecord({
      schema_version: 5,
      parent_project_id: null,
      type: 'project',
      title: 'Broken graph',
      graph: {
        edges: [
          { id: crypto.randomUUID(), source: missing, target: crypto.randomUUID(), label: '' },
        ],
      },
    });
  await assert.rejects(
    db.applyCompanionChanges([{ record: project, expectedRev: 0 }], new Map(), 7, []),
    /成员|节点|关系/,
  );
  assert.equal(await db.getState('companion:cursor', 0), 0);
  assert.equal((await db.allRows()).length, 0);
});

test('large attachments are handed off in chunks and another browser downloads verified bytes on demand', async (t) => {
  const cloud = new SyncHarness(t),
    a = browser(t),
    b = browser(t),
    restored = browser(t);
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(73);
  const descriptor = await a.storeAsset(new Blob([bytes], { type: 'image/png' }), 'large.png');
  const note = newRecord({
    title: 'Media',
    content: `![Media](${descriptor.path})`,
    attachments: [descriptor],
  });
  await a.save(note);
  await cloud.sync(a);
  await cloud.sync(b);
  assert.equal((await b.getAsset(descriptor.id)).blob, undefined);
  const remoteAsset = [...cloud.remote.files.values()].find(
    (f) => f.appProperties?.pkm_role === 'asset',
  );
  assert.ok(!cloud.remote.calls.some((c) => c.url.includes(`${remoteAsset.id}?alt=media`)));
  const blob = await cloud.asset(b, descriptor);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  const zip = await buildLocalBackup(b, { resolveAsset: (d) => cloud.asset(b, d) });
  await restored.applyImport(await previewZipImport(restored, zip));
  assert.equal((await restored.getAsset(descriptor.id)).blob.size, bytes.length);
});

test('an existing browser binding rejects a different local vault before transferring any records', async (t) => {
  const cloud = new SyncHarness(t),
    db = browser(t);
  const { client, service } = await cloud.device(db);
  await db.setState('companion:vault', 'another-vault');
  await db.save(newRecord({ title: 'Stay here' }));
  await assert.rejects(handoffCompanion(db, { client, locks: null }), /另一份本地/);
  assert.equal(service.vault.list().total, 0);
});

test('an occupied browser handoff lock never starts another transfer', async (t) => {
  const db = browser(t);
  const result = await handoffCompanion(db, {
    locks: { request: async (_name, _options, fn) => fn(null) },
    client: {
      call() {
        throw new Error('Must not call');
      },
    },
  });
  assert.deepEqual(result, { busy: true });
});

test('a new device defers a graph that depends on a conflict, receives unrelated notes, and installs it after resolution', async (t) => {
  const cloud = new SyncHarness(t),
    a = browser(t),
    b = browser(t),
    newcomer = browser(t);
  const project = newRecord({
    schema_version: 5,
    type: 'project',
    title: 'Graph',
    parent_project_id: null,
    graph: { edges: [] },
  });
  const first = newRecord({ title: 'Conflicted node', project_ids: [project.id] });
  const second = newRecord({ title: 'Other node', project_ids: [project.id] });
  project.graph.edges = [
    { id: crypto.randomUUID(), source: first.id, target: second.id, label: 'Related' },
  ];
  await a.saveMany([project, first, second].map((record) => ({ record })));
  await cloud.sync(a);
  await cloud.sync(b);
  await a.mutate(first.id, (r) => ({ ...r, content: 'A' }));
  await b.mutate(first.id, (r) => ({ ...r, content: 'B' }));
  await cloud.sync(a);
  await cloud.sync(b);
  const unrelated = newRecord({ title: 'Still available' });
  await a.save(unrelated);
  await cloud.sync(a);
  const status = await cloud.sync(newcomer);
  assert.equal(status.conflicts, 1);
  assert.ok(status.deferred > 0);
  assert.ok(await newcomer.get(unrelated.id));
  assert.equal(await newcomer.get(project.id), undefined);
  await cloud.resolve(b, { ...first, content: 'Resolved' });
  await cloud.sync(newcomer);
  assert.equal((await newcomer.get(first.id)).record.content, 'Resolved');
  assert.equal((await newcomer.get(project.id)).record.graph.edges.length, 1);
  assert.deepEqual(await newcomer.getState('companion:deferred'), []);
});

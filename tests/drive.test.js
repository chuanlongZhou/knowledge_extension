import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../extension/lib/db.js';
import { newRecord } from '../extension/lib/model.js';
import { GoogleDrive } from '../extension/lib/drive-client.js';
import { bindFolder, syncDrive, resolveDriveConflict } from '../extension/lib/drive-sync.js';
import { MockDirectDrive } from './mock-direct-drive.js';
const decoder = new TextDecoder(),
  encoder = new TextEncoder();
function setup(t) {
  const server = new MockDirectDrive();
  const client = (account = 'alice') =>
    new GoogleDrive({
      runtime: {
        getManifest: () => ({ oauth2: { client_id: 'test-client.apps.googleusercontent.com' } }),
      },
      identity: {
        getAuthToken: async () => ({ token: account }),
        removeCachedAuthToken: async () => {},
      },
      fetchImpl: server.fetch.bind(server),
      sleep: async () => {},
    });
  const db = () => {
    const value = new Database(`direct-${crypto.randomUUID()}`, { broadcast: false });
    t.after(() => value.close());
    return value;
  };
  const a = db(),
    b = db(),
    drive = client();
  const sync = (data, direction, transport = drive) =>
    syncDrive(data, direction, { drive: transport, locks: null });
  return { server, client, a, b, drive, sync };
}
async function connect(a, b, drive) {
  const account = await drive.authorize();
  const folder = await drive.createFolder('My notes');
  await bindFolder(a, account, folder);
  await bindFolder(b, account, await drive.folder(folder.id));
  return folder;
}
test('new folder, second device, separate record files, binary attachments and directional sync', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const asset = await a.storeAsset(
    new Blob([new Uint8Array([0, 255, 3, 128, 7])], { type: 'image/png' }),
    'image.png',
  );
  const first = newRecord({ title: 'First', attachments: [asset] }),
    second = newRecord({ title: 'Second' });
  await a.saveMany([first, second].map((record) => ({ record })));
  assert.equal((await sync(a, 'upload')).uploaded, 2);
  assert.equal((await b.allRows()).length, 0);
  assert.equal(
    [...server.items.values()].filter((f) => f.appProperties?.pkm_role === 'record').length,
    2,
  );
  const before = server.calls.length;
  assert.equal((await sync(b, 'download')).downloaded, 2);
  assert.ok(server.calls.slice(before).every((call) => call.method === 'GET'));
  assert.equal((await b.get(first.id)).record.title, 'First');
  assert.deepEqual(
    new Uint8Array(await (await b.getAsset(asset.id)).blob.arrayBuffer()),
    new Uint8Array([0, 255, 3, 128, 7]),
  );
  await a.mutate(first.id, (r) => ({ ...r, title: 'Renamed' }));
  const writesBefore = server.calls.filter((c) => c.method === 'PUT').length;
  assert.equal((await sync(a, 'upload')).uploaded, 1);
  assert.equal(server.calls.filter((c) => c.method === 'PUT').length - writesBefore, 1);
  assert.equal((await b.get(first.id)).record.title, 'First');
  await sync(b, 'download');
  assert.equal((await b.get(first.id)).record.title, 'Renamed');
});
test('simultaneous edits preserve both versions until explicit selection; download never overwrites unsent local edits', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const note = newRecord({ title: 'Base' });
  await a.save(note);
  await sync(a, 'upload');
  await sync(b, 'download');
  await b.mutate(note.id, (r) => ({ ...r, content: 'B edit' }));
  await sync(b, 'download');
  assert.equal((await b.get(note.id)).record.content, 'B edit');
  await a.mutate(note.id, (r) => ({ ...r, content: 'A edit' }));
  await sync(a, 'upload');
  assert.equal((await sync(b, 'upload')).conflicts, 1);
  assert.equal((await b.get(note.id)).record.content, 'B edit');
  const file = [...server.items.values()].find((f) => f.appProperties?.record_id === note.id);
  assert.equal(JSON.parse(decoder.decode(file.bytes)).record.content, 'A edit');
  await resolveDriveConflict(b, note.id, 'local');
  await sync(b, 'download');
  await sync(b, 'upload');
  assert.equal(JSON.parse(decoder.decode(file.bytes)).record.content, 'B edit');
  assert.equal((await b.getState('drive:conflicts', [])).length, 0);
});
test('If-Match blocks a write raced by another device and a lost response retries without duplicate records', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const note = newRecord({ title: 'Original' });
  await a.save(note);
  server.loseResponse = true;
  await assert.rejects(sync(a, 'upload'), /lost response/);
  await sync(a, 'upload');
  assert.equal(
    [...server.items.values()].filter((f) => f.appProperties?.record_id === note.id).length,
    1,
  );
  await a.mutate(note.id, (r) => ({ ...r, content: 'Local edit' }));
  server.race = async (file) => {
    const row = await b.prepare({ ...note, content: 'Race edit' });
    file.bytes = encoder.encode(
      JSON.stringify({
        format: 'pkm-direct-record',
        version: 1,
        record: row.record,
        hash: row.hash,
      }),
    );
    file.revision++;
  };
  assert.equal((await sync(a, 'upload')).conflicts, 1);
  assert.equal((await a.get(note.id)).record.content, 'Local edit');
  assert.equal((await a.getState('drive:conflicts'))[0].variants[0].record.content, 'Race edit');
});
test('changed Google account, mismatched folder and corrupt records cannot change browser data', async (t) => {
  const { server, client, a, b, drive, sync } = setup(t);
  const folder = await connect(a, b, drive);
  await assert.rejects(sync(a, 'upload', client('bob')), /账号/);
  await assert.rejects(bindFolder(a, { id: 'bob' }, folder), /另一个/);
  const note = newRecord({ title: 'Good' });
  await a.save(note);
  await sync(a, 'upload');
  const file = [...server.items.values()].find((f) => f.appProperties?.record_id === note.id);
  const value = JSON.parse(decoder.decode(file.bytes));
  value.record.content = 'Tampered';
  file.bytes = encoder.encode(JSON.stringify(value));
  await assert.rejects(sync(b, 'download'), /校验失败/);
  assert.equal((await b.allRows()).length, 0);
});
test('project batches install atomically and deleted records propagate as record state', async (t) => {
  const { a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const parent = newRecord({ schema_version: 5, type: 'project', title: 'Parent' });
  const child = newRecord({
    schema_version: 5,
    type: 'project',
    title: 'Child',
    parent_project_id: parent.id,
  });
  const note = newRecord({ title: 'Member', project_ids: [child.id] });
  await a.saveMany([parent, child, note].map((record) => ({ record })));
  await sync(a, 'upload');
  await sync(b, 'download');
  assert.equal((await b.get(child.id)).record.parent_project_id, parent.id);
  await a.trash(note.id);
  await sync(a, 'upload');
  await sync(b, 'download');
  assert.ok((await b.get(note.id)).record.deleted_at);
  assert.equal((await b.list({ view: 'inbox' })).items.length, 0);
});

test('two devices creating the same singleton record expose both copies until explicit resolution', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  const folder = await connect(a, b, drive);
  const note = newRecord({ title: 'First version' });
  await a.save(note);
  await sync(a, 'upload');
  const competing = await b.prepare({ ...note, title: 'Concurrent version' });
  const duplicate = await drive.createFile(
    folder.id,
    `${note.id}.json`,
    new Blob(
      [
        JSON.stringify({
          format: 'pkm-direct-record',
          version: 1,
          hash: competing.hash,
          record: competing.record,
        }),
      ],
      { type: 'application/json' },
    ),
    { pkm_role: 'record', record_id: note.id },
    await drive.generateId(),
  );
  assert.ok(duplicate.id);
  assert.equal((await sync(a, 'download')).conflicts, 1);
  const conflict = (await a.getState('drive:conflicts'))[0];
  assert.equal(conflict.variants.length, 2);
  await resolveDriveConflict(a, note.id, competing.hash);
  await sync(a, 'download');
  assert.equal((await a.get(note.id)).record.title, 'Concurrent version');
  await sync(a, 'upload');
  const variants = [...server.items.values()].filter((f) => f.appProperties?.record_id === note.id);
  assert.ok(variants.every((f) => JSON.parse(decoder.decode(f.bytes)).hash === competing.hash));
  assert.equal((await sync(b, 'download')).conflicts, 0);
});

test('an edit arriving during download cannot be lost or acknowledged as synchronized', async (t) => {
  const { a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const note = newRecord({ title: 'Base' });
  await a.save(note);
  await sync(a, 'upload');
  await sync(b, 'download');
  await a.mutate(note.id, (record) => ({ ...record, content: 'Cloud changed' }));
  await sync(a, 'upload');
  const apply = b.applyDriveChanges.bind(b);
  b.applyDriveChanges = async (...args) => {
    await b.mutate(note.id, (record) => ({ ...record, content: 'Browser changed during fetch' }));
    return apply(...args);
  };
  await assert.rejects(sync(b, 'download'), /其他窗口修改/);
  assert.equal((await b.get(note.id)).record.content, 'Browser changed during fetch');
  assert.notEqual((await b.driveLinks()).get(note.id).hash, (await b.get(note.id)).hash);
});

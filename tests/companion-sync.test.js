import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Vault } from '../companion/vault.mjs';
import { DriveClient, DriveSync } from '../companion/drive.mjs';
import { newRecord, digestBytes } from '../extension/lib/model.js';
import { MockDrive } from './mock-drive.js';
const output = path.resolve('test-results');
async function fixture(t, remote = new MockDrive()) {
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(path.join(output, 'companion-sync-')),
    vault = await new Vault(root).open();
  t.after(async () => {
    vault.close();
    if (!root.startsWith(output + path.sep)) throw new Error('Unexpected test cleanup');
    await rm(root, { recursive: true, force: true });
  });
  const client = new DriveClient(
    { token: async () => 'fake-drive-token' },
    { fetchImpl: remote.fetch.bind(remote), sleep: async () => {}, sessionStore: vault },
  );
  return { vault, client, sync: new DriveSync(vault, client), remote };
}

test('changing Google accounts blocks uploads, downloads and rebinding of the original local vault', async (t) => {
  const device = await fixture(t),
    folder = await device.client.createFolder();
  await device.sync.bind(folder.id);
  assert.equal(device.vault.getState('drive:binding').accountId, 'mock-user');
  const note = newRecord({ title: 'Private account A' });
  await device.vault.put(note);
  device.remote.account = { permissionId: 'another-user', emailAddress: 'b@example.invalid' };
  const start = device.remote.calls.length;
  await assert.rejects(device.sync.run(), /账号.*不同/);
  await assert.rejects(device.sync.bind(folder.id), /账号.*不同/);
  assert.ok(
    device.remote.calls
      .slice(start)
      .every((call) => new URL(call.url).pathname === '/drive/v3/about'),
  );
  assert.equal(device.vault.pending().length, 1);
  assert.equal(device.remote.files.size, 1);
  device.remote.account = { permissionId: 'mock-user', emailAddress: 'a@example.invalid' };
  await device.sync.run();
  assert.equal(device.vault.pending().length, 0);
});

test('a shared folder owned by another user cannot become the personal Drive vault', async (t) => {
  const device = await fixture(t),
    folder = await device.client.createFolder();
  device.remote.files.get(folder.id).ownedByMe = false;
  await assert.rejects(device.sync.bind(folder.id), /自己拥有/);
  assert.equal(device.vault.getState('drive:binding'), null);
});
test('Drive adapter performs real HTTP-shaped sync, offline conflicts and explicit resolution', async (t) => {
  const a = await fixture(t),
    b = await fixture(t, a.remote),
    folder = await a.client.createFolder();
  await a.sync.bind(folder.id);
  await b.sync.bind(folder.id);
  const original = newRecord({ title: 'Shared', content: 'base' }),
    first = await a.vault.put(original);
  await a.sync.run();
  await b.sync.run();
  assert.equal(b.vault.get(original.id).record.content, 'base');
  await a.vault.put({ ...original, content: 'office' }, { parentRevision: first.revision });
  await b.vault.put({ ...original, content: 'home' }, { parentRevision: first.revision });
  const unrelated = newRecord({ title: 'Unrelated' });
  await a.vault.put(unrelated);
  await a.sync.run();
  await b.sync.run();
  await a.sync.run();
  assert.equal(a.vault.get(original.id).heads.length, 2);
  assert.equal(b.vault.get(original.id).heads.length, 2);
  assert.ok(b.vault.get(unrelated.id));
  const current = b.vault.get(original.id);
  await b.vault.put({ ...original, content: 'merged' }, { resolveParents: current.heads });
  await b.sync.run();
  await a.sync.run();
  assert.equal(a.vault.get(original.id).record.content, 'merged');
  assert.equal(a.vault.get(original.id).heads.length, 1);
});
test('Drive attachments remain lazy and checksum verified on another device', async (t) => {
  const a = await fixture(t),
    b = await fixture(t, a.remote),
    folder = await a.client.createFolder();
  await a.sync.bind(folder.id);
  await b.sync.bind(folder.id);
  const bytes = Buffer.from('mock image bytes'),
    id = await digestBytes(bytes),
    descriptor = {
      id,
      sha256: id,
      kind: 'image',
      name: 'sample.png',
      mime_type: 'image/png',
      size_bytes: bytes.length,
      path: `assets/${id}.png`,
      created_at: new Date().toISOString(),
      duration_ms: null,
    };
  await a.vault.storeAsset(descriptor, bytes);
  const note = newRecord({ title: 'Attachment', attachments: [descriptor] });
  await a.vault.put(note);
  await a.sync.run();
  await b.sync.run();
  assert.equal(await b.vault.assetBytes(descriptor), null);
  assert.deepEqual(await b.sync.asset(descriptor), bytes);
  const c = await fixture(t, a.remote);
  await c.sync.bind(folder.id);
  await c.sync.run();
  const remoteId = c.vault.assetInfo(descriptor).remoteId;
  a.remote.files.get(remoteId).bytes = Buffer.from('corrupt');
  await assert.rejects(c.sync.asset(descriptor), /checksum|size/);
});
test('lost batch confirmation reuses file ID and does not duplicate or clear newer edits', async (t) => {
  const a = await fixture(t),
    folder = await a.client.createFolder();
  await a.sync.bind(folder.id);
  const note = newRecord({ title: 'Retry' }),
    first = await a.vault.put(note);
  const originalUpload = a.client.upload.bind(a.client);
  let fail = true;
  a.client.upload = async (payload) => {
    const result = await originalUpload(payload);
    if (payload.role === 'batch' && fail) {
      fail = false;
      await a.vault.put(
        { ...note, content: 'edited during upload' },
        { parentRevision: first.revision },
      );
      throw new TypeError('Response lost after completion');
    }
    return result;
  };
  await assert.rejects(a.sync.run(), /Response lost/);
  assert.ok(a.vault.getState('drive:outbox'));
  await a.sync.run();
  assert.equal(a.vault.pending().length, 0);
  assert.equal(
    [...a.remote.files.values()].filter((f) => f.appProperties?.pkm_role === 'batch').length,
    2,
  );
  assert.equal(a.vault.get(note.id).record.content, 'edited during upload');
});
test('resumable media upload survives a process-style retry with persisted session offset', async (t) => {
  const a = await fixture(t),
    folder = await a.client.createFolder(),
    id = await a.client.allocateId(),
    bytes = Buffer.alloc(10 * 1024 * 1024, 71),
    hash = await digestBytes(bytes);
  a.remote.failChunkOnce = true;
  const item = { id, parent: folder.id, name: 'large.webm', bytes, role: 'asset', hash };
  await assert.rejects(a.client.upload(item), /Interrupted/);
  const saved = a.vault.getState(`drive:upload-session:${id}`);
  assert.ok(saved);
  await a.client.upload(item);
  assert.deepEqual(await a.client.download(id, bytes.length), bytes);
  assert.equal(a.vault.getState(`drive:upload-session:${id}`), null);
  const chunks = a.remote.calls.filter(
    (c) =>
      c.method === 'PUT' &&
      new Headers(c.headers).get('content-range')?.startsWith('bytes 8388608-'),
  );
  assert.equal(chunks.length, 1);
});
test('remote deletion of a sync file never silently deletes a local record', async (t) => {
  const a = await fixture(t),
    b = await fixture(t, a.remote),
    folder = await a.client.createFolder();
  await a.sync.bind(folder.id);
  await b.sync.bind(folder.id);
  const note = newRecord({ title: 'Keep local' });
  await a.vault.put(note);
  await a.sync.run();
  await b.sync.run();
  const batch = [...a.remote.files.values()].find((f) => f.appProperties?.pkm_role === 'batch');
  batch.trashed = true;
  a.remote.events.push({ fileId: batch.id, removed: true });
  await b.sync.run();
  assert.equal(b.vault.get(note.id).record.title, 'Keep local');
});
test('rate-limit retry respects short Retry-After and does not spin on long limits', async (t) => {
  const a = await fixture(t),
    waits = [];
  a.client.sleep = async (ms) => waits.push(ms);
  a.remote.failNext = { status: 429, headers: { 'Retry-After': '2' } };
  await a.client.folders();
  assert.deepEqual(waits, [2000]);
  a.remote.failNext = { status: 429, headers: { 'Retry-After': '3600' } };
  await assert.rejects(a.client.folders(), /稍后重试/);
  assert.deepEqual(waits, [2000]);
});
test('invalid remote batches fail before local revision writes and cursor advances', async (t) => {
  const a = await fixture(t),
    b = await fixture(t, a.remote),
    folder = await a.client.createFolder();
  await a.sync.bind(folder.id);
  await b.sync.bind(folder.id);
  await a.vault.put(newRecord({ title: 'Valid' }));
  await a.sync.run();
  const batch = [...a.remote.files.values()].find((f) => f.appProperties?.pkm_role === 'batch');
  batch.bytes = Buffer.from('{}');
  await assert.rejects(b.sync.run(), /校验失败/);
  assert.equal(b.vault.list().total, 0);
  assert.equal(b.vault.getState('drive:cursor'), null);
});

test('a batch with many existing attachments splits within the consumer reference limit', async (t) => {
  const a = await fixture(t),
    b = await fixture(t, a.remote),
    folder = await a.client.createFolder();
  await a.sync.bind(folder.id);
  await b.sync.bind(folder.id);
  for (let record = 0; record < 6; record++) {
    const attachments = [];
    for (let index = 0; index < 100; index++) {
      const bytes = Buffer.from('existing-' + record + '-' + index),
        id = await digestBytes(bytes),
        descriptor = {
          id,
          sha256: id,
          kind: 'image',
          name: 'existing.png',
          mime_type: 'image/png',
          size_bytes: bytes.length,
          path: 'assets/' + id + '.png',
          created_at: new Date().toISOString(),
          duration_ms: null,
        };
      const cloudId = a.remote.id();
      a.remote.save(
        {
          id: cloudId,
          name: id,
          parents: [folder.id],
          appProperties: { pkm_role: 'asset', pkm_sha256: id },
        },
        bytes,
      );
      a.vault.setRemoteAsset(descriptor, cloudId);
      attachments.push(descriptor);
    }
    await a.vault.put(newRecord({ title: 'Media references ' + record, attachments }));
  }
  await a.sync.run();
  await b.sync.run();
  assert.equal(b.vault.list().total, 6);
  const batches = [...a.remote.files.values()].filter((f) => f.appProperties?.pkm_role === 'batch');
  assert.equal(batches.length, 2);
  for (const file of batches) assert.ok(JSON.parse(file.bytes.toString()).assets.length <= 500);
});

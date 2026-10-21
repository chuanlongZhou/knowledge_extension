import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../extension/lib/db.js';
import { newRecord } from '../extension/lib/model.js';
import { GoogleDrive, DriveError } from '../extension/lib/drive-client.js';
import {
  bindFolder,
  rebindFolder,
  syncDrive,
  resolveDriveConflict,
  organizeDrive,
} from '../extension/lib/drive-sync.js';
import { MockDirectDrive } from './mock-direct-drive.js';
import { TAG_LIBRARY_ID } from '../extension/lib/tag-library.js';
import { SHORTCUT_LIBRARY_ID } from '../extension/lib/shortcut-library.js';
import { buildLocalBackup, previewZipImport } from '../extension/lib/backup.js';
import { mapConcurrent } from '../extension/lib/concurrency.js';
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

test('switching a Drive folder preserves local and old cloud data while resetting folder sync state', async (t) => {
  const { server, a, drive, sync } = setup(t);
  const account = await drive.authorize();
  const oldFolder = await drive.createFolder('Old notes');
  const nextFolder = await drive.createFolder('New notes');
  await bindFolder(a, account, oldFolder);
  const note = newRecord({ title: 'Keep this note' });
  await a.save(note);
  await sync(a, 'upload');
  const oldFile = (await drive.files(oldFolder.id)).find(
    (file) => file.appProperties?.record_id === note.id,
  );
  assert.ok(oldFile);
  assert.equal((await a.driveLinks()).size > 0, true);
  await a.setState('drive:conflicts', [{ id: note.id }]);
  await a.setState('drive:resolutions', { [note.id]: { choice: 'local' } });
  await a.cacheDriveFile(oldFile.id, { folderId: oldFolder.id, version: 'old' });

  await rebindFolder(a, account, await drive.folder(nextFolder.id));
  assert.equal((await a.getState('drive:binding')).folderId, nextFolder.id);
  assert.equal((await a.get(note.id)).record.title, 'Keep this note');
  assert.equal((await a.driveLinks()).size, 0);
  assert.deepEqual(await a.getState('drive:conflicts', []), []);
  assert.deepEqual(await a.getState('drive:resolutions', {}), {});
  assert.equal(await a.cachedDriveFile(oldFile.id), null);
  assert.ok(server.items.has(oldFile.id));

  await sync(a, 'upload');
  const newFile = (await drive.files(nextFolder.id)).find(
    (file) => file.appProperties?.record_id === note.id,
  );
  assert.ok(newFile);
  assert.notEqual(newFile.id, oldFile.id);
  await assert.rejects(rebindFolder(a, { id: 'bob' }, oldFolder), /账号/);
});

test('switching to a populated folder reports different copies as conflicts', async (t) => {
  const { a, b, drive, sync } = setup(t);
  const account = await drive.authorize();
  const oldFolder = await drive.createFolder('Original');
  const nextFolder = await drive.createFolder('Target');
  await bindFolder(a, account, oldFolder);
  await bindFolder(b, account, nextFolder);
  const local = newRecord({ title: 'Local version' });
  await a.save(local);
  await b.save({ ...local, title: 'Remote version', content: 'Different content' });
  await sync(b, 'upload');

  await rebindFolder(a, account, await drive.folder(nextFolder.id));
  assert.equal((await sync(a, 'download')).conflicts, 1);
  assert.equal((await a.get(local.id)).record.title, 'Local version');
  assert.equal((await a.getState('drive:conflicts', []))[0].id, local.id);
});

const aboutUrl = 'https://www.googleapis.com/drive/v3/about?fields=user';

test('unchanged downloads use persistent versioned caches; one remote change fetches only one body', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const notes = Array.from({ length: 12 }, (_, i) => newRecord({ title: `资料 ${i}` }));
  await a.saveMany(notes.map((record) => ({ record })));
  await sync(a, 'upload');
  assert.equal((await sync(b, 'download')).recordsFetched, 12);
  const name = b.name;
  await b.close();
  const reopened = new Database(name, { broadcast: false });
  t.after(() => reopened.close());
  const before = server.calls.length;
  const unchanged = await sync(reopened, 'download');
  assert.equal(unchanged.recordsCached, 12);
  assert.equal(unchanged.recordsFetched, 0);
  assert.equal(
    server.calls.slice(before).filter((call) => call.query.includes('alt=media')).length,
    0,
  );
  await a.mutate(notes[0].id, (r) => ({ ...r, content: '只修改这一条' }));
  await sync(a, 'upload');
  const start = server.calls.length;
  const changed = await sync(reopened, 'download');
  assert.equal(changed.recordsCached, 11);
  assert.equal(changed.recordsFetched, 1);
  assert.equal(
    server.calls.slice(start).filter((call) => call.query.includes('alt=media')).length,
    1,
  );
  assert.equal((await reopened.get(notes[0].id)).record.content, '只修改这一条');
});

test('corrupt caches are refetched and missing cloud files are pruned without deleting local records', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const note = newRecord({ title: '校验缓存' });
  await a.save(note);
  await sync(a, 'upload');
  await sync(b, 'download');
  const file = [...server.items.values()].find((f) => f.appProperties?.record_id === note.id);
  const cache = await b.cachedDriveFile(file.id);
  cache.value.record.title = '缓存损坏';
  await b.cacheDriveFile(file.id, cache);
  assert.equal((await sync(b, 'download')).recordsFetched, 1);
  assert.equal((await b.get(note.id)).record.title, '校验缓存');
  file.trashed = true;
  await sync(b, 'download');
  assert.equal(await b.cachedDriveFile(file.id), null);
  assert.ok(await b.get(note.id));
});

test('record reads run concurrently within a limit of four and drain before a failure returns', async (t) => {
  const { a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  await a.saveMany(
    Array.from({ length: 10 }, (_, i) => ({ record: newRecord({ title: `${i}` }) })),
  );
  await sync(a, 'upload');
  const read = drive.readRecord.bind(drive);
  let active = 0,
    peak = 0;
  drive.readRecord = async (...args) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      return await read(...args);
    } finally {
      active--;
    }
  };
  await sync(b, 'download');
  assert.ok(peak > 1 && peak <= 4);
  let inFlight = 0,
    completed = 0;
  await assert.rejects(
    mapConcurrent([0, 1, 2, 3, 4, 5], 4, async (n) => {
      inFlight++;
      try {
        await new Promise((resolve) => setTimeout(resolve, n ? 10 : 1));
        if (!n) throw new Error('失败');
        completed++;
      } finally {
        inFlight--;
      }
    }),
    /失败/,
  );
  assert.equal(inFlight, 0);
  assert.equal(completed, 3);
});

test('a cached ETag still prevents overwriting a concurrent remote edit', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const note = newRecord({ title: '原始' });
  await a.save(note);
  await sync(a, 'upload');
  await sync(b, 'download');
  await b.mutate(note.id, (r) => ({ ...r, content: '本机修改' }));
  server.race = async (file) => {
    const row = await a.prepare({ ...note, content: '云端抢先修改' });
    file.bytes = encoder.encode(
      JSON.stringify({
        format: 'pkm-direct-record',
        version: 1,
        hash: row.hash,
        record: row.record,
      }),
    );
    file.revision++;
  };
  const result = await sync(b, 'upload');
  assert.equal(result.recordsCached, 1);
  assert.equal(result.conflicts, 1);
  assert.equal((await b.get(note.id)).record.content, '本机修改');
});

test('mixed flat and organized directories remain readable, with previewed, repeatable moves preserving IDs and bytes', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  const folder = await connect(a, b, drive);
  const asset = await a.storeAsset(new Blob(['image'], { type: 'image/png' }), '图片.png');
  const note = newRecord({ title: '目录整理', attachments: [asset] });
  await a.save(note);
  await a.renameTag('阅读', '阅读', '#3e6868', '标签');
  await sync(a, 'upload');
  const dataFiles = [...server.items.values()].filter((file) =>
    ['record', 'asset', 'tag_library'].includes(file.appProperties?.pkm_role),
  );
  const before = new Map(dataFiles.map((file) => [file.id, new Uint8Array(file.bytes)]));
  for (const file of dataFiles) {
    file.parents = [folder.id];
    file.revision++;
  }
  const unrelated = await drive.createFile(
    folder.id,
    '自己的文件.txt',
    new Blob(['keep']),
    {},
    await drive.generateId(),
  );
  const start = server.calls.length;
  assert.equal((await organizeDrive(a, { drive })).count, 3);
  assert.ok(server.calls.slice(start).every((call) => call.method === 'GET'));
  await sync(b, 'download');
  assert.ok(await b.get(note.id));
  assert.equal((await organizeDrive(a, { drive, preview: false })).moved, 3);
  for (const file of dataFiles) {
    assert.deepEqual(file.bytes, before.get(file.id));
    assert.notDeepEqual(file.parents, [folder.id]);
  }
  assert.deepEqual(server.items.get(unrelated.id).parents, [folder.id]);
  assert.equal((await organizeDrive(a, { drive, preview: false })).moved, 0);
  await sync(b, 'download');
  assert.ok((await b.getAsset(asset.id)).blob);
  assert.equal((await b.get(note.id)).record.title, '目录整理');
});

test('an interrupted directory organization drains outstanding moves and resumes without duplicate files', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  const folder = await connect(a, b, drive);
  await a.saveMany(
    Array.from({ length: 6 }, (_, i) => ({ record: newRecord({ title: `资料 ${i}` }) })),
  );
  await sync(a, 'upload');
  const files = [...server.items.values()].filter(
    (file) => file.appProperties?.pkm_role === 'record',
  );
  for (const file of files) {
    file.parents = [folder.id];
    file.revision++;
  }
  const move = drive.moveFile.bind(drive);
  let calls = 0,
    active = 0;
  drive.moveFile = async (...args) => {
    active++;
    const call = ++calls;
    try {
      if (call === 2) throw new Error('模拟中断');
      return await move(...args);
    } finally {
      active--;
    }
  };
  await assert.rejects(organizeDrive(a, { drive, preview: false }), /模拟中断/);
  assert.equal(active, 0);
  drive.moveFile = move;
  const remaining = files.filter((file) => file.parents.includes(folder.id)).length;
  assert.ok(remaining > 0 && remaining < files.length);
  assert.equal((await organizeDrive(a, { drive, preview: false })).moved, remaining);
  assert.equal(
    [...server.items.values()].filter((file) => file.appProperties?.pkm_role === 'record').length,
    6,
  );
  await sync(b, 'download');
  assert.equal((await b.allRows()).length, 6);
});

test('a legacy v4 browser database gains a cache without rewriting records, styles or sync baselines', async (t) => {
  const { a } = setup(t);
  const prepared = await a.prepare(newRecord({ title: '升级前的资料' }));
  const name = `upgrade-${crypto.randomUUID()}`;
  const legacy = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 4);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ['records', 'catalog', 'search', 'captures', 'assets', 'recordings'])
        db.createObjectStore(store, { keyPath: 'id' });
      db.createObjectStore('state', { keyPath: 'key' });
      db.createObjectStore('recordingChunks', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
  });
  await new Promise((resolve, reject) => {
    const tx = legacy.transaction(['records', 'state'], 'readwrite');
    tx.objectStore('records').put({ ...prepared, rev: 7, dirty: false });
    tx.objectStore('state').put({
      key: `drive:row:${prepared.record.id}`,
      value: { hash: prepared.hash, fileIds: ['original_file'] },
    });
    tx.objectStore('state').put({
      key: 'ui:tag-styles',
      value: { 阅读: { color: '#3e6868', description: '保留说明' } },
    });
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  legacy.close();
  const upgraded = new Database(name, { broadcast: false });
  t.after(() => upgraded.close());
  assert.equal((await upgraded.open()).version, 5);
  assert.equal((await upgraded.get(prepared.record.id)).rev, 7);
  assert.equal((await upgraded.get(prepared.record.id)).dirty, false);
  assert.equal((await upgraded.driveLinks()).get(prepared.record.id).hash, prepared.hash);
  assert.equal((await upgraded.getState('ui:tag-styles')).阅读.description, '保留说明');
  assert.equal(await upgraded.cachedDriveFile('original_file'), null);
});
function failingClient(error, status = 403, headers = {}) {
  const calls = [],
    removed = [],
    sleeps = [];
  const drive = new GoogleDrive({
    fetchImpl: async () => {
      calls.push(true);
      return new Response(typeof error === 'string' ? error : JSON.stringify({ error }), {
        status,
        headers,
      });
    },
    identity: { removeCachedAuthToken: async ({ token }) => removed.push(token) },
    sleep: async (ms) => sleeps.push(ms),
  });
  drive.accessToken = 'secret-access-token';
  return { drive, calls, removed, sleeps };
}
test('disabled Drive API reports the actual Google project and reason without retrying', async () => {
  const { drive, calls, removed } = failingClient({
    errors: [{ reason: 'accessNotConfigured' }],
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'SERVICE_DISABLED',
        metadata: { consumer: 'projects/464495637351', service: 'drive.googleapis.com' },
      },
    ],
  });
  await assert.rejects(drive.account(), (error) => {
    assert.ok(error instanceof DriveError);
    assert.equal(error.status, 403);
    assert.match(error.message, /API 尚未启用.*464495637351.*SERVICE_DISABLED/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(removed.length, 0);
});
test('Drive permission, daily quota, storage and organization failures have distinct instructions', async (t) => {
  for (const [reason, expected] of [
    ['accessNotConfigured', /OAuth 客户端所属.*启用 Google Drive API/],
    ['insufficientFilePermissions', /当前账号无权访问此文件/],
    ['appNotAuthorizedToFile', /此简化版创建的数据文件夹/],
    ['dailyLimitExceeded', /API 配额已用完/],
    ['storageQuotaExceeded', /存储空间已满/],
    ['domainPolicy', /组织策略/],
  ])
    await t.test(reason, async () => {
      const { drive, calls, sleeps } = failingClient({ errors: [{ reason }] });
      await assert.rejects(drive.account(), expected);
      assert.equal(calls.length, 1);
      assert.equal(sleeps.length, 0);
    });
});
test('missing OAuth scope and expired tokens invalidate the cached token for a fresh login', async (t) => {
  for (const [status, error] of [
    [403, { errors: [{ reason: 'insufficientPermissions' }] }],
    [
      403,
      {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
          },
        ],
      },
    ],
    [401, {}],
  ])
    await t.test(`${status} ${JSON.stringify(error)}`, async () => {
      const { drive, calls, removed } = failingClient(error, status);
      await assert.rejects(drive.account(), /重新登录/);
      assert.deepEqual(removed, ['secret-access-token']);
      assert.equal(calls.length, 1);
    });
});
test('403 rate limits retry with backoff, recover, or stop after three retries', async () => {
  const { drive, calls, sleeps } = failingClient({ errors: [{ reason: 'userRateLimitExceeded' }] });
  await assert.rejects(drive.account(), /请求过于频繁.*userRateLimitExceeded/);
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [500, 1000, 2000]);
  const fail = drive.fetch;
  let attempts = 0;
  drive.fetch = () =>
    ++attempts < 3 ? fail() : Promise.resolve(new Response('{"user":{"permissionId":"alice"}}'));
  assert.equal((await drive.account()).id, 'alice');
  assert.equal(attempts, 3);
});
test('429 and transient server errors retry, but long Retry-After does not block the worker', async (t) => {
  for (const status of [429, 503])
    await t.test(String(status), async () => {
      const { drive, calls, sleeps } = failingClient({}, status, { 'Retry-After': '2' });
      await assert.rejects(drive.response(aboutUrl), { status });
      assert.equal(calls.length, 4);
      assert.deepEqual(sleeps, [2000, 2000, 2000]);
    });
  const { drive, calls, sleeps } = failingClient({}, 429, { 'Retry-After': '60' });
  await assert.rejects(drive.response(aboutUrl), /请求过于频繁/);
  assert.equal(calls.length, 1);
  assert.equal(sleeps.length, 0);
});
test('unknown Google errors retain bounded diagnostics without leaking the access token', async () => {
  const { drive } = failingClient({
    message: 'Request denied for secret-access-token',
    errors: [{ reason: 'newGoogleReason' }],
  });
  await assert.rejects(drive.account(), (error) => {
    assert.match(error.message, /Request denied for \[redacted\].*HTTP 403.*newGoogleReason/);
    assert.doesNotMatch(error.message, /secret-access-token/);
    return true;
  });
  for (const body of [
    '<html>proxy error</html>',
    JSON.stringify({ error: null }),
    'x'.repeat(70 * 1024),
  ]) {
    const { drive } = failingClient(body);
    await assert.rejects(drive.account(), /HTTP 403/);
  }
  const { drive: largeFile } = failingClient('x'.repeat(1025), 200);
  await assert.rejects(largeFile.response(aboutUrl, { maxBytes: 1024 }), /超出允许大小/);
});
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

test('project descriptions, appearance, memberships and graph relations sync with their IDs', async (t) => {
  const { a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const parent = newRecord({
    schema_version: 5,
    type: 'project',
    title: '研究',
    summary: '项目说明',
    appearance: { color: '#3e6868', icon: '📚' },
  });
  const child = newRecord({
    schema_version: 5,
    type: 'project',
    title: '子项目',
    parent_project_id: parent.id,
  });
  const note = newRecord({ title: '资料', project_ids: [parent.id], tags: ['阅读'] });
  parent.graph = {
    edges: [{ id: crypto.randomUUID(), source: child.id, target: note.id, label: '参考依据' }],
    positions: { [note.id]: { x: 100, y: 200 } },
  };
  await a.saveMany([parent, child, note].map((record) => ({ record })));
  await sync(a, 'upload');
  await sync(b, 'download');
  assert.deepEqual((await b.get(parent.id)).record, (await a.get(parent.id)).record);
  assert.equal((await b.get(child.id)).record.parent_project_id, parent.id);
  assert.deepEqual((await b.get(note.id)).record.project_ids, [parent.id]);
  assert.deepEqual((await b.get(note.id)).record.tags, ['阅读']);
});

test('empty tags, colors and descriptions sync separately, without entering the record list', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  await a.setState('ui:tag-groups', ['尚未使用']);
  await a.renameTag('尚未使用', '尚未使用', '#3E6868', '待阅读的资料');
  const uploaded = await sync(a, 'upload');
  assert.equal(uploaded.uploaded, 0);
  assert.equal(uploaded.metadataUploaded, 1);
  const file = [...server.items.values()].find((f) => f.appProperties?.pkm_role === 'tag_library');
  assert.equal(file.name, 'tags.json');
  assert.equal((await sync(b, 'download')).metadataDownloaded, 1);
  assert.deepEqual((await b.tagLibrary()).record, (await a.tagLibrary()).record);
  assert.equal((await b.allRows()).length, 0);
  assert.equal((await sync(a, 'upload')).metadataUploaded, 0);
  assert.equal((await sync(b, 'upload')).metadataUploaded, 0);
  await b.renameTag('尚未使用', '阅读', '#40534c');
  await sync(b, 'upload');
  await sync(a, 'download');
  assert.deepEqual((await a.tagLibrary()).record.definitions, [
    { name: '阅读', color: '#40534c', description: '待阅读的资料' },
  ]);
});

test('Dock sites upload as metadata, retain order and edits on another device, and sync removals', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const first = { id: 'work', name: '工作台', url: 'https://example.com/work' };
  const second = { id: 'docs', name: '文档', url: 'https://example.com/docs' };
  await a.setShortcutLibrary([first, second], 0);
  const uploaded = await sync(a, 'upload');
  assert.equal(uploaded.uploaded, 0);
  assert.equal(uploaded.metadataUploaded, 1);
  assert.equal(uploaded.shortcutsUploaded, 1);
  const file = [...server.items.values()].find(
    (item) => item.appProperties?.pkm_role === 'shortcut_library',
  );
  assert.equal(file.name, 'shortcuts.json');
  assert.equal((await sync(b, 'download')).shortcutsDownloaded, 1);
  assert.deepEqual((await b.shortcutLibrary()).record.shortcuts, [first, second]);
  assert.equal((await b.allRows()).length, 0);
  assert.equal((await sync(b, 'upload')).metadataUploaded, 0);
  await b.setShortcutLibrary([{ ...second, name: '参考文档' }, first], 1);
  await sync(b, 'upload');
  await sync(a, 'download');
  assert.deepEqual((await a.shortcutLibrary()).record.shortcuts, [
    { ...second, name: '参考文档' },
    first,
  ]);
  await a.setShortcutLibrary([], 2);
  await sync(a, 'upload');
  await sync(b, 'download');
  assert.deepEqual((await b.shortcutLibrary()).record.shortcuts, []);
});

test('concurrent Dock edits keep the local list until the user resolves the conflict', async (t) => {
  const { a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const shortcut = { id: 'site', name: '初始', url: 'https://example.com/' };
  await a.setShortcutLibrary([shortcut], 0);
  await sync(a, 'upload');
  await sync(b, 'download');
  await a.setShortcutLibrary([{ ...shortcut, name: 'A 修改' }], 1);
  await b.setShortcutLibrary([{ ...shortcut, name: 'B 修改' }], 1);
  await sync(a, 'upload');
  assert.equal((await sync(b, 'download')).conflicts, 1);
  assert.equal((await b.shortcutLibrary()).record.shortcuts[0].name, 'B 修改');
  await resolveDriveConflict(b, SHORTCUT_LIBRARY_ID, 'local');
  await sync(b, 'download');
  await sync(b, 'upload');
  await sync(a, 'download');
  assert.equal((await a.shortcutLibrary()).record.shortcuts[0].name, 'B 修改');
});

test('an invalid cloud Dock URL is rejected without changing local sites', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const shortcut = { id: 'site', name: '本机', url: 'https://example.com/' };
  await a.setShortcutLibrary([shortcut], 0);
  await sync(a, 'upload');
  const file = [...server.items.values()].find(
    (item) => item.appProperties?.pkm_role === 'shortcut_library',
  );
  const envelope = JSON.parse(decoder.decode(file.bytes));
  envelope.record.shortcuts[0].url = 'javascript:alert(1)';
  file.bytes = encoder.encode(JSON.stringify(envelope));
  file.revision++;
  await assert.rejects(sync(b, 'download'), /常用网站地址/);
  assert.deepEqual((await b.shortcutLibrary()).record.shortcuts, []);
});

test('Dock downloads reject concurrent edits atomically; complete backups restore sites', async (t) => {
  const { a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const shortcut = { id: 'site', name: '云端', url: 'https://example.com/' };
  await a.setShortcutLibrary([shortcut], 0);
  const note = newRecord({ title: '云端记录' });
  await a.save(note);
  await sync(a, 'upload');
  const apply = b.applyDriveChanges.bind(b);
  b.applyDriveChanges = async (...args) => {
    await b.setShortcutLibrary([{ ...shortcut, name: '同步期间修改' }], 0);
    return apply(...args);
  };
  await assert.rejects(sync(b, 'download'), /下载未应用/);
  assert.equal(await b.get(note.id), undefined);
  assert.equal((await b.shortcutLibrary()).record.shortcuts[0].name, '同步期间修改');
  const restore = new Database(`shortcuts-backup-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => restore.close());
  await restore.applyImport(await previewZipImport(restore, await buildLocalBackup(a)));
  assert.deepEqual((await restore.shortcutLibrary()).record.shortcuts, [shortcut]);
  const oldBackup = await a.exportData();
  delete oldBackup.shortcut_library;
  await restore.setShortcutLibrary([{ ...shortcut, name: '本地' }], 1);
  await restore.applyImport(await restore.previewImport(oldBackup), true);
  assert.equal((await restore.shortcutLibrary()).record.shortcuts[0].name, '本地');
});

test('simultaneous tag changes retain both versions and allow local or cloud resolution', async (t) => {
  const { a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  await a.renameTag('阅读', '阅读', '#3e6868', '基础描述');
  await sync(a, 'upload');
  await sync(b, 'download');
  await a.renameTag('阅读', '阅读', '#3e6868', 'A 修改');
  await b.renameTag('阅读', '阅读', '#40534c', 'B 修改');
  await sync(a, 'upload');
  assert.equal((await sync(b, 'download')).conflicts, 1);
  assert.equal((await b.tagLibrary()).record.definitions[0].description, 'B 修改');
  await resolveDriveConflict(b, TAG_LIBRARY_ID, 'local');
  await sync(b, 'download');
  await sync(b, 'upload');
  await sync(a, 'download');
  assert.equal((await a.tagLibrary()).record.definitions[0].description, 'B 修改');
  await a.renameTag('阅读', '阅读', '#3e6868', 'A 再次修改');
  await b.renameTag('阅读', '阅读', '#40534c', 'B 再次修改');
  await sync(a, 'upload');
  await sync(b, 'download');
  const conflict = (await b.getState('drive:conflicts'))[0];
  await resolveDriveConflict(b, TAG_LIBRARY_ID, conflict.variants[0].hash);
  await sync(b, 'download');
  assert.equal((await b.tagLibrary()).record.definitions[0].description, 'A 再次修改');
  assert.equal((await sync(b, 'upload')).metadataUploaded, 0);
});

test('tag downloads reject concurrent browser edits atomically with records', async (t) => {
  const { a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  await a.renameTag('阅读', '阅读', '#3e6868', '云端描述');
  const note = newRecord({ title: '云端记录' });
  await a.save(note);
  await sync(a, 'upload');
  const apply = b.applyDriveChanges.bind(b);
  b.applyDriveChanges = async (...args) => {
    await b.renameTag('本地', '本地', '#40534c', '同步期间的修改');
    return apply(...args);
  };
  await assert.rejects(sync(b, 'download'), /下载未应用/);
  assert.equal(await b.get(note.id), undefined);
  assert.equal((await b.tagLibrary()).record.definitions[0].description, '同步期间的修改');
});

test('complete backups restore tag descriptions and colors; old backups retain local tags', async (t) => {
  const { a, b } = setup(t);
  await a.renameTag('阅读', '阅读', '#3e6868', '备份描述');
  const zip = await buildLocalBackup(a);
  await b.applyImport(await previewZipImport(b, zip));
  assert.deepEqual((await b.tagLibrary()).record, (await a.tagLibrary()).record);
  const backup = await a.exportData();
  await b.renameTag('阅读', '阅读', '#40534c', '本地描述');
  await b.applyImport(await b.previewImport(backup));
  assert.equal((await b.tagLibrary()).record.definitions[0].description, '本地描述');
  await b.applyImport(await b.previewImport(backup), true);
  assert.equal((await b.tagLibrary()).record.definitions[0].description, '备份描述');
  delete backup.tag_library;
  await b.applyImport(await b.previewImport(backup), true);
  assert.equal((await b.tagLibrary()).record.definitions[0].description, '备份描述');
});

test('cloud record deletion skips that upload but retains browser records and syncs other changes', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const first = newRecord({ title: '被移除' }),
    second = newRecord({ title: '仍然存在' });
  await a.saveMany([first, second].map((record) => ({ record })));
  await sync(a, 'upload');
  await sync(b, 'download');
  const removed = [...server.items.values()].find((f) => f.appProperties?.record_id === first.id);
  removed.trashed = true;
  await a.mutate(first.id, (r) => ({ ...r, content: '保留在浏览器' }));
  await a.mutate(second.id, (r) => ({ ...r, content: '继续同步' }));
  const result = await sync(a, 'upload');
  assert.equal(result.missingRemote, 1);
  assert.equal(result.uploaded, 1);
  await sync(b, 'download');
  assert.equal((await b.get(first.id)).record.title, '被移除');
  assert.equal((await b.get(second.id)).record.content, '继续同步');
});

test('a missing referenced cloud attachment blocks a fresh device download, retaining its existing data', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const image = await a.storeAsset(new Blob(['image bytes'], { type: 'image/png' }), '图片.png');
  const note = newRecord({ title: '含图片', attachments: [image] });
  await a.save(note);
  await sync(a, 'upload');
  const file = [...server.items.values()].find((f) => f.appProperties?.asset_id === image.id);
  file.trashed = true;
  await assert.rejects(sync(b, 'download'), /云端缺少附件/);
  assert.equal((await b.allRows()).length, 0);
  assert.ok((await a.getAsset(image.id)).blob);
});

test('removing a cloud parent project blocks a fresh device batch instead of importing a broken hierarchy', async (t) => {
  const { server, a, b, drive, sync } = setup(t);
  await connect(a, b, drive);
  const project = newRecord({ schema_version: 5, type: 'project', title: '被引用的项目' });
  const child = newRecord({
    schema_version: 5,
    type: 'project',
    title: '子项目',
    parent_project_id: project.id,
  });
  const note = newRecord({ title: '项目资料', project_ids: [child.id] });
  await a.saveMany([project, child, note].map((record) => ({ record })));
  await sync(a, 'upload');
  const file = [...server.items.values()].find((f) => f.appProperties?.record_id === project.id);
  file.trashed = true;
  await assert.rejects(sync(b, 'download'), /下载未应用/);
  assert.equal((await b.allRows()).length, 0);
  assert.ok(await a.get(project.id));
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

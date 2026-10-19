import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../extension/lib/db.js';
import { newRecord, normalizeRecord } from '../extension/lib/model.js';
import { migrateTodos } from '../extension/lib/collections.js';
import { writeZip, readZip, crc32 } from '../extension/lib/zip.js';

function database(t, name = `stability-${crypto.randomUUID()}`) {
  const db = new Database(name, { broadcast: false });
  t.after(() => db.close());
  return db;
}
test('recording recovery uses captured duration after three days, legacy unknown stays unknown', async (t) => {
  const db = database(t),
    session = await db.startRecording('audio/webm');
  await db.appendRecording(session.id, new Blob(['first']), 1000);
  await db.appendRecording(session.id, new Blob(['second']), 2123);
  const realNow = Date.now;
  Date.now = () => realNow() + 3 * 24 * 3600000;
  try {
    assert.equal((await db.finishRecording(session.id)).duration_ms, 2123);
  } finally {
    Date.now = realNow;
  }
  const raw = await db.open(),
    tx = raw.transaction('recordings', 'readwrite');
  const legacy = { ...session };
  delete legacy.duration_ms;
  tx.objectStore('recordings').put(legacy);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  assert.equal((await db.finishRecording(session.id)).duration_ms, null);
});
test('two windows migrate legacy todos without aborting initialization or duplicating items', async (t) => {
  const a = database(t),
    b = database(t, a.name);
  const todos = Array.from({ length: 3 }, (_, i) =>
    newRecord({ schema_version: 2, type: 'todo', title: `Legacy ${i}` }),
  );
  for (const todo of todos) await a.save(todo);
  await Promise.all([migrateTodos(a), migrateTodos(b)]);
  const rows = await a.allRows();
  assert.equal(rows.filter((r) => r.record.type === 'list').length, 1);
  assert.equal(rows.find((r) => r.record.type === 'list').record.list.length, 3);
  assert.equal(rows.filter((r) => r.record.type === 'todo').length, 0);
});
test('blocked IndexedDB opening can retry after an old connection closes', async (t) => {
  const name = `blocked-${crypto.randomUUID()}`;
  const old = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const db = database(t, name);
  await assert.rejects(db.open(), /关闭旧版本/);
  old.close();
  assert.equal((await db.open()).version, 5);
  assert.deepEqual(await db.allRows(), []);
});
test('pending view includes deleted records and tombstones until synchronization', async (t) => {
  const db = database(t),
    record = newRecord({ title: 'Delete me' });
  await db.save(record);
  await db.trash(record.id);
  assert.equal((await db.list({ view: 'pending' })).items.length, 1);
  await db.purge(record.id);
  const result = await db.list({ view: 'pending' });
  assert.equal(result.items[0].kind, 'tombstone');
  assert.equal((await db.list({ view: 'inbox' })).items.length, 0);
});
test('draft changes are distinct from record refresh events', async (t) => {
  const db = database(t),
    events = [];
  db.onChange((kind) => events.push(kind));
  await db.setState('draft:panel', { content: 'typing' });
  await db.save(newRecord({ title: 'Saved' }));
  assert.deepEqual(events, ['draft', 'records']);
});
test('ZIP CRC matches standard vector and entries carry an actual date', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = await writeZip(new Map([['sample.txt', 'hello']])),
    bytes = await zip.arrayBuffer();
  assert.notEqual(new DataView(bytes).getUint16(12, true), 0);
  assert.equal(new TextDecoder().decode((await readZip(zip)).get('sample.txt')), 'hello');
});

test('user ZIP imports keep the size limit while package verification can read bundled installers', async () => {
  const size = 33 * 1024 * 1024,
    zip = await writeZip(new Map([['installer.zip', new Uint8Array(size)]]));
  await assert.rejects(readZip(zip), /超大文件/);
  assert.equal(
    (await readZip(zip, { maxEntryBytes: 128 * 1024 * 1024 })).get('installer.zip').length,
    size,
  );
});
test('new schema requests upgrade without accepting or modifying unknown content', () => {
  assert.throws(() => normalizeRecord({ ...newRecord(), schema_version: 6 }), /升级/);
});

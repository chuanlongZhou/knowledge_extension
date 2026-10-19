import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Database } from '../extension/lib/db.js';
import { newRecord, normalizeRecord, digest, digestBytes } from '../extension/lib/model.js';
import {
  buildLocalBackup,
  buildMarkdownExport,
  previewZipImport,
} from '../extension/lib/backup.js';
import { readZip, writeZip } from '../extension/lib/zip.js';
const imageBytes = await readFile(new URL('../extension/icons/penguin.png', import.meta.url));
function database(t) {
  const db = new Database(`media-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  return db;
}
const attach = async (db) =>
  db.storeAsset(new Blob([imageBytes], { type: 'image/png' }), '企鹅.png');
test('all v4 record types use the same fields and changing type preserves the ID', async (t) => {
  const db = database(t),
    record = newRecord({ type: 'note', title: '统一记录' });
  await db.save(record);
  const initial = await db.get(record.id);
  await db.save({ ...initial.record, type: 'website_group' }, { expectedRev: initial.rev });
  const changed = await db.get(record.id);
  assert.equal(changed.id, record.id);
  assert.equal(changed.record.created_at, record.created_at);
  assert.deepEqual(
    Object.keys(newRecord({ type: 'snapshot' })).sort(),
    Object.keys(newRecord({ type: 'list' })).sort(),
  );
  assert.deepEqual(
    Object.keys(newRecord({ type: 'website_group' })).sort(),
    Object.keys(record).sort(),
  );
});
test('attachment bytes are content-addressed; JSON stores metadata and Markdown paths, not Base64', async (t) => {
  const db = database(t),
    image = await attach(db);
  assert.equal(image.id, await digestBytes(imageBytes));
  assert.equal(image.size_bytes, imageBytes.length);
  assert.equal(image.path, `assets/${image.id}.png`);
  const record = newRecord({ content: `![企鹅](${image.path})`, attachments: [image] });
  await db.save(record);
  assert.equal((await db.get(record.id)).record.attachments[0].kind, 'image');
  assert.ok(!JSON.stringify(record).includes(imageBytes.toString('base64')));
});
test('full local ZIP contains record data, binary images and readable Markdown, and restores everything offline', async (t) => {
  const a = database(t),
    b = database(t),
    image = await attach(a),
    record = newRecord({
      title: 'ZIP roundtrip',
      content: `![企鹅](${image.path})`,
      attachments: [image],
    });
  await a.save(record);
  const zip = await buildLocalBackup(a, {
    resolveAsset: async (d) => (await a.getAsset(d.id)).blob,
  });
  const files = await readZip(zip);
  assert.ok(files.has('backup.json'));
  assert.ok(files.has(`records/${record.id}.json`));
  assert.deepEqual(Buffer.from(files.get(image.path)), imageBytes);
  assert.match(
    new TextDecoder().decode(files.get('notes/未归入项目/ZIP roundtrip.md')),
    /\.\.\/\.\.\/assets\//,
  );
  await b.applyImport(await previewZipImport(b, zip));
  assert.equal((await b.get(record.id)).record.attachments[0].id, image.id);
  assert.equal(await digestBytes(await (await b.getAsset(image.id)).blob.arrayBuffer()), image.id);
  await b.applyImport(await previewZipImport(b, zip));
  assert.equal((await b.allRows()).length, 1);
});

test('Markdown export includes each image file at the path referenced by its note', async (t) => {
  const db = database(t),
    image = await attach(db),
    record = newRecord({
      title: '收集图片',
      content: `## collected:\n\n- ![企鹅](${image.path})`,
      attachments: [image],
    });
  await db.save(record);
  const zip = await buildMarkdownExport(db, {
    resolveAsset: async (descriptor) => (await db.getAsset(descriptor.id)).blob,
  });
  const files = await readZip(zip);
  const markdown = new TextDecoder().decode(files.get('notes/未归入项目/收集图片.md'));
  assert.match(markdown, new RegExp(`!\\[企鹅\\]\\(\\.\\./\\.\\./${image.path}\\)`));
  assert.deepEqual(Buffer.from(files.get(image.path)), imageBytes);
  assert.equal(files.has('backup.json'), false);
});
test('corrupted or missing ZIP attachment aborts before any import write', async (t) => {
  const a = database(t),
    b = database(t),
    image = await attach(a),
    record = newRecord({ attachments: [image] });
  await a.save(record);
  const files = await readZip(
    await buildLocalBackup(a, { resolveAsset: async (d) => (await a.getAsset(d.id)).blob }),
  );
  files.delete(image.path);
  await assert.rejects(previewZipImport(b, await writeZip(files)), /缺失/);
  assert.equal((await b.allRows()).length, 0);
  files.set(image.path, new Uint8Array([1, 2, 3]));
  await assert.rejects(previewZipImport(b, await writeZip(files)), /校验/);
});
test('recording chunks persist independently and can be recovered after reopening', async (t) => {
  const db = database(t),
    session = await db.startRecording('audio/webm;codecs=opus');
  await db.appendRecording(session.id, new Blob(['first']));
  await db.appendRecording(session.id, new Blob(['second']));
  const other = new Database(db.name, { broadcast: false });
  t.after(() => other.close());
  const { blob } = await other.recordingBlob(session.id);
  assert.equal(await blob.text(), 'firstsecond');
  const descriptor = await other.finishRecording(session.id);
  assert.equal(descriptor.kind, 'audio');
  assert.equal(descriptor.mime_type, 'audio/webm');
  assert.ok(descriptor.duration_ms >= 0);
  assert.equal((await other.recordings()).length, 1);
  await other.removeRecording(session.id);
  assert.equal((await other.recordings()).length, 0);
});
test('legacy record hash remains stable on read; editing upgrades schema without changing identity', async (t) => {
  const db = database(t),
    modern = newRecord({ title: '旧记录' }),
    legacy = normalizeRecord({ ...modern, schema_version: 1 });
  await db.save(legacy);
  const old = await db.get(legacy.id);
  assert.equal(old.hash, await digest(legacy));
  assert.equal(normalizeRecord(legacy).schema_version, 1);
  await db.save(
    { ...legacy, schema_version: 2, content: '新的内容', attachments: [] },
    { expectedRev: old.rev },
  );
  assert.equal((await db.get(legacy.id)).record.schema_version, 2);
  assert.equal((await db.allRows()).length, 1);
});

test('installed v1 database upgrades in place and promotes local-only records without changing their hashes', async (t) => {
  const name = `upgrade-${crypto.randomUUID()}`,
    record = normalizeRecord({ ...newRecord({ title: '升级前的随手记' }), schema_version: 1 }),
    hash = await digest(record);
  const old = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = () => {
      for (const [store, keyPath] of [
        ['records', 'id'],
        ['catalog', 'id'],
        ['search', 'id'],
        ['state', 'key'],
        ['captures', 'id'],
        ['conflicts', 'id'],
        ['staging', 'id'],
      ])
        req.result.createObjectStore(store, { keyPath });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const row = { id: record.id, record, hash, baseHash: null, rev: 4, scope: 'local', dirty: false };
  await new Promise((resolve, reject) => {
    const tx = old.transaction(['records', 'catalog'], 'readwrite');
    tx.objectStore('records').put(row);
    tx.objectStore('catalog').put({
      id: record.id,
      type: 'note',
      scope: 'local',
      dirty: false,
      hash,
    });
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  old.close();
  const upgraded = new Database(name, { broadcast: false });
  t.after(() => upgraded.close());
  const saved = await upgraded.get(record.id);
  assert.equal(saved.hash, hash);
  assert.equal(saved.rev, 4);
  assert.deepEqual(saved.record, record);
  assert.equal(saved.dirty, true);
  assert.equal((await upgraded.open()).version, 5);
  assert.equal((await upgraded.open()).objectStoreNames.contains('staging'), false);
  assert.equal((await upgraded.open()).objectStoreNames.contains('conflicts'), false);
  assert.equal(saved.baseHash, undefined);
  assert.equal(saved.scope, undefined);
});

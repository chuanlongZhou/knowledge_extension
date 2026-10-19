import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { Database } from '../extension/lib/db.js';
import { newRecord } from '../extension/lib/model.js';
import {
  buildLocalBackup,
  buildMarkdownExport,
  previewZipImport,
} from '../extension/lib/backup.js';
import { readableExport, safeExportName } from '../extension/lib/export-layout.js';
import { readZip, writeZip, validZipPath, MAX_ZIP_BYTES } from '../extension/lib/zip.js';
const decode = (bytes) => new TextDecoder().decode(bytes);
test('a full backup with an aggregate manifest above 32 MiB restores every record and attachment', async (t) => {
  const source = database(t),
    target = database(t);
  const asset = await source.storeAsset(
    new Blob(['large-backup-asset'], { type: 'image/png' }),
    'image.png',
  );
  const content = '知'.repeat(950000);
  const records = Array.from({ length: 12 }, (_, index) =>
    newRecord({
      title: `Large ${index}`,
      content,
      attachments: index === 0 ? [asset] : [],
    }),
  );
  await source.saveMany(records.map((record) => ({ record })));
  const backup = await source.exportData();
  assert.ok(new Blob([JSON.stringify(backup, null, 2)]).size > 32 * 1024 * 1024);
  const zip = await buildLocalBackup(source, { groupBy: 'none' });
  assert.ok(zip.size < MAX_ZIP_BYTES);
  await target.applyImport(await previewZipImport(target, zip));
  assert.equal((await target.allRows()).length, records.length);
  for (const record of records) assert.deepEqual((await target.get(record.id)).record, record);
  assert.equal(await (await target.getAsset(asset.id)).blob.text(), 'large-backup-asset');
});

test('the aggregate-manifest exception does not raise limits for ordinary ZIP members', async (t) => {
  const zip = await writeZip(
    new Map([['assets/oversized.bin', new Uint8Array(32 * 1024 * 1024 + 1)]]),
  );
  await assert.rejects(previewZipImport(database(t), zip), /超大文件/);
  await assert.rejects(
    readZip(zip, { entryLimits: { 'backup.json': MAX_ZIP_BYTES + 1 } }),
    /限制无效/,
  );
});

test('compressed backup members decode normally and stop when output exceeds the declared size', async () => {
  const text = 'bounded inflate '.repeat(10000);
  const bytes = new Uint8Array(
    await (await writeZip(new Map([['backup.json', text]]))).arrayBuffer(),
  );
  const view = new DataView(bytes.buffer);
  const dataStart = 30 + view.getUint16(26, true);
  const centralStart = view.getUint32(bytes.length - 6, true);
  const local = bytes.slice(0, dataStart),
    central = bytes.slice(centralStart, -22),
    end = bytes.slice(-22);
  const compressed = deflateRawSync(new TextEncoder().encode(text));
  const lv = new DataView(local.buffer),
    cv = new DataView(central.buffer);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, compressed.length, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, compressed.length, true);
  new DataView(end.buffer).setUint32(16, local.length + compressed.length, true);
  assert.equal(
    decode((await readZip(new Blob([local, compressed, central, end]))).get('backup.json')),
    text,
  );
  lv.setUint32(22, 32, true);
  cv.setUint32(24, 32, true);
  await assert.rejects(readZip(new Blob([local, compressed, central, end])), /解压内容过大/);
});
function database(t) {
  const db = new Database(`export-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  return db;
}

test('project names, hierarchy and multiple memberships produce readable copies with working shared-asset links and unique restoration', async (t) => {
  const a = database(t),
    b = database(t);
  const parent = newRecord({
    schema_version: 5,
    type: 'project',
    title: '论文研究',
    summary: '研究目标',
  });
  const child = newRecord({
    schema_version: 5,
    type: 'project',
    title: '参考资料',
    parent_project_id: parent.id,
  });
  const other = newRecord({ schema_version: 5, type: 'project', title: '阅读计划' });
  const asset = await a.storeAsset(new Blob(['binary'], { type: 'image/png' }), '原图.png');
  const note = newRecord({
    title: '我的阅读笔记',
    content: `![图](${asset.path})`,
    project_ids: [child.id, other.id],
    attachments: [asset],
  });
  const loose = newRecord({ title: '随手记' });
  await a.saveMany([parent, child, other, note, loose].map((record) => ({ record })));
  const zip = await buildLocalBackup(a, { groupBy: 'project' }),
    files = await readZip(zip);
  assert.ok(files.has('notes/项目/论文研究/论文研究.md'));
  assert.ok(files.has('notes/项目/论文研究/参考资料/我的阅读笔记.md'));
  assert.ok(files.has('notes/项目/阅读计划/我的阅读笔记.md'));
  assert.ok(files.has('notes/未归入项目/随手记.md'));
  assert.match(decode(files.get('notes/项目/论文研究/论文研究.md')), /研究目标/);
  for (const [name, bytes] of files)
    if (name.endsWith('.md')) {
      for (const [, relative] of decode(bytes).matchAll(/!\[图\]\(([^)]+)\)/g))
        assert.ok(
          files.has(path.posix.normalize(path.posix.join(path.posix.dirname(name), relative))),
          name,
        );
    }
  assert.equal([...files.keys()].filter((name) => name.startsWith('assets/')).length, 1);
  await b.applyImport(await previewZipImport(b, zip));
  assert.equal((await b.allRows()).length, 5);
  assert.deepEqual((await b.get(note.id)).record.project_ids, [child.id, other.id]);
});

test('tag exports include multiple categories, unused tag descriptions, untagged notes and original titles', async (t) => {
  const db = database(t);
  await db.saveMany([
    { record: newRecord({ title: '阅读摘录', tags: ['阅读', '工作'] }) },
    { record: newRecord({ title: '待分类' }) },
  ]);
  await db.renameTag('空标签', '空标签', '#3e6868', '尚无记录的标签描述');
  const files = await readZip(await buildMarkdownExport(db, { groupBy: 'tag' }));
  assert.ok(files.has('notes/标签/阅读/阅读摘录.md'));
  assert.ok(files.has('notes/标签/工作/阅读摘录.md'));
  assert.ok(files.has('notes/未打标签/待分类.md'));
  assert.match(decode(files.get('notes/标签/空标签/空标签.md')), /尚无记录的标签描述/);
  assert.equal(files.has('backup.json'), false);
});

test('unsafe and colliding names cannot overwrite another export or escape the ZIP', () => {
  const records = ['A/B', 'A\\B', 'a b', 'NUL', '../danger', '中文记录'].map((title) => ({
    record: newRecord({ title }),
  }));
  const backup = { records },
    first = readableExport(backup, 'none');
  const paths = first.entries.flatMap((entry) => entry.paths);
  assert.equal(new Set(paths.map((name) => name.toLowerCase())).size, records.length);
  assert.ok(paths.every(validZipPath));
  assert.ok(paths.includes('notes/中文记录.md'));
  assert.ok(paths.includes('notes/_NUL.md'));
  assert.equal(safeExportName('CON'), '_CON');
  assert.deepEqual(
    first.entries,
    readableExport({ records: [...records].reverse() }, 'none').entries,
  );
  assert.throws(() => readableExport(backup, 'unknown'), /请选择/);
  const tagged = readableExport(
    { records: [{ record: newRecord({ title: '标签重名', tags: ['A/B', 'A\\B', 'a b'] }) }] },
    'tag',
  );
  assert.equal(tagged.entries[0].paths.length, 3);
  assert.equal(new Set(tagged.entries[0].paths.map((name) => name.toLowerCase())).size, 3);
  assert.ok([...tagged.files.keys()].every(validZipPath));
});

test('trashed records remain separate from active project exports and tombstones stay in restore data', async (t) => {
  const db = database(t);
  const trashed = newRecord({ title: '已删除的笔记', deleted_at: new Date().toISOString() });
  const tombstone = {
    schema_version: 4,
    id: crypto.randomUUID(),
    kind: 'tombstone',
    created_at: new Date().toISOString(),
    deleted_at: new Date().toISOString(),
  };
  await db.saveMany([trashed, tombstone].map((record) => ({ record })));
  const files = await readZip(await buildLocalBackup(db));
  assert.ok(files.has('notes/回收站/已删除的笔记.md'));
  assert.equal([...files.keys()].filter((name) => name.endsWith('.md')).length, 1);
  assert.ok(files.has(`records/${tombstone.id}.json`));
});

import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../extension/lib/db.js';
import { GoogleDrive } from '../extension/lib/drive-client.js';
import { uploadFileAttachment } from '../extension/lib/file-attachments.js';
import { MockDirectDrive } from './mock-direct-drive.js';
import { bindFolder, syncDrive } from '../extension/lib/drive-sync.js';
import {
  newRecord,
  normalizeAttachment,
  drivePreviewUrl,
  toMarkdown,
} from '../extension/lib/model.js';
import {
  buildLocalBackup,
  buildMarkdownExport,
  previewZipImport,
} from '../extension/lib/backup.js';
import { readZip } from '../extension/lib/zip.js';
import { editStartList } from '../extension/lib/start-list.js';
import { parseListMarkdown } from '../extension/lib/collections.js';

async function setup(t) {
  const server = new MockDirectDrive();
  const drive = new GoogleDrive({
    runtime: { getManifest: () => ({ oauth2: { client_id: 'fixture' } }) },
    identity: { getAuthToken: async () => ({ token: 'alice' }) },
    fetchImpl: server.fetch.bind(server),
    sleep: async () => {},
  });
  const db = () => {
    const value = new Database(`attachments-${crypto.randomUUID()}`, { broadcast: false });
    t.after(() => value.close());
    return value;
  };
  const a = db(),
    b = db();
  const account = await drive.authorize();
  const folder = await drive.createFolder('File tests');
  await bindFolder(a, account, folder);
  await bindFolder(b, account, folder);
  const upload = (file, recordId, itemId = null) =>
    uploadFileAttachment(a, file, {
      recordId,
      itemId,
      drive,
      locks: null,
    });
  const sync = (data, direction, recordIds) =>
    syncDrive(data, direction, { drive, locks: null, recordIds });
  return { a, b, drive, server, folder, upload, sync, db };
}
const item = (id, todo = true) => ({
  id,
  text: id,
  kind: 'item',
  is_checkbox: todo,
  checked: false,
});

test('file upload uses disk-backed slices without reading the selected file or caching its bytes', async (t) => {
  const { a, server, upload } = await setup(t);
  const record = newRecord();
  const file = new File([new Uint8Array(9 * 1024 * 1024)], 'large.pdf', {
    type: 'application/pdf',
  });
  file.arrayBuffer = () => {
    throw new Error('Must not buffer selected file');
  };
  file.text = () => {
    throw new Error('Must not read selected file');
  };
  const descriptor = await upload(file, record.id);
  assert.equal(descriptor.storage, 'drive');
  assert.equal(descriptor.name, 'large.pdf');
  assert.equal(descriptor.size_bytes, file.size);
  assert.equal(descriptor.item_id, null);
  assert.equal((await a.allAssets()).length, 0);
  assert.equal(server.items.get(descriptor.drive_file_id).bytes.length, file.size);
  assert.equal(
    server.calls.filter((c) => c.method === 'PUT' && c.query.includes('upload_id')).length,
    2,
  );
  assert.equal(descriptor.path, undefined);
  assert.equal(descriptor.sha256, undefined);
  assert.equal(descriptor.blob, undefined);
  assert.match(
    drivePreviewUrl(descriptor.drive_file_id),
    /^https:\/\/drive.google.com\/file\/d\/[\w-]+\/view$/,
  );
});

test('multiple note, Todo and Idea files sync by item identity without downloading attachments', async (t) => {
  const { a, b, upload, sync, server } = await setup(t);
  const list = newRecord({ type: 'list', list: [item('todo'), item('idea', false)] });
  list.attachments = [
    await upload(new File(['one'], 'one.docx'), list.id, 'todo'),
    await upload(new File(['two'], 'two.pdf'), list.id, 'todo'),
    await upload(new File(['three'], 'three.zip'), list.id, 'idea'),
  ];
  const note = newRecord({ title: 'Note with files' });
  note.attachments = [await upload(new File([], 'empty.txt'), note.id)];
  await a.save(list);
  await a.save(note);
  const unrelated = newRecord({ title: 'Leave unsynced' });
  await a.save(unrelated);
  await sync(a, 'upload', [list.id, note.id]);
  assert.equal(
    [...server.items.values()].some((f) => f.appProperties?.record_id === unrelated.id),
    false,
  );
  const start = server.calls.length;
  assert.equal((await sync(b, 'download')).assetsDownloaded, 0);
  assert.deepEqual((await b.get(list.id)).record.attachments, list.attachments);
  assert.deepEqual((await b.get(note.id)).record.attachments, note.attachments);
  assert.equal((await b.allAssets()).length, 0);
  for (const call of server.calls.slice(start).filter((c) => c.query.includes('alt=media')))
    assert.notEqual(
      server.items.get(call.path.split('/').pop()).appProperties.pkm_role,
      'attachment',
    );
  await editStartList(b, (items) =>
    items.map((i) => (i.id === 'todo' ? { ...i, text: 'Edited', checked: true } : i)).reverse(),
  );
  assert.deepEqual((await b.get(list.id)).record.attachments, list.attachments);
  await editStartList(b, (items) => items.filter((i) => i.id !== 'todo'));
  assert.deepEqual(
    (await b.get(list.id)).record.attachments.map((a) => a.item_id),
    ['idea'],
  );
  assert.ok(server.items.has(list.attachments[0].drive_file_id), 'unlink preserves Drive original');
});

test('ZIP and Markdown preserve cloud links and associations without fetching file content', async (t) => {
  const { a, b, upload } = await setup(t);
  const list = newRecord({ type: 'list', list: [item('todo')] });
  list.attachments = [await upload(new File(['file bytes'], 'linked.pdf'), list.id, 'todo')];
  await a.save(list);
  const resolveAsset = () => {
    throw new Error('Cloud file must never be read');
  };
  const zip = await buildLocalBackup(a, { resolveAsset });
  const entries = await readZip(zip);
  assert.equal(
    [...entries.keys()].some((path) => path.startsWith('assets/')),
    false,
  );
  const plan = await previewZipImport(b, zip);
  assert.equal(plan.assets.length, 0);
  await b.applyImport(plan);
  assert.deepEqual((await b.get(list.id)).record.attachments, list.attachments);
  const markdown = await readZip(await buildMarkdownExport(a, { resolveAsset }));
  const text = [...markdown]
    .filter(([path]) => path.endsWith('.md'))
    .map(([, bytes]) => new TextDecoder().decode(bytes))
    .join('\n');
  assert.match(text, /Todo: todo/);
  assert.ok(text.includes(drivePreviewUrl(list.attachments[0].drive_file_id)));
  assert.ok(toMarkdown(list).includes('linked.pdf'));
});

test('invalid preview IDs and dangling or cross-record item references are rejected', async (t) => {
  const { upload } = await setup(t);
  const list = newRecord({ type: 'list', list: [item('todo')] });
  const descriptor = await upload(new File(['x'], 'file.txt'), list.id, 'todo');
  assert.throws(() => drivePreviewUrl('id/../../evil?x=1'));
  assert.throws(() => normalizeAttachment({ ...descriptor, drive_file_id: 'x?export=download' }));
  assert.throws(() => normalizeAttachment({ ...descriptor, blob: 'no bytes' }));
  assert.throws(() => newRecord({ ...list, attachments: [{ ...descriptor, item_id: 'missing' }] }));
  assert.throws(() => newRecord({ attachments: [descriptor] }));
  assert.throws(() => newRecord({ ...list, attachments: [descriptor, descriptor] }));
  assert.deepEqual(
    parseListMarkdown('- [ ] Edited', true, list.list).map((i) => i.id),
    ['todo'],
  );
  const existing = [item('one'), item('two')];
  assert.deepEqual(
    parseListMarkdown('- [ ] two\n- [ ] one', true, existing).map((i) => i.id),
    ['two', 'one'],
  );
  assert.deepEqual(
    parseListMarkdown('- [ ] two\n- [ ] one edited', true, existing).map((i) => i.id),
    ['two', 'one'],
  );
});

test('uploads refuse unbound accounts and failures leave no local file cache', async (t) => {
  const { a, drive, server, db } = await setup(t);
  const recordId = newRecord().id;
  await assert.rejects(
    uploadFileAttachment(db(), new File(['x'], 'file.txt'), { recordId, drive, locks: null }),
    /文件夹/,
  );
  const binding = await a.getState('drive:binding');
  await a.setState('drive:binding', { ...binding, accountId: 'bob' });
  await assert.rejects(
    uploadFileAttachment(a, new File(['x'], 'file.txt'), { recordId, drive, locks: null }),
    /账号/,
  );
  await a.setState('drive:binding', binding);
  const fetch = drive.fetch;
  drive.fetch = (url, options) =>
    new URL(url).searchParams.has('upload_id')
      ? Promise.resolve(
          new Response(
            '{"error":{"message":"Full","errors":[{"reason":"storageQuotaExceeded"}]}}',
            { status: 403 },
          ),
        )
      : fetch(url, options);
  await assert.rejects(
    uploadFileAttachment(a, new File(['x'], 'file.txt'), { recordId, drive, locks: null }),
    /存储空间/,
  );
  assert.equal((await a.allAssets()).length, 0);
  assert.equal(
    [...server.items.values()].filter((f) => f.appProperties?.pkm_role === 'attachment').length,
    0,
  );
});

test('automatic attachment sync includes required projects but leaves unrelated records pending', async (t) => {
  const { a, b, upload, sync, server } = await setup(t);
  const parent = newRecord({ schema_version: 5, type: 'project', title: 'Parent' });
  const project = newRecord({
    schema_version: 5,
    type: 'project',
    title: 'Child',
    parent_project_id: parent.id,
  });
  const note = newRecord({ title: 'Member', project_ids: [project.id] });
  note.attachments = [await upload(new File(['x'], 'member.txt'), note.id)];
  const unrelated = newRecord({ title: 'Unrelated' });
  await a.saveMany([parent, project, note, unrelated].map((record) => ({ record })));
  await sync(a, 'upload', [note.id]);
  await sync(b, 'download');
  assert.equal((await b.get(note.id)).record.project_ids[0], project.id);
  assert.equal((await b.get(project.id)).record.parent_project_id, parent.id);
  assert.equal(await b.get(unrelated.id), undefined);
  assert.equal(
    [...server.items.values()].some((f) => f.appProperties?.record_id === unrelated.id),
    false,
  );
});

test('untrusted resumable URLs cannot receive file data or the Google token', async () => {
  const calls = [];
  const drive = new GoogleDrive({
    fetchImpl: async (url) => {
      calls.push(url);
      return calls.length === 1
        ? new Response('{"ids":["safe-id"]}')
        : new Response(null, { headers: { Location: 'https://attacker.example/upload' } });
    },
  });
  drive.accessToken = 'secret';
  await assert.rejects(
    drive.uploadAttachment('folder', new File(['secret contents'], 'private.txt'), {}),
    /请求地址/,
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.startsWith('https://www.googleapis.com/')));
});

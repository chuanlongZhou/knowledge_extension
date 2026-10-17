import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Database } from '../extension/lib/db.js';
import { newRecord, digestBytes } from '../extension/lib/model.js';
import {
  loadExamples,
  loadExampleAsset,
  saveExample,
  saveExamples,
} from '../extension/lib/examples.js';

const directory = new URL('../extension/examples/', import.meta.url);
const localFetch = async (url) => {
  assert.ok(
    String(url).startsWith(directory.href),
    'examples must load only their bundled directory',
  );
  try {
    return new Response(await readFile(fileURLToPath(url)));
  } catch (error) {
    if (error.code === 'ENOENT') return new Response('', { status: 404 });
    throw error;
  }
};
async function fixture(t, name) {
  const db = new Database(name || `examples-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  return db;
}
test('six examples use passed test evidence, original verified media and explicit synthetic audio labels', async () => {
  const examples = await loadExamples(localFetch);
  assert.equal(examples.length, 6);
  const reports = {};
  for (const mode of ['offline', 'live'])
    reports[mode] = JSON.parse(await readFile(`docs/demo-results/${mode}.json`, 'utf8'));
  for (const example of examples) {
    assert.equal(reports[example.mode].cases.find((c) => c.id === example.test).status, 'passed');
    assert.ok(!example.record.sources.some((source) => source.url.includes('bilibili')));
    for (const descriptor of example.record.attachments) {
      const blob = await loadExampleAsset(descriptor, localFetch);
      assert.equal(await digestBytes(await blob.arrayBuffer()), descriptor.id);
      if (descriptor.kind === 'audio') {
        assert.ok(descriptor.duration_ms >= 2000);
        assert.match(example.description, /虚拟麦克风/);
      }
    }
  }
  assert.equal(new Set(examples.map((e) => e.record.id)).size, 6);
});
test('saving an example imports record and all media while preserving an unrelated user record', async (t) => {
  const db = await fixture(t),
    user = newRecord({ title: 'My existing note', content: 'Keep my work.' });
  await db.save(user);
  const example = (await loadExamples(localFetch)).find((e) => e.id === 'mixed');
  assert.equal((await db.allAssets()).length, 0);
  const result = await saveExample(db, example, { fetchImpl: localFetch });
  assert.equal(result.status, 'saved');
  assert.deepEqual((await db.get(user.id)).record, user);
  assert.equal((await db.allRows()).length, 2);
  assert.equal((await db.get(result.id)).record.organization_state, 'inbox');
  for (const descriptor of example.record.attachments)
    assert.ok((await db.getAsset(descriptor.id)).blob.size);
  assert.equal((await db.get(result.id)).dirty, true);
});
test('repeated imports preserve user edits, trash and tombstones instead of restoring packaged content', async (t) => {
  const db = await fixture(t),
    example = (await loadExamples(localFetch)).find((e) => e.id === 'text');
  await saveExample(db, example, { fetchImpl: localFetch });
  await db.mutate(example.record.id, (r) => ({ ...r, content: 'My edited content' }));
  assert.equal((await saveExample(db, example, { fetchImpl: localFetch })).status, 'already-saved');
  assert.equal((await db.get(example.record.id)).record.content, 'My edited content');
  await db.trash(example.record.id);
  await saveExample(db, example, { fetchImpl: localFetch });
  assert.ok((await db.get(example.record.id)).record.deleted_at);
  await db.purge(example.record.id);
  await saveExample(db, example, { fetchImpl: localFetch });
  assert.equal((await db.get(example.record.id)).record.kind, 'tombstone');
  assert.equal((await db.allRows()).length, 1);
});
test('two windows saving the same packaged ID create one copy', async (t) => {
  const name = `example-race-${crypto.randomUUID()}`,
    a = await fixture(t, name),
    b = await fixture(t, name);
  const example = (await loadExamples(localFetch)).find((e) => e.id === 'mixed');
  const results = await Promise.all([
    saveExample(a, example, { fetchImpl: localFetch }),
    saveExample(b, example, { fetchImpl: localFetch }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['already-saved', 'saved']);
  assert.equal((await a.allRows()).length, 1);
  assert.equal((await a.allAssets()).length, example.record.attachments.length);
});
test('bad bundled media aborts before any record or asset is written', async (t) => {
  const db = await fixture(t),
    example = (await loadExamples(localFetch)).find((e) => e.id === 'mixed');
  await assert.rejects(
    saveExample(db, example, { fetchImpl: async () => new Response('corrupt media') }),
    /校验失败/,
  );
  assert.equal((await db.allRows()).length, 0);
  assert.equal((await db.allAssets()).length, 0);
});

test('bulk import skips edited and deleted copies, keeps unrelated notes and imports new media once', async (t) => {
  const db = await fixture(t),
    examples = await loadExamples(localFetch);
  const user = newRecord({ title: 'My own work', content: 'Keep this.' });
  await db.save(user);
  await saveExample(db, examples[0], { fetchImpl: localFetch });
  await db.mutate(examples[0].record.id, (r) => ({ ...r, content: 'Edited by user' }));
  await saveExample(db, examples[1], { fetchImpl: localFetch });
  await db.trash(examples[1].record.id);
  await db.purge(examples[1].record.id);
  assert.deepEqual(await saveExamples(db, examples, { fetchImpl: localFetch }), {
    saved: 4,
    existing: 2,
  });
  assert.equal((await db.get(examples[0].record.id)).record.content, 'Edited by user');
  assert.equal((await db.get(examples[1].record.id)).record.kind, 'tombstone');
  assert.deepEqual((await db.get(user.id)).record, user);
  assert.equal((await db.allRows()).length, 7);
  assert.equal((await db.allAssets()).length, 4);
  assert.deepEqual(await saveExamples(db, examples, { fetchImpl: localFetch }), {
    saved: 0,
    existing: 6,
  });
});

test('bulk import fails atomically on corrupt media and two windows importing all examples converge', async (t) => {
  const name = `example-bulk-race-${crypto.randomUUID()}`,
    a = await fixture(t, name),
    b = await fixture(t, name),
    examples = await loadExamples(localFetch);
  await assert.rejects(
    saveExamples(a, examples, { fetchImpl: async () => new Response('bad') }),
    /校验失败/,
  );
  assert.equal((await a.allRows()).length, 0);
  assert.equal((await a.allAssets()).length, 0);
  const results = await Promise.all([
    saveExamples(a, examples, { fetchImpl: localFetch }),
    saveExamples(b, examples, { fetchImpl: localFetch }),
  ]);
  assert.deepEqual(
    results.map((r) => r.saved).sort((x, y) => x - y),
    [0, 6],
  );
  assert.equal((await a.allRows()).length, 6);
  assert.equal((await a.allAssets()).length, 4);
});

test('a shared media file retains the users filename and verified local bytes', async (t) => {
  const db = await fixture(t),
    example = (await loadExamples(localFetch)).find((e) => e.id === 'mixed');
  const descriptor = { ...example.record.attachments[0], name: 'my-image.png' };
  const blob = await loadExampleAsset(descriptor, localFetch);
  await db.putAsset(descriptor, blob);
  await saveExample(db, example, { fetchImpl: localFetch });
  const asset = await db.getAsset(descriptor.id);
  assert.equal(asset.descriptor.name, 'my-image.png');
  assert.equal(await digestBytes(await asset.blob.arrayBuffer()), descriptor.id);
});

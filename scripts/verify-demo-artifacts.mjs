import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readZip } from '../extension/lib/zip.js';
const spec = JSON.parse(await readFile('tests/fixtures/demo-cases.json', 'utf8'));
assert.equal(new Set(spec.cases.map((c) => c.id)).size, 25);
const bundled = await readFile('extension/guide/使用说明书.md', 'utf8');
assert.equal(
  await readFile('使用说明书.md', 'utf8'),
  bundled.replaceAll('](images/', '](extension/guide/images/'),
);
const references = [...bundled.matchAll(/^!\[[^\]]*\]\((images\/[a-z0-9_-]+\.png)\)$/gm)].map(
  (match) => match[1],
);
assert.ok(references.length > 20);
for (const file of references) {
  const bytes = await readFile(path.join('extension/guide', file));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
}
for (const mode of ['offline', 'live']) {
  const report = JSON.parse(await readFile(`docs/demo-results/${mode}.json`, 'utf8'));
  for (const item of report.cases)
    for (const step of item.steps) {
      const bytes = await readFile(path.join('extension/guide', step.image));
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        step.sha256,
        `${mode}/${item.id} screenshot changed after report`,
      );
    }
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const preview = process.argv.includes('--preview');
const entries = new Map();
if (preview) {
  for (const file of [
    'installers/manifest.json',
    'guide/使用说明书.md',
    ...references.map((file) => 'guide/' + file),
    'manual.html',
    'manual.css',
    'manual.js',
    'lib/guide.js',
    'guide/测试流程.md',
    'theme.css',
    'lib/theme.js',
    'lib/appearance.js',
  ])
    entries.set('pkm-nexus/' + file, await readFile(path.join('dist/pkm-nexus', file)));
} else {
  const archive = await readFile(`dist/PKM-Nexus-${manifest.version}.zip`);
  for (const entry of await readZip(new Blob([archive]), { maxEntryBytes: 128 * 1024 * 1024 }))
    entries.set(...entry);
}
const installer = JSON.parse(
  new TextDecoder().decode(entries.get('pkm-nexus/installers/manifest.json')),
);
if (preview) assert.equal(installer.blocked, true);
else {
  const installerBytes = entries.get('pkm-nexus/installers/' + installer.archive);
  assert.equal(installerBytes.byteLength, installer.sizeBytes);
  assert.equal(createHash('sha256').update(installerBytes).digest('hex'), installer.sha256);
  assert.deepEqual(
    Buffer.from(installerBytes),
    await readFile(path.join('dist', installer.archive)),
  );
}
assert.equal(new TextDecoder().decode(entries.get('pkm-nexus/guide/使用说明书.md')), bundled);
for (const file of references) assert.ok(entries.has('pkm-nexus/guide/' + file));
for (const file of [
  'manual.html',
  'manual.css',
  'manual.js',
  'lib/guide.js',
  'guide/测试流程.md',
  'theme.css',
  'lib/theme.js',
  'lib/appearance.js',
])
  assert.deepEqual(
    Buffer.from(entries.get('pkm-nexus/' + file)),
    await readFile('extension/' + file),
  );
let helpUi = 'not_run';
try {
  const help = JSON.parse(await readFile('docs/demo-results/guide.json', 'utf8'));
  if (
    help.extensionVersion === manifest.version &&
    help.cases.some((item) => item.id === 'H01' && item.status === 'passed')
  )
    helpUi = 'passed';
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const result = {
  version: manifest.version,
  cases: spec.cases.length,
  screenshotReferences: references.length,
  sourceLinks: 'passed',
  pngHeaders: 'passed',
  evidenceHashes: 'passed',
  zipCrcAndResources: preview ? 'not_run' : 'passed',
  previewResources: preview ? 'passed' : 'not_run',
  browserHelpUi: helpUi,
  reason:
    'Static asset checks and the separately recorded H01 browser result are reported independently.',
};
await writeFile('test-results/guide-assets-report.json', JSON.stringify(result, null, 2) + '\n');
console.log(
  `PASS 25 cases, ${references.length} screenshot references, evidence SHA-256, Unicode Markdown and ${preview ? 'preview' : 'ZIP'} resources. H01 browser result: ${helpUi}.`,
);

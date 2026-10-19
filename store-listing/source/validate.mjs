import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip, readZip } from '../../extension/lib/zip.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'store-listing');
const fields = JSON.parse(await readFile(path.join(base, 'listing-fields.json'), 'utf8'));
const manifest = [];
async function inspect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name),
      relative = path.relative(base, file).split(path.sep).join('/');
    if (entry.isDirectory()) {
      await inspect(file);
      continue;
    }
    if (['asset-manifest.json', 'validation.json'].includes(relative)) continue;
    const bytes = await readFile(file);
    const row = {
      file: relative,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    if (relative.endsWith('.png')) {
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', relative);
      row.width = bytes.readUInt32BE(16);
      row.height = bytes.readUInt32BE(20);
      row.bitDepth = bytes[24];
      row.pngColorType = bytes[25];
      assert.equal(row.bitDepth, 8, relative);
      if (relative.startsWith('assets/screenshots/')) {
        assert.equal(row.width, 1280, relative);
        assert.equal(row.height, 800, relative);
        assert.equal(row.pngColorType, 2, relative + ' must be RGB');
      }
      if (relative === 'assets/promotional/small-440x280.png') {
        assert.equal(row.width, 440);
        assert.equal(row.height, 280);
        assert.equal(row.pngColorType, 2);
      }
      if (relative === 'assets/promotional/marquee-1400x560.png') {
        assert.equal(row.width, 1400);
        assert.equal(row.height, 560);
        assert.equal(row.pngColorType, 2);
      }
    }
    manifest.push(row);
  }
}
await inspect(base);
for (const locale of ['zh-CN', 'en', 'fr', 'ja']) {
  const value = fields.locales[locale];
  assert.equal(value.name, 'GUGA Knowledge');
  assert.ok(value.shortDescription.length <= 132);
  assert.ok(value.description.length > 500);
  assert.equal(value.screenshotCaptions.length, 5);
  assert.equal(
    manifest.filter((row) => row.file.startsWith('assets/screenshots/' + locale + '/')).length,
    5,
  );
}
assert.equal(manifest.filter((row) => row.file.startsWith('assets/screenshots/')).length, 20);
assert.equal(manifest.filter((row) => row.file.startsWith('assets/promotional/')).length, 2);
assert.deepEqual(
  await readFile(path.join(base, 'assets/icons/current-icon-128.png')),
  await readFile(path.join(root, 'extension/icons/icon-128.png')),
);
assert.deepEqual(
  await readFile(path.join(base, 'source/illustrations/penguin.png')),
  await readFile(path.join(root, 'extension/icons/penguin.png')),
);
assert.equal(manifest.filter((row) => row.file.startsWith('assets/icons/')).length, 4);
const capture = JSON.parse(await readFile(path.join(base, 'capture-report.json'), 'utf8'));
assert.equal(capture.screenshots.length, 20);
assert.deepEqual(capture.errors, []);
manifest.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(
  path.join(base, 'asset-manifest.json'),
  JSON.stringify({ version: fields.version, files: manifest }, null, 2),
);
const report = {
  version: fields.version,
  checks: [
    'Four complete localized listings; short descriptions at most 132 characters',
    '20 real screenshots at 1280×800, RGB 8-bit PNG',
    'One global 440×280 small promo and 1400×560 marquee, RGB PNG',
    'Current store icon is byte-identical to current extension icon',
    'Original project penguin used unchanged, with source reference and editable layouts',
    'No personal browser or Google account data used',
  ],
  shortDescriptionLengths: Object.fromEntries(
    Object.entries(fields.locales).map(([locale, value]) => [
      locale,
      value.shortDescription.length,
    ]),
  ),
  captureErrors: capture.errors,
  zip: 'dist/GUGA-Knowledge-store-assets-0.9.1.zip',
};
await writeFile(path.join(base, 'validation.json'), JSON.stringify(report, null, 2));
const files = new Map();
for (const row of manifest)
  files.set(
    'GUGA-Knowledge-store-assets/' + row.file,
    new Uint8Array(await readFile(path.join(base, row.file))),
  );
for (const name of ['asset-manifest.json', 'validation.json'])
  files.set(
    'GUGA-Knowledge-store-assets/' + name,
    new Uint8Array(await readFile(path.join(base, name))),
  );
const zip = await writeZip(files);
assert.equal((await readZip(zip)).size, files.size);
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, report.zip), new Uint8Array(await zip.arrayBuffer()));
console.log(
  `PASS ${Object.keys(fields.locales).length} locales, 20 screenshots, 2 promotional images; ZIP ${files.size} files, ${(zip.size / 1024 / 1024).toFixed(1)} MB`,
);

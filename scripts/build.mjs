import { cp, mkdir, readdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { writeZip } from '../extension/lib/zip.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleCompanionInstaller } from './bundle-companion-installer.mjs';
import { VERSION } from '../companion/util.mjs';
const preview = process.argv.includes('--preview');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extension'),
  destination = path.join(root, 'dist', 'pkm-nexus');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
// Refuse to produce a distributable extension with a missing installer.
if (!preview) await bundleCompanionInstaller(root, source);
if (path.relative(root, destination).split(path.sep).join('/') !== 'dist/pkm-nexus')
  throw new Error('Unexpected build output path');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, {
  recursive: true,
  filter: (file) => !preview || path.relative(source, file).split(path.sep)[0] !== 'installers',
});
if (preview) {
  await mkdir(path.join(destination, 'installers'), { recursive: true });
  await writeFile(
    path.join(destination, 'installers', 'manifest.json'),
    JSON.stringify(
      {
        blocked: true,
        version: VERSION,
        reason: 'Security review preview; no executable archive is included.',
      },
      null,
      2,
    ) + '\n',
  );
}
await cp(path.join(root, 'README.md'), path.join(destination, 'README.md'));
const guide = await readFile(path.join(source, 'guide', '使用说明书.md'), 'utf8');
await writeFile(
  path.join(destination, '使用说明书.md'),
  guide.replaceAll('](images/', '](guide/images/'),
);
await cp(path.join(root, 'DATA-SCHEMA.md'), path.join(destination, 'DATA-SCHEMA.md'));
await cp(path.join(root, 'VALIDATION.md'), path.join(destination, 'VALIDATION.md'));
await cp(path.join(root, 'PRIVACY.md'), path.join(destination, 'PRIVACY.md'));
await mkdir(path.join(destination, 'docs'), { recursive: true });
for (const name of [
  'COMPANION.md',
  'GOOGLE-COMPLIANCE.md',
  'ARCHITECTURE.md',
  'DEMO-TEST-PLAN.md',
  'ORGANIZATION.md',
  'SECURITY-2026-10-17.md',
  'GITHUB-PAGES.md',
])
  await cp(path.join(root, 'docs', name), path.join(destination, 'docs', name));
await cp(path.join(root, 'CHANGELOG.md'), path.join(destination, 'CHANGELOG.md'));
async function inventory(dir) {
  let bytes = 0,
    files = 0;
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      const nested = await inventory(full);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      bytes += (await stat(full)).size;
      files++;
    }
  }
  return { bytes, files };
}
const size = await inventory(destination);
if (preview) {
  console.log(
    `Prepared extension preview: ${size.files} files. Companion download remains blocked.\nLoad unpacked: ${destination}`,
  );
  process.exit(0);
}
const files = new Map();
async function collect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await collect(file);
    else
      files.set(
        `pkm-nexus/${path.relative(destination, file).split(path.sep).join('/')}`,
        new Uint8Array(await readFile(file)),
      );
  }
}
await collect(destination);
const archive = path.join(root, 'dist', `PKM-Nexus-${manifest.version}.zip`);
await writeFile(archive, new Uint8Array(await (await writeZip(files)).arrayBuffer()));
console.log(
  `PKM Nexus ${manifest.version}: ${size.files} files, ${(size.bytes / 1024).toFixed(1)} KB.\nLoad unpacked: ${destination}`,
);
console.log(`ZIP: ${archive}`);

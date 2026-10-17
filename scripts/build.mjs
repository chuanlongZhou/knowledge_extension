import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { writeZip } from '../extension/lib/zip.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extension'),
  destination = path.join(root, 'dist', 'pkm-nexus');
if (path.relative(root, destination).split(path.sep).join('/') !== 'dist/pkm-nexus')
  throw new Error('Unexpected output path');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, {
  recursive: true,
  filter: (file) => {
    const relative = path.relative(source, file).split(path.sep).join('/');
    return (
      relative !== 'installers' &&
      !relative.startsWith('installers/') &&
      !/^lib\/companion(?:-install)?\.js$/.test(relative)
    );
  },
});
for (const name of ['README.md', 'PRIVACY.md', 'DATA-SCHEMA.md', 'VALIDATION.md', 'CHANGELOG.md'])
  await cp(path.join(root, name), path.join(destination, name));
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
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const archive = path.join(root, 'dist', `PKM-Nexus-${manifest.version}-direct-drive.zip`);
await writeFile(archive, new Uint8Array(await (await writeZip(files)).arrayBuffer()));
console.log(
  `PKM Nexus ${manifest.version}: ${files.size} files.\nLoad unpacked: ${destination}\nZIP: ${archive}`,
);

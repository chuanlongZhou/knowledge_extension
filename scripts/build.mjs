import {cp, mkdir, readdir, readFile, stat, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extension'), destination = path.join(root, 'dist', 'pkm-nexus');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
if (path.relative(root, destination).split(path.sep).join('/') !== 'dist/pkm-nexus') throw new Error('Unexpected build output path');
await rm(destination, {recursive: true, force: true});
await mkdir(destination, {recursive: true}); await cp(source, destination, {recursive: true});
await cp(path.join(root, 'README.md'), path.join(destination, 'README.md'));
await cp(path.join(root, 'DATA-SCHEMA.md'), path.join(destination, 'DATA-SCHEMA.md'));
async function inventory(dir) { let bytes = 0, files = 0; for (const item of await readdir(dir, {withFileTypes: true})) { const full = path.join(dir, item.name); if (item.isDirectory()) { const nested = await inventory(full); bytes += nested.bytes; files += nested.files; } else { bytes += (await stat(full)).size; files++; } } return {bytes, files}; }
const size = await inventory(destination);
console.log(`PKM Nexus ${manifest.version}: ${size.files} files, ${(size.bytes / 1024).toFixed(1)} KB.\nLoad unpacked: ${destination}`);

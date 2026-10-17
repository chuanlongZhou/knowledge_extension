import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../companion/util.mjs';
import { googleClient } from '../companion/google-client.mjs';
import { buildDesktop } from './build-desktop.mjs';
import { windowsSignatures } from './windows-signatures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (
  process.platform !== 'win32' ||
  process.arch !== 'x64' ||
  Number(process.versions.node.split('.')[0]) !== 24
)
  throw new Error('Prepare the application on Windows x64 with the supported Node 24 runtime.');
const [signature] = windowsSignatures([process.execPath]);
if (signature.status !== 'Valid' || !signature.subject?.includes('OpenJS Foundation'))
  throw new Error('The source Node runtime must have a valid OpenJS Foundation signature.');
const directory = path.join(root, 'dist', `PKM-Nexus-Companion-${VERSION}-candidate`),
  work = path.join(root, 'dist', 'desktop-build');
await mkdir(path.join(directory, 'runtime'), { recursive: true });
await mkdir(work, { recursive: true });
await mkdir(path.join(directory, 'app', 'companion', 'ui'), { recursive: true });
await mkdir(path.join(directory, 'app', 'extension', 'lib'), { recursive: true });
await cp(process.execPath, path.join(directory, 'runtime', 'node.exe'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceHash = hash(await readFile(process.execPath));
if (hash(await readFile(path.join(directory, 'runtime', 'node.exe'))) !== sourceHash)
  throw new Error('The runtime changed during copying.');
for (const entry of await readdir(path.join(root, 'companion'), { withFileTypes: true }))
  if (entry.isFile() && entry.name.endsWith('.mjs'))
    await cp(
      path.join(root, 'companion', entry.name),
      path.join(directory, 'app', 'companion', entry.name),
    );
for (const file of ['index.html', 'app.js', 'styles.css'])
  await cp(
    path.join(root, 'companion', 'ui', file),
    path.join(directory, 'app', 'companion', 'ui', file),
  );
await cp(
  path.join(root, 'extension', 'lib', 'model.js'),
  path.join(directory, 'app', 'extension', 'lib', 'model.js'),
);
await writeFile(path.join(directory, 'app', 'package.json'), '{"private":true,"type":"module"}\n');
let client = null;
const clientFile =
  process.env.PKM_NEXUS_GOOGLE_CLIENT_FILE || path.join(root, 'companion', 'google-oauth.json');
try {
  client = googleClient(JSON.parse(await readFile(clientFile, 'utf8')));
} catch (error) {
  if (error.code !== 'ENOENT' || process.env.PKM_NEXUS_GOOGLE_CLIENT_FILE) throw error;
}
await writeFile(
  path.join(directory, 'app', 'companion', 'google-oauth.json'),
  JSON.stringify(client),
);
await cp(
  path.join(root, 'companion', 'NODE-LICENSE.txt'),
  path.join(directory, 'NODE-LICENSE.txt'),
);
await cp(path.join(root, 'PRIVACY.md'), path.join(directory, 'PRIVACY.md'));
await writeFile(
  path.join(directory, 'README.md'),
  (await readFile(path.join(root, 'docs', 'COMPANION.md'), 'utf8')).replaceAll(
    '](GITHUB-PAGES.md)',
    '](docs/GITHUB-PAGES.md)',
  ),
);
await cp(
  path.join(root, 'docs', 'SECURITY-2026-10-17.md'),
  path.join(directory, 'SECURITY-2026-10-17.md'),
);
await mkdir(path.join(directory, 'docs'), { recursive: true });
for (const file of ['GOOGLE-COMPLIANCE.md', 'ARCHITECTURE.md', 'GITHUB-PAGES.md'])
  await cp(path.join(root, 'docs', file), path.join(directory, 'docs', file));
await buildDesktop(root, directory, work);
await cp(path.join(root, 'companion', 'desktop'), path.join(directory, 'source', 'desktop'), {
  recursive: true,
});
const files = [];
async function inventory(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) await inventory(absolute);
    else if (entry.name !== 'candidate.json') {
      const bytes = await readFile(absolute);
      files.push({
        path: path.relative(directory, absolute).split(path.sep).join('/'),
        bytes: bytes.length,
        sha256: hash(bytes),
      });
    }
  }
}
await inventory(directory);
await writeFile(
  path.join(directory, 'candidate.json'),
  JSON.stringify(
    {
      format: 'pkm-nexus-transparent-runtime',
      version: VERSION,
      reviewRequired: true,
      runtime: { version: process.version, sha256: sourceHash, signature },
      googleConfigured: !!client,
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Prepared review directory: ${directory}`);
console.log(
  'Official runtime copied byte-for-byte. No candidate executable was run; no installer or distributable ZIP was produced.',
);

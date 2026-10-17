import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../extension/lib/zip.js';
import { VERSION } from '../companion/util.mjs';
import { assertCompanionReleaseEnabled } from './release-safety.mjs';
import { windowsSignatures } from './windows-signatures.mjs';
import { bundleCompanionInstaller } from './bundle-companion-installer.mjs';
import { digest, executableNames, verifyCandidateScan } from './companion-security.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await assertCompanionReleaseEnabled(root);
const directory = path.join(root, 'dist', `PKM-Nexus-Companion-${VERSION}-candidate`);
const manifestBytes = await readFile(path.join(directory, 'candidate.json'));
const manifest = JSON.parse(manifestBytes);
if (manifest.format !== 'pkm-nexus-transparent-runtime' || manifest.version !== VERSION)
  throw new Error('Prepare and review the transparent-runtime candidate first.');
const signatures = windowsSignatures(executableNames.map((name) => path.join(directory, name)));
if (
  signatures.at(-1).status !== 'Valid' ||
  !signatures.at(-1).subject?.includes('OpenJS Foundation')
)
  throw new Error('Official Node runtime signature is invalid.');
if (signatures.some((signature) => !['Valid', 'NotSigned'].includes(signature.status)))
  throw new Error('An executable has a broken or untrusted signature.');
const scan = await verifyCandidateScan(root, directory);
const files = new Map();
for (const name of executableNames)
  if (!manifest.files.some((entry) => entry.path === name))
    throw new Error(`Missing executable inventory: ${name}`);
for (const entry of manifest.files) {
  if (
    typeof entry.path !== 'string' ||
    entry.path.includes('..') ||
    entry.path.includes(':') ||
    entry.path.includes('\\') ||
    entry.path.startsWith('/')
  )
    throw new Error('Invalid candidate path.');
  const bytes = await readFile(path.join(directory, entry.path));
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
    throw new Error('Candidate changed after review; repeat the security verification.');
  files.set(`PKM-Nexus-Companion-${VERSION}/${entry.path}`, new Uint8Array(bytes));
}
const release = {
  format: 'pkm-nexus-portable-release',
  version: VERSION,
  candidateSHA256: digest(manifestBytes),
  googleConfigured: manifest.googleConfigured,
  runtime: manifest.runtime,
  signatures,
  scan,
  files: manifest.files,
};
files.set(
  `PKM-Nexus-Companion-${VERSION}/RELEASE.json`,
  new TextEncoder().encode(JSON.stringify(release, null, 2) + '\n'),
);
const archiveBytes = new Uint8Array(await (await writeZip(files)).arrayBuffer());
await writeFile(
  path.join(root, 'dist', `PKM-Nexus-Companion-${VERSION}-windows-x64.zip`),
  archiveBytes,
);
await writeFile(
  path.join(root, 'dist', `PKM-Nexus-Companion-${VERSION}-release.json`),
  JSON.stringify({ ...release, archiveSHA256: digest(archiveBytes) }, null, 2) + '\n',
);
await bundleCompanionInstaller(root, path.join(root, 'extension'));
console.log(
  'Created scanned portable companion archive. Official runtime signature and file integrity verified.',
);

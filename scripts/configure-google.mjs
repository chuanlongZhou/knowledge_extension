import { readFile, writeFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
const clientId = process.argv[2];
if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId || ''))
  throw new Error('Usage: node scripts/configure-google.mjs <Chrome-extension OAuth client ID>');
const path = new URL('../extension/manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(path, 'utf8'));
if (process.argv[3]) {
  createPublicKey({ key: Buffer.from(process.argv[3], 'base64'), format: 'der', type: 'spki' });
  manifest.key = process.argv[3];
}
manifest.oauth2 = { client_id: clientId, scopes: ['https://www.googleapis.com/auth/drive.file'] };
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  'Google OAuth client configured. Reload the same extension directory; confirm its ID matches the Chrome OAuth registration.',
);

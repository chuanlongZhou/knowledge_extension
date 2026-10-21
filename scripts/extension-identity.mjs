import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const file = new URL('../extension/manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(file, 'utf8'));
if (!manifest.key) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  manifest.key = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}
createPublicKey({ key: Buffer.from(manifest.key, 'base64'), format: 'der', type: 'spki' });
const id = [
  ...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32),
]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');
console.log(
  `Stable extension ID: ${id}\nRegister this ID in the Chrome OAuth client. Keep manifest.key in unpacked builds; Chrome Web Store uploads omit it. Changing extension identity creates a separate browser database; export/import a ZIP to migrate existing data.`,
);

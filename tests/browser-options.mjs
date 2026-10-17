import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const fixtures = new Map();
// Positive capture scenarios simulate a user who has granted the optional website access.
// The shipped manifest keeps that access optional; default-permission tests load it unchanged.
export async function authorizedExtension(source, profileRoot) {
  const target = path.join(profileRoot, 'authorized-extension');
  if (fixtures.has(target)) return fixtures.get(target);
  const promise = (async () => {
    await cp(source, target, { recursive: true });
    const file = path.join(target, 'manifest.json'),
      manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), '<all_urls>'])];
    delete manifest.optional_host_permissions;
    await writeFile(file, JSON.stringify(manifest, null, 2));
    return target;
  })();
  fixtures.set(target, promise);
  return promise;
}
export function browserOptions() {
  return process.env.PKM_CHROMIUM_PATH
    ? { executablePath: process.env.PKM_CHROMIUM_PATH }
    : { channel: process.env.PKM_CHROMIUM_CHANNEL || 'chromium' };
}

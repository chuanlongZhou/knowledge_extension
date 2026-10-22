import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readZip } from '../extension/lib/zip.js';
import { EXPORT_PREFIX } from '../extension/lib/brand.js';

const source = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const archive = `dist/${EXPORT_PREFIX}-${source.version}-direct-drive.zip`;
const files = await readZip(new Blob([await readFile(archive)]));
assert.ok(files.has('manifest.json'), 'The store ZIP must contain manifest.json at its root');
assert.ok(
  !files.has('pkm-nexus/manifest.json'),
  'The store ZIP must not wrap the extension in a folder',
);
const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
const storeSource = { ...source };
delete storeSource.key;
assert.deepEqual(manifest, storeSource);
assert.equal(Object.hasOwn(manifest, 'key'), false, 'Chrome Web Store rejects the key field');
assert.equal(manifest.chrome_url_overrides?.newtab, 'start.html');
const policy = manifest.content_security_policy.extension_pages;
assert.match(policy, /(?:^|;\s*)script-src 'self';/);
assert.match(policy, /(?:^|;\s*)style-src 'self';/);
assert.match(
  policy,
  /(?:^|;\s*)style-src-elem 'self' 'unsafe-inline';/,
  'CodeMirror mounts dynamic style sheets; the packaged CSP must allow style elements',
);
for (const resource of [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  manifest.chrome_url_overrides.newtab,
  manifest.options_page.split('#')[0],
  ...Object.values(manifest.icons),
]) {
  assert.ok(files.has(resource), `Missing manifest resource: ${resource}`);
  assert.deepEqual(Buffer.from(files.get(resource)), await readFile(`extension/${resource}`));
}
assert.ok(
  ![...files.keys()].some((name) => name.startsWith('installers/') || /^lib\/companion/.test(name)),
);
console.log(`PASS ${archive}: root manifest, entry points, icons and release exclusions verified`);

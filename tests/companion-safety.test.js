import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, writeFile, utimes, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { VERSION } from '../companion/util.mjs';
import { platformCall } from '../companion/platform.mjs';
import { assertCompanionReleaseEnabled } from '../scripts/release-safety.mjs';
import { executableNames, verifyCandidateScan } from '../scripts/companion-security.mjs';

test('shipped source contains no executable rewriting, encoded shells or security exclusion commands', async () => {
  const prohibited =
    /node:sea|postject|EncodedCommand|ExecutionPolicy|WriteProcessMemory|CreateRemoteThread|VirtualAllocEx|Add-MpPreference|Set-MpPreference|ExclusionPath|rundll32\.exe|powershell\.exe|cmd\.exe/i;
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (/\.(mjs|js|cs|ps1|cmd|vbs)$/.test(entry.name)) {
        assert.ok(!/\.(ps1|cmd|vbs)$/.test(entry.name), `No script installers: ${file}`);
        assert.doesNotMatch(await readFile(file, 'utf8'), prohibited, file);
      }
    }
  }
  await inspect('companion');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(!pkg.devDependencies.postject);
  assert.ok(!pkg.devDependencies.esbuild);
});

test('prepared runtime is byte-identical to the trusted source and every candidate file matches inventory', async () => {
  const root = path.resolve(`dist/PKM-Nexus-Companion-${VERSION}-candidate`),
    manifest = JSON.parse(await readFile(path.join(root, 'candidate.json'), 'utf8'));
  assert.equal(manifest.format, 'pkm-nexus-transparent-runtime');
  assert.equal(manifest.runtime.signature.status, 'Valid');
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    digest(await readFile(path.join(root, 'runtime/node.exe'))),
    digest(await readFile(process.execPath)),
  );
  for (const item of manifest.files) {
    const bytes = await readFile(path.join(root, item.path));
    assert.equal(digest(bytes), item.sha256, item.path);
    assert.equal(bytes.length, item.bytes, item.path);
  }
  assert.ok(manifest.files.some((item) => item.path === 'app/companion/main.mjs'));
  assert.ok(
    !manifest.files.some((item) =>
      /Engine\.exe|Install\.exe|\.blob$|\.ps1$|\.cmd$/.test(item.path),
    ),
  );
});

test('retired versions cannot be distributed while the repaired version is allowed', async () => {
  await assertCompanionReleaseEnabled(process.cwd());
  await assert.rejects(assertCompanionReleaseEnabled(process.cwd(), '0.4.0'), /已停用/);
  assert.throws(
    () => platformCall('exec', { command: 'anything' }),
    /Unsupported Windows operation/,
  );
});

test('packaging rejects stale, incomplete and harmful scan results', async (t) => {
  const output = path.resolve('test-results');
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(path.join(output, 'scan-policy-'));
  t.after(async () => {
    if (!root.startsWith(output + path.sep)) throw new Error('Unexpected test cleanup path');
    await rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, 'candidate'),
    reports = path.join(root, 'test-results/security');
  await mkdir(directory);
  await mkdir(reports, { recursive: true });
  await writeFile(path.join(directory, 'candidate.json'), '{}');
  const report = path.join(reports, `companion-${VERSION}-scan.txt`);
  const list = path.join(reports, `companion-${VERSION}-scanned.txt`);
  await writeFile(
    report,
    `<li>${directory}</li><li class="result_clean">No harmful items found</li>`,
  );
  await writeFile(
    list,
    executableNames
      .slice(0, -1)
      .map((name) => path.join(directory, name))
      .join('\n'),
  );
  await assert.rejects(verifyCandidateScan(root, directory), /未覆盖/);
  await writeFile(list, executableNames.map((name) => path.join(directory, name)).join('\n'));
  assert.equal((await verifyCandidateScan(root, directory)).harmfulItems, 0);
  await utimes(report, new Date(0), new Date(0));
  await assert.rejects(verifyCandidateScan(root, directory), /重新扫描/);
  await writeFile(report, `<li>${directory}</li><li>Harmful items found</li>`);
  await assert.rejects(verifyCandidateScan(root, directory), /无有害项目/);
});

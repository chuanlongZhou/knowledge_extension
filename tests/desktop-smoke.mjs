import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { VERSION } from '../companion/util.mjs';
import { readZip } from '../extension/lib/zip.js';
import { createHash } from 'node:crypto';

assert.equal(process.platform, 'win32', 'Desktop smoke test requires Windows');
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(output, 'desktop-smoke-')),
  reportFile = path.join(output, 'desktop-report.json'),
  screenshot = path.join(output, `companion-desktop-${VERSION}.png`);
let processHandle;
try {
  let appDirectory = path.resolve(`dist/PKM-Nexus-Companion-${VERSION}-candidate`);
  const archiveAt = process.argv.indexOf('--archive');
  if (archiveAt >= 0) {
    const entries = await readZip(new Blob([await readFile(process.argv[archiveAt + 1])]), {
      maxEntryBytes: 128 * 1024 * 1024,
    });
    appDirectory = path.join(temporary, 'downloaded-app');
    const prefix = `PKM-Nexus-Companion-${VERSION}/`;
    for (const [name, bytes] of entries) {
      assert.ok(name.startsWith(prefix), 'Unexpected archive root');
      const relative = name.slice(prefix.length);
      assert.ok(
        relative && !relative.includes('..') && !relative.includes(':') && !relative.includes('\\'),
      );
      const file = path.resolve(appDirectory, relative);
      assert.ok(file.startsWith(appDirectory + path.sep));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    const release = JSON.parse(await readFile(path.join(appDirectory, 'RELEASE.json'), 'utf8'));
    assert.equal(release.version, VERSION);
    for (const item of release.files)
      assert.equal(
        createHash('sha256')
          .update(await readFile(path.join(appDirectory, item.path)))
          .digest('hex'),
        item.sha256,
        item.path,
      );
  }
  const application = path.join(appDirectory, 'PKM-Nexus.exe');
  await copyFile(application, path.join(temporary, 'PKM-Nexus.exe'));
  const compiler = path.join(
      process.env.WINDIR || 'C:/Windows',
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    ),
    executable = path.join(temporary, 'DesktopHarness.exe');
  const compiled = spawnSync(
    compiler,
    [
      '/nologo',
      '/target:winexe',
      '/platform:x64',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Drawing.dll',
      '/reference:System.Web.Extensions.dll',
      `/reference:${application}`,
      `/out:${executable}`,
      path.resolve('tests/desktop-harness.cs'),
    ],
    { windowsHide: true, encoding: 'utf8' },
  );
  assert.equal(compiled.status, 0, compiled.stdout || compiled.stderr);
  processHandle = spawn(executable, [appDirectory, reportFile, screenshot, application], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, PKM_NEXUS_HOME: path.join(temporary, 'home') },
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processHandle.kill();
      reject(new Error('Desktop harness timed out'));
    }, 45000);
    processHandle.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    processHandle.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  assert.equal(code, 0, JSON.stringify(report));
  assert.equal(report.status, 'passed');
  console.log(
    'PASS real WinForms window reads backend status, creates tray icon, minimizes, restores, closes to tray, reuses its instance and stops its hidden backend on exit',
  );
} finally {
  if (processHandle?.exitCode === null) processHandle.kill();
  if (!temporary.startsWith(output + path.sep))
    throw new Error('Unexpected desktop test cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

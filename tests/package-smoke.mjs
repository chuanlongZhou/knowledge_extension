import { browserOptions } from './browser-options.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readZip } from '../extension/lib/zip.js';
import { VERSION } from '../companion/util.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  output = path.join(root, 'test-results'),
  extension = path.join(root, 'dist', 'pkm-nexus');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'package-profile-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const errors = [],
    requests = [];
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2],
    page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.ok(manifest.permissions.includes('nativeMessaging'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(!manifest.permissions.includes('downloads'));
  const retiredSettings = await page.evaluate(async () => {
    await chrome.storage.local.set({
      githubConfig: { repo: 'retired' },
      githubToken: 'retired-test-value',
    });
    await chrome.storage.session.set({ githubToken: 'retired-test-value' });
    const { protectStorage } = await import('./lib/config.js');
    await protectStorage();
    return {
      local: await chrome.storage.local.get(['githubConfig', 'githubToken']),
      session: await chrome.storage.session.get('githubToken'),
    };
  });
  assert.deepEqual(retiredSettings, { local: {}, session: {} });
  await context.setOffline(true);
  await page.locator('#sync').click();
  const setup = page.getByRole('dialog', { name: '设置与数据管理', exact: true });
  await setup.waitFor();
  assert.equal(await setup.locator('[name=owner], [name=repo], [name=token]').count(), 0);
  assert.doesNotMatch(await setup.innerText(), /GitHub|私有仓库/);
  const installer = JSON.parse(
    await readFile(path.join(extension, 'installers/manifest.json'), 'utf8'),
  );
  assert.equal(installer.version, VERSION);
  const link = setup.getByRole('link', { name: '下载 Windows 本地应用', exact: true });
  let downloadEvidence;
  if (installer.blocked === true) {
    assert.equal(await link.count(), 0);
    await setup.getByText(/此预览包未附带本地程序/).waitFor();
    downloadEvidence = {
      downloadBlocked: 'passed',
      offlineDownload: 'not_run',
      archiveIntegrity: 'not_run',
    };
  } else {
    assert.equal(
      await link.getAttribute('href'),
      `chrome-extension://${id}/installers/${installer.archive}`,
    );
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    assert.equal(download.suggestedFilename(), installer.archive);
    const downloaded = path.join(profile, installer.archive);
    await download.saveAs(downloaded);
    assert.equal(await download.failure(), null);
    const bytes = await readFile(downloaded),
      hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.length, installer.sizeBytes);
    assert.equal(hash, installer.sha256);
    assert.equal(
      hash,
      createHash('sha256')
        .update(await readFile(path.join(root, 'dist', installer.archive)))
        .digest('hex'),
    );
    const contents = await readZip(new Blob([bytes]), { maxEntryBytes: 128 * 1024 * 1024 }),
      folder = `PKM-Nexus-Companion-${VERSION}/`;
    assert.ok(contents.has(folder + 'app/companion/main.mjs'));
    assert.ok(!contents.has(folder + 'PKM-Nexus-Engine.exe'));
    assert.ok(!contents.has(folder + 'Install.exe'));
    for (const name of [
      'PKM-Nexus.exe',
      'PKM-Nexus-NativeHost.exe',
      'PKM-Nexus-Platform.exe',
      'runtime/node.exe',
    ]) {
      const executable = Buffer.from(contents.get(folder + name));
      assert.equal(executable.subarray(0, 2).toString(), 'MZ');
      if (name !== 'runtime/node.exe')
        assert.equal(
          executable.readUInt16LE(executable.readUInt32LE(0x3c) + 24 + 68),
          2,
          `${name} must never allocate a console`,
        );
    }
    const desktop = spawnSync(
      process.execPath,
      ['tests/desktop-smoke.mjs', '--archive', downloaded],
      { encoding: 'utf8', windowsHide: true, timeout: 60000 },
    );
    assert.equal(desktop.status, 0, desktop.stdout + desktop.stderr);
    downloadEvidence = {
      archive: installer.archive,
      sizeBytes: bytes.length,
      sha256: hash,
      offlineDownload: 'passed',
      archiveIntegrity: 'passed',
      downloadedAppTrayAndStartup: 'passed',
    };
  }
  assert.deepEqual(await page.evaluate(() => chrome.storage.local.get('companionEnabled')), {});
  await page.setViewportSize({ width: 360, height: 950 });
  assert.equal(await setup.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  await page.screenshot({ path: path.join(output, `bundled-installer-${manifest.version}.png`) });
  await writeFile(
    path.join(output, 'bundled-installer-report.json'),
    JSON.stringify(
      {
        extensionVersion: manifest.version,
        companionVersion: VERSION,
        ...downloadEvidence,
        narrowLayout: 'passed',
        automaticInstallation: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `PASS installer settings: ${installer.blocked ? 'security hold hides download' : 'offline archive integrity verified'}; 360px layout fits without installing or enabling sync`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('#new').click();
  const modal = page.locator('dialog[open]');
  await modal.locator('[name=title]').fill('安装包验证');
  await modal.locator('[name=content]').fill('完整安装包可以独立运行，无需 npm 或本地服务。');
  await modal.getByRole('button', { name: '保存到本机', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  await page.locator('#records').filter({ hasText: '安装包验证' }).waitFor();
  const image = await page.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL('icons/icon-128.png'));
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    return { width: bitmap.width, height: bitmap.height };
  });
  assert.deepEqual(image, { width: 128, height: 128 });
  await page.locator('#settings').click();
  await page.locator('#theme').click();
  const theme = page.getByRole('dialog', { name: '主题与字体', exact: true });
  await theme.getByLabel('主题', { exact: true }).selectOption('dark');
  await theme.getByRole('button', { name: '保存主题', exact: true }).click();
  const side = await context.newPage();
  await side.setViewportSize({ width: 360, height: 950 });
  await side.goto(`chrome-extension://${id}/sidepanel.html`);
  await side.locator('#capture-form').waitFor();
  assert.equal(await side.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(
    await side
      .locator('#capture-form > .type-tabs .type-tab')
      .evaluateAll((nodes) => new Set(nodes.map((n) => n.getBoundingClientRect().y)).size),
    1,
  );
  assert.equal(errors.length, 0);
  assert.equal(requests.length, 0);
  console.log(
    'PASS built extension installs, loads all modules, writes IndexedDB, decodes PNG icon, saves theme across pages, keeps four tabs on one row, and makes no automatic cloud request',
  );
} finally {
  await context?.close();
  if (
    !path.resolve(profile).startsWith(path.resolve(output) + path.sep) ||
    !path.basename(profile).startsWith('package-profile-')
  )
    throw new Error('Unexpected profile cleanup path');
  await rm(profile, { recursive: true, force: true });
}

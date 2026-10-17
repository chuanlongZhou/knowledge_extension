import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { Settings } from '../companion/settings.mjs';
import { Vault } from '../companion/vault.mjs';
import { browserOptions } from './browser-options.mjs';
import { VERSION } from '../companion/util.mjs';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(output, 'native-browser-')),
  home = path.join(root, 'home'),
  extension = path.join(root, 'extension'),
  appDirectory = path.resolve(`dist/PKM-Nexus-Companion-${VERSION}-candidate`),
  executable = path.join(appDirectory, 'PKM-Nexus-NativeHost.exe');
const host = 'com.pkm_nexus.validation_' + crypto.randomUUID().replaceAll('-', '');
const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${host}`;
if (process.platform !== 'win32')
  throw new Error('Native companion browser test requires Windows.');
let context,
  vault,
  uiProcess,
  registered = false;
const checks = [],
  errors = [];
function pass(text) {
  checks.push(text);
  console.log('PASS ' + text);
}
try {
  // Use a test-only host name so a user's installed production host stays active.
  await cp(path.resolve('extension'), extension, { recursive: true });
  const moduleFile = path.join(extension, 'lib/companion.js');
  const source = await readFile(moduleFile, 'utf8');
  assert.ok(source.includes("'com.pkm_nexus.companion'"));
  await writeFile(moduleFile, source.replace("'com.pkm_nexus.companion'", JSON.stringify(host)));
  context = await chromium.launchPersistentContext(path.join(root, 'chrome'), {
    ...browserOptions(),
    headless: true,
    env: { ...process.env, PKM_NEXUS_HOME: home },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = worker.url().split('/')[2],
    settings = new Settings(home);
  const origins = [`chrome-extension://${extensionId}/`];
  await settings.update({ allowedOrigins: origins });
  const hostFile = path.join(home, 'native-validation.json');
  await writeFile(
    hostFile,
    JSON.stringify({
      name: host,
      description: 'Isolated PKM Nexus validation host',
      path: executable,
      type: 'stdio',
      allowed_origins: origins,
    }),
  );
  const registration = spawnSync(
    'reg.exe',
    ['ADD', key, '/ve', '/t', 'REG_SZ', '/d', hostFile, '/f'],
    { windowsHide: true, encoding: 'utf8' },
  );
  assert.equal(registration.status, 0, registration.stderr);
  registered = true;
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  assert.equal(
    await page.evaluate(() => chrome.permissions.contains({ origins: ['https://example.com/*'] })),
    false,
  );
  pass('默认扩展没有任意网站访问授权');
  const saved = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database('pkm-nexus-v1');
    const blob = new Blob([new Uint8Array(2 * 1024 * 1024).fill(37)], { type: 'image/png' });
    const descriptor = await db.storeAsset(blob, 'binary-transfer-test.png');
    const record = newRecord({
      title: '浏览器本地交接',
      content: '资料'.repeat(300000),
      attachments: [descriptor],
    });
    await db.save(record);
    await db.close();
    return { id: record.id, descriptor };
  });
  await page.locator('#settings').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: '连接并启用本地资料库', exact: true }).click();
  await dialog
    .locator('p')
    .filter({ hasText: /已连接：交接/ })
    .waitFor({ timeout: 30000 });
  pass('真实 Chrome 通过打包 EXE 交接大正文与 2 MiB 附件');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const cfg = await settings.read();
  vault = await new Vault(cfg.vaultPath).open();
  assert.equal(vault.get(saved.id).record.content.length, 600000);
  assert.equal((await vault.assetBytes(saved.descriptor)).length, 2 * 1024 * 1024);
  uiProcess = spawn(
    path.join(appDirectory, 'runtime/node.exe'),
    [path.join(appDirectory, 'app/companion/main.mjs'), '--serve'],
    {
      env: { ...process.env, PKM_NEXUS_HOME: home, PKM_NEXUS_APP_DIR: appDirectory },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  uiProcess.stderr.on('data', (chunk) => (stderr += chunk.toString()));
  const uiUrl = await new Promise((resolve, reject) => {
    let text = '';
    const timeout = setTimeout(
      () => reject(new Error('Companion UI startup timed out: ' + stderr)),
      15000,
    );
    uiProcess.stdout.on('data', (chunk) => {
      text += chunk.toString();
      for (const line of text.split('\n'))
        if (line.startsWith('{')) {
          clearTimeout(timeout);
          resolve(JSON.parse(line).url);
          return;
        }
    });
    uiProcess.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Companion exited ${code}: ${stderr}`));
    });
  });
  const ui = await context.newPage();
  ui.on('pageerror', (error) => errors.push(error.message));
  await ui.goto(uiUrl);
  await ui.getByRole('button', { name: '打开 浏览器本地交接', exact: true }).waitFor();
  await ui.screenshot({ path: path.join(output, 'companion-dashboard.png'), fullPage: true });
  pass('打包应用的管理界面能分页展示浏览器交接的数据');
  await ui.getByRole('button', { name: '打开 浏览器本地交接', exact: true }).click();
  await ui.locator('#content').fill('由本地程序整理后的内容');
  await ui.getByRole('button', { name: '保存修改', exact: true }).click();
  await ui.locator('#editor').waitFor({ state: 'hidden' });
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(
    async (id) => {
      const { Database } = await import('./lib/db.js');
      const db = new Database('pkm-nexus-v1', { broadcast: false });
      const row = await db.get(id);
      await db.close();
      return row.record.content === '由本地程序整理后的内容';
    },
    saved.id,
    { timeout: 30000 },
  );
  pass('本地管理界面修改能回到扩展，保留原始 ID');
  const downloaded = await page.evaluate(async (descriptor) => {
    const { Database } = await import('./lib/db.js');
    const { loadAsset } = await import('./lib/assets.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const raw = await db.open();
    await new Promise((resolve, reject) => {
      const tx = raw.transaction('assets', 'readwrite');
      tx.objectStore('assets').clear();
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    const blob = await loadAsset(db, descriptor);
    await db.close();
    return { size: blob.size, first: new Uint8Array(await blob.arrayBuffer())[0] };
  }, saved.descriptor);
  assert.deepEqual(downloaded, { size: 2 * 1024 * 1024, first: 37 });
  pass('超过单消息上限的附件通过真实 Native Messaging 分块返回');
  await ui.locator('#settings').click();
  const appClient = JSON.parse(
    await readFile(path.join(appDirectory, 'app/companion/google-oauth.json'), 'utf8'),
  );
  await ui
    .locator('#google-status')
    .filter({ hasText: appClient ? '应用已配置 Google 登录' : '此开发包尚未配置 Google 登录' })
    .waitFor();
  assert.equal(await ui.locator('#connect-google').isEnabled(), !!appClient);
  if (!appClient)
    assert.equal(await ui.locator('#google-app-setup').evaluate((node) => node.open), true);
  assert.equal(await ui.locator('#auto-sync').isChecked(), false);
  await ui.screenshot({ path: path.join(output, 'companion-settings.png'), fullPage: true });
  pass(
    appClient
      ? '内置应用 OAuth 后直接提供个人账号登录，自动同步默认关闭'
      : '未配置 OAuth 时明确显示设置步骤，自动同步默认关闭',
  );
  const allowedOrigins = (await settings.read()).allowedOrigins;
  await settings.update({ allowedOrigins: [] });
  const queuedId = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database('pkm-nexus-v1');
    const note = newRecord({ title: '后台恢复', content: '页面关闭后仍能交接' });
    await db.save(note);
    await db.close();
    return note.id;
  });
  await page.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const error = await db.getState('companion:error');
    await db.close();
    return !!error?.message;
  });
  await page
    .locator('#sync-status')
    .getByText(/本地交接失败/)
    .waitFor();
  await page.close();
  await settings.update({ allowedOrigins });
  await worker.evaluate(() =>
    chrome.alarms.create('pkm-local-handoff', { when: Date.now() + 1000 }),
  );
  const deadline = Date.now() + 15000;
  while (!vault.get(queuedId) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(vault.get(queuedId)?.record.content, '页面关闭后仍能交接');
  pass('真实后台 alarm 在连接恢复后交接待保存内容，不依赖扩展页面保持打开');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'companion-browser-report.json'),
    JSON.stringify({ checks }, null, 2),
  );
} finally {
  await context?.close();
  if (uiProcess && !uiProcess.killed) {
    const exited = new Promise((resolve) => uiProcess.once('exit', resolve));
    uiProcess.kill();
    await exited;
  }
  vault?.close();
  if (registered) spawnSync('reg.exe', ['DELETE', key, '/f'], { windowsHide: true });
  if (!root.startsWith(output + path.sep) || !path.basename(root).startsWith('native-browser-'))
    throw new Error('Unexpected test cleanup');
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

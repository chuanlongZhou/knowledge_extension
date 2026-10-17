import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
import { MockDirectDrive } from './mock-direct-drive.js';
import { readZip } from '../extension/lib/zip.js';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(output, 'direct-browser-'));
const server = new MockDirectDrive(),
  checks = [],
  errors = [],
  contexts = [];
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
const http = createServer(async (req, res) => {
  try {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    const body = new Blob(parts),
      type = req.headers['content-type'] || '';
    const result = await server.fetch(`https://www.googleapis.com${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(parts.length
        ? {
            body:
              type.startsWith('application/json') && !req.url.startsWith('/upload/')
                ? await body.text()
                : body,
          }
        : {}),
    });
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(new Uint8Array(await result.arrayBuffer()));
  } catch (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${http.address().port}`;
try {
  const extension = path.join(temporary, 'extension');
  await cp(path.resolve('dist/pkm-nexus'), extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.ok(!manifest.permissions.includes('nativeMessaging'));
  assert.ok(!manifest.permissions.includes('alarms'));
  assert.ok(manifest.key, 'Cross-device builds must contain the stable extension public key');
  const expectedId = [
    ...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32),
  ]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join('');
  manifest.oauth2 = {
    client_id: 'fixture.apps.googleusercontent.com',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  };
  manifest.host_permissions.push('http://127.0.0.1/*');
  await writeFile(manifestPath, JSON.stringify(manifest));
  async function device(name) {
    const deviceExtension = path.join(temporary, `${name}-extension`);
    await cp(extension, deviceExtension, { recursive: true });
    const context = await chromium.launchPersistentContext(path.join(temporary, name), {
      ...browserOptions(),
      headless: true,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1060 },
      args: [
        `--disable-extensions-except=${deviceExtension}`,
        `--load-extension=${deviceExtension}`,
      ],
    });
    contexts.push(context);
    context.setDefaultTimeout(15000);
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    assert.equal(worker.url().split('/')[2], expectedId);
    await worker.evaluate((origin) => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (url, options) =>
        originalFetch(String(url).replace('https://www.googleapis.com', origin), options);
      globalThis.testAccount = 'alice';
      chrome.identity.getAuthToken = async () => ({ token: globalThis.testAccount });
      chrome.identity.clearAllCachedAuthTokens = async () => {};
      chrome.identity.removeCachedAuthToken = async () => {};
    }, origin);
    const base = `chrome-extension://${worker.url().split('/')[2]}/`,
      page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + 'dashboard.html#settings');
    const settings = page.getByRole('dialog', { name: '设置与数据管理', exact: true });
    await settings.waitFor();
    return { page, worker, base, settings };
  }
  const a = await device('a');
  assert.equal(server.calls.length, 0);
  assert.doesNotMatch(
    await a.settings.innerText(),
    /本地资料库|本地应用|本地连接|扩展 ID|Windows|Companion/,
  );
  assert.equal(await a.page.getByRole('button', { name: '↓ 同步下载', exact: true }).count(), 1);
  await a.settings.getByRole('button', { name: '登录 Google Drive', exact: true }).click();
  await a.settings.getByLabel('新文件夹名称', { exact: true }).fill('简化版个人笔记');
  await a.settings.getByRole('button', { name: '新建并使用文件夹', exact: true }).click();
  await a.settings.getByRole('link', { name: '打开 简化版个人笔记', exact: true }).waitFor();
  pass('界面仅提供 Google 登录、文件夹选择、上传下载和备份，无旧版安装或交接入口');
  const id = await a.page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const record = newRecord({ title: '直接同步的笔记', content: '设备 A 的正文', tags: ['阅读'] });
    await db.save(record);
    await db.close();
    return record.id;
  });
  const beforeSave = server.calls.filter((c) => c.method !== 'GET').length;
  await a.settings.getByRole('button', { name: '↑ 同步上传', exact: true }).click();
  await a.settings.getByRole('status').filter({ hasText: '上传 1 条记录' }).waitFor();
  assert.ok(server.calls.filter((c) => c.method !== 'GET').length > beforeSave);
  const b = await device('b');
  assert.equal(a.base, b.base, 'Different install directories must retain the same extension ID');
  await b.settings.getByRole('button', { name: '登录 Google Drive', exact: true }).click();
  await b.settings.getByRole('button', { name: '选择已有文件夹', exact: true }).click();
  await b.settings
    .getByLabel('已有数据文件夹', { exact: true })
    .selectOption({ label: '简化版个人笔记' });
  await b.settings.getByRole('button', { name: '使用所选文件夹', exact: true }).click();
  await b.settings.getByRole('link', { name: '打开 简化版个人笔记', exact: true }).waitFor();
  const beforeDownload = server.calls.length;
  await b.settings.getByRole('button', { name: '↓ 同步下载', exact: true }).click();
  await b.settings.getByRole('status').filter({ hasText: '下载 1 条记录' }).waitFor();
  assert.ok(server.calls.slice(beforeDownload).every((c) => c.method === 'GET'));
  await b.settings.getByRole('button', { name: '关闭', exact: true }).click();
  await a.settings.getByRole('button', { name: '关闭', exact: true }).click();
  await b.page.locator('#records article').filter({ hasText: '直接同步的笔记' }).waitFor();
  pass(
    '两台隔离浏览器通过正式 Drive 客户端和 HTTP 模拟服务完成创建文件夹、上传、旧用户选文件夹与下载',
  );
  for (const [device, content] of [
    [a, 'A 的新修改'],
    [b, 'B 的新修改'],
  ])
    await device.page.evaluate(
      async ({ id, content }) => {
        const { Database } = await import('./lib/db.js');
        const db = new Database();
        await db.mutate(id, (record) => ({ ...record, content }));
        await db.close();
      },
      { id, content },
    );
  await a.page.locator('#sync').click();
  await a.page.locator('#toast').filter({ hasText: '上传完成' }).waitFor();
  await b.page.locator('#sync').click();
  await b.page.getByRole('button', { name: '处理冲突', exact: true }).waitFor();
  await b.page.getByRole('button', { name: '处理冲突', exact: true }).click();
  const conflict = b.page.getByRole('dialog', { name: '选择要保留的记录版本', exact: true });
  assert.match(await conflict.innerText(), /B 的新修改/);
  assert.match(await conflict.innerText(), /A 的新修改/);
  await conflict.getByRole('button', { name: '使用此云端版本', exact: true }).click();
  await b.page.locator('#toast').filter({ hasText: '下载完成' }).waitFor();
  await b.page.locator('#records article').filter({ hasText: 'A 的新修改' }).waitFor();
  assert.equal(await b.page.getByRole('button', { name: '处理冲突', exact: true }).count(), 0);
  pass('真实界面显示双方冲突内容，选择云端版本后只下载，不自动上传');
  const downloadEvent = b.page.waitForEvent('download');
  await b.page.locator('#save-local').click();
  const download = await downloadEvent,
    backupPath = path.join(output, 'direct-drive-browser-backup.zip');
  await download.saveAs(backupPath);
  const zip = await readZip(new Blob([await readFile(backupPath)]));
  const backup = JSON.parse(new TextDecoder().decode(zip.get('backup.json')));
  assert.equal(backup.records[0].record.content, 'A 的新修改');
  assert.doesNotMatch(
    new TextDecoder().decode(zip.get('backup.json')),
    /access_token|refresh_token|driveAccount|drive:binding/,
  );
  await b.page.screenshot({ path: path.join(output, 'direct-drive-dashboard.png') });
  await b.page.locator('#settings').click();
  await b.settings.waitFor();
  await b.page.screenshot({ path: path.join(output, 'direct-drive-settings.png') });
  await b.settings.getByRole('button', { name: '退出 Google 登录', exact: true }).click();
  await b.settings.getByRole('button', { name: '登录 Google Drive', exact: true }).waitFor();
  assert.equal(
    await b.page.evaluate(async (id) => {
      const { Database } = await import('./lib/db.js');
      const db = new Database();
      const row = await db.get(id);
      await db.close();
      return row.record.content;
    }, id),
    'A 的新修改',
  );
  await b.page.screenshot({ path: path.join(output, 'direct-drive-login.png') });
  pass('完整 ZIP 可导出且不含凭证，退出 Google 登录保留浏览器记录');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'direct-drive-browser-report.json'),
    JSON.stringify(
      { checks, errors, realGoogleOAuth: 'not-tested', transport: 'mock-google-http' },
      null,
      2,
    ),
  );
} catch (error) {
  for (const [i, context] of contexts.entries())
    for (const [j, page] of context.pages().entries())
      await page
        .screenshot({ path: path.join(output, `direct-failure-${i}-${j}.png`) })
        .catch(() => {});
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await new Promise((resolve) => http.close(resolve));
  if (
    !temporary.startsWith(output + path.sep) ||
    !path.basename(temporary).startsWith('direct-browser-')
  )
    throw new Error('Unexpected fixture path');
  await rm(temporary, { recursive: true, force: true });
}

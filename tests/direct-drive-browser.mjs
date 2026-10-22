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
let nextError;
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
const http = createServer(async (req, res) => {
  try {
    if (nextError) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: nextError }));
      nextError = null;
      return;
    }
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
  const backgroundPath = path.join(extension, 'background.js');
  await writeFile(
    backgroundPath,
    (await readFile(backgroundPath, 'utf8')) +
      `\nimport { GoogleDrive as NativeFetchProbe } from './lib/drive-client.js';
globalThis.verifyNativeDriveFetch = async () => {
  const drive = new NativeFetchProbe();
  const response = await drive.fetch(chrome.runtime.getURL('manifest.json'));
  return (await response.json()).version;
};\n`,
  );
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
    // Exercise the native Worker fetch before replacing it with the HTTP fixture transport.
    // An arrow-function mock otherwise hides an invalid receiver on the stored fetch method.
    const nativeFetchVersion = await worker.evaluate(() => globalThis.verifyNativeDriveFetch());
    assert.equal(nativeFetchVersion, manifest.version);
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
  nextError = {
    errors: [{ reason: 'accessNotConfigured' }],
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'SERVICE_DISABLED',
        metadata: { consumer: 'projects/464495637351', service: 'drive.googleapis.com' },
      },
    ],
  };
  await a.settings.getByRole('button', { name: '登录 Google Drive', exact: true }).click();
  await a.settings
    .getByRole('status')
    .filter({ hasText: /API 尚未启用.*464495637351.*SERVICE_DISABLED/ })
    .waitFor();
  assert.equal(server.calls.length, 0, 'A disabled API must not trigger repeated requests');
  await a.page.screenshot({ path: path.join(output, 'direct-drive-api-disabled.png') });
  pass('后台 Google 403 的具体原因、项目编号与启用指引传到设置界面，修正后可再次登录');
  await a.settings.getByRole('button', { name: '登录 Google Drive', exact: true }).click();
  await a.settings.getByLabel('新文件夹名称', { exact: true }).fill('简化版个人笔记');
  await a.settings.getByRole('button', { name: '新建并使用文件夹', exact: true }).click();
  await a.settings.getByRole('link', { name: '打开 Google Drive 目录', exact: true }).waitFor();
  assert.match(
    await a.settings
      .getByRole('link', { name: '打开 Google Drive 目录', exact: true })
      .getAttribute('href'),
    /^https:\/\/drive\.google\.com\/drive\/folders\/file_/,
  );
  pass('界面仅提供 Google 登录、文件夹选择、上传下载和备份，无旧版安装或交接入口');
  const id = await a.page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const image = await db.storeAsset(
      await (await fetch('./icons/icon-128.png')).blob(),
      '同步图片.png',
    );
    const record = newRecord({
      title: '直接同步的笔记',
      content: `设备 A 的正文\n\n![同步图片](${image.path})`,
      tags: ['阅读'],
      attachments: [image],
    });
    await db.save(record);
    await db.renameTag('空标签', '空标签', '#3e6868', '跨设备同步的标签描述');
    await db.close();
    return record.id;
  });
  const beforeSave = server.calls.filter((c) => c.method !== 'GET').length;
  await a.settings.getByRole('button', { name: '↑ 同步上传', exact: true }).click();
  await a.settings.getByRole('status').filter({ hasText: '上传 1 条记录' }).waitFor();
  assert.ok(server.calls.filter((c) => c.method !== 'GET').length > beforeSave);
  const b = await device('b');
  assert.equal(a.base, b.base, 'Different install directories must retain the same extension ID');
  pass('两个真实后台 Worker 的原生 fetch 调用正常，模拟传输不会再掩盖 Illegal invocation');
  await b.settings.getByRole('button', { name: '登录 Google Drive', exact: true }).click();
  await b.settings.getByRole('button', { name: '选择已有文件夹', exact: true }).click();
  await b.settings
    .getByLabel('已有数据文件夹', { exact: true })
    .selectOption({ label: '简化版个人笔记' });
  await b.settings.getByRole('button', { name: '使用所选文件夹', exact: true }).click();
  await b.settings.getByRole('link', { name: '打开 Google Drive 目录', exact: true }).waitFor();
  const beforeDownload = server.calls.length;
  await b.settings.getByRole('button', { name: '↓ 同步下载', exact: true }).click();
  await b.settings.getByRole('status').filter({ hasText: '下载 1 条记录' }).waitFor();
  assert.ok(server.calls.slice(beforeDownload).every((c) => c.method === 'GET'));
  const rootFolder = [...server.items.values()].find(
    (file) => file.appProperties?.pkm_format === 'direct-v1',
  );
  const dataFiles = [...server.items.values()].filter((file) =>
    ['record', 'asset', 'tag_library'].includes(file.appProperties?.pkm_role),
  );
  for (const file of dataFiles) {
    file.parents = [rootFolder.id];
    file.revision++;
  }
  const previewStart = server.calls.length;
  await b.settings.getByRole('button', { name: '整理云端目录', exact: true }).click();
  await b.settings
    .locator('.drive-layout-preview')
    .filter({ hasText: '将整理 3 个文件' })
    .waitFor();
  assert.ok(server.calls.slice(previewStart).every((call) => call.method === 'GET'));
  await b.settings.getByRole('button', { name: '开始整理', exact: true }).click();
  await b.settings.getByRole('status').filter({ hasText: '已整理 3 个文件' }).waitFor();
  assert.ok(dataFiles.every((file) => !file.parents.includes(rootFolder.id)));
  await b.settings.getByRole('button', { name: '↓ 同步下载', exact: true }).click();
  await b.settings.getByRole('status').filter({ hasText: '下载 0 条记录' }).waitFor();
  const cachedStart = server.calls.length;
  await b.settings.getByRole('button', { name: '↓ 同步下载', exact: true }).click();
  await b.settings.getByRole('status').filter({ hasText: '复用 2 个未变化文件' }).waitFor();
  assert.equal(
    server.calls.slice(cachedStart).filter((call) => call.query.includes('alt=media')).length,
    0,
  );
  pass('云端目录先预览再移动，旧平铺文件可继续读取；重复下载复用缓存，不再请求未变 JSON 的内容');
  await a.page.evaluate(() =>
    chrome.storage.local.set({
      startPage: {
        favoritesLimit: 8,
        shortcuts: [{ id: 'legacy-site', name: '原有入口', url: 'https://example.com/old' }],
      },
    }),
  );
  const startA = await a.page.context().newPage();
  await startA.goto(a.base + 'start.html');
  await startA.locator('#site-dock').getByRole('link', { name: '原有入口' }).waitFor();
  await startA.getByRole('button', { name: '添加常用网站', exact: true }).click();
  let dockDialog = startA.getByRole('dialog', { name: '添加常用网站', exact: true });
  await dockDialog.getByLabel('网站名称', { exact: true }).fill('同步文档');
  await dockDialog.getByLabel('网站地址', { exact: true }).fill('https://example.com/docs');
  await dockDialog.getByRole('button', { name: '保存网站', exact: true }).click();
  await startA.locator('#site-dock').getByRole('link', { name: '同步文档' }).waitFor();
  await a.page.locator('#sync-status').filter({ hasText: '常用网站待上传' }).waitFor();
  await a.settings.getByRole('button', { name: '↑ 同步上传', exact: true }).click();
  await a.settings.getByRole('status').filter({ hasText: '已同步常用网站' }).waitFor();
  const shortcutFile = [...server.items.values()].find(
    (file) => file.appProperties?.pkm_role === 'shortcut_library',
  );
  assert.equal(shortcutFile.name, 'shortcuts.json');
  const startB = await b.page.context().newPage();
  await startB.goto(b.base + 'start.html');
  assert.equal(await startB.locator('#site-dock .dock-link').count(), 0);
  await b.settings.getByRole('button', { name: '↓ 同步下载', exact: true }).click();
  await b.settings.getByRole('status').filter({ hasText: '已同步常用网站' }).waitFor();
  await startB.locator('#site-dock').getByRole('link', { name: '同步文档' }).waitFor();
  await startB.locator('#site-dock').getByRole('link', { name: '原有入口' }).waitFor();
  await startB.getByRole('button', { name: '管理常用网站', exact: true }).click();
  dockDialog = startB.getByRole('dialog', { name: '管理常用网站', exact: true });
  await dockDialog
    .locator('.dock-edit-row')
    .filter({ hasText: '同步文档' })
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  const siteEditor = startB.getByRole('dialog', { name: '编辑常用网站', exact: true });
  await siteEditor.getByLabel('网站名称', { exact: true }).fill('第二设备文档');
  await siteEditor.getByRole('button', { name: '保存网站', exact: true }).click();
  await startB.locator('#site-dock').getByRole('link', { name: '第二设备文档' }).waitFor();
  await b.settings.getByRole('button', { name: '↑ 同步上传', exact: true }).click();
  await b.settings.getByRole('status').filter({ hasText: '已同步常用网站' }).waitFor();
  await a.settings.getByRole('button', { name: '↓ 同步下载', exact: true }).click();
  await a.settings.getByRole('status').filter({ hasText: '已同步常用网站' }).waitFor();
  await startA.locator('#site-dock').getByRole('link', { name: '第二设备文档' }).waitFor();
  pass('旧版 Dock 自动迁移；网站通过正式后台手动上传和下载，另一设备修改后可同步返回');
  await startA.close();
  await startB.close();
  await b.settings.getByRole('button', { name: '关闭', exact: true }).click();
  await a.settings.getByRole('button', { name: '关闭', exact: true }).click();
  await b.page.locator('#tags-nav [data-tag="空标签"]').waitFor();
  assert.equal(
    await b.page.locator('#tags-nav [data-tag="空标签"]').getAttribute('title'),
    '跨设备同步的标签描述',
  );
  await b.page.locator('#tags-nav [data-tag="空标签"]').click({ button: 'right' });
  const tagDialog = b.page.getByRole('dialog', { name: '标签外观', exact: true });
  assert.equal(
    await tagDialog.getByLabel('标签描述', { exact: true }).inputValue(),
    '跨设备同步的标签描述',
  );
  await tagDialog.getByLabel('标签描述', { exact: true }).fill('在界面更新的标签描述');
  await tagDialog.getByRole('button', { name: '保存外观', exact: true }).click();
  await b.page.locator('#tags-nav [data-tag="空标签"][title="在界面更新的标签描述"]').waitFor();
  await b.page.locator('#sync-status').filter({ hasText: '标签待上传' }).waitFor();
  await b.page.locator('#sync').click();
  await b.page.locator('#toast').filter({ hasText: '已同步标签定义' }).waitFor();
  await a.page.locator('#sync-download').click();
  await a.page.locator('#tags-nav [data-tag="空标签"][title="在界面更新的标签描述"]').waitFor();
  pass('空标签的颜色和描述跨设备同步；界面修改后提示待上传，上传与下载保持单向');
  await b.page.locator('#records article').filter({ hasText: '直接同步的笔记' }).waitFor();
  await b.page.locator(`#records [data-record-id="${id}"] .record-top h2`).click();
  const imagePreview = b.page.getByRole('dialog', { name: '预览记录', exact: true });
  const downloadedImage = imagePreview.getByRole('img', { name: '同步图片', exact: true });
  await downloadedImage.evaluate((image) => image.decode());
  assert.equal(await downloadedImage.evaluate((image) => image.naturalWidth), 128);
  await imagePreview.getByRole('button', { name: '关闭', exact: true }).click();
  pass('第二设备同步下载的图片原文件完整，普通预览自动显示，无需手动加载');
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
  for (const [device, description] of [
    [a, '标签描述 A'],
    [b, '标签描述 B'],
  ])
    await device.page.evaluate(async (description) => {
      const { Database } = await import('./lib/db.js');
      const db = new Database();
      await db.renameTag('空标签', '空标签', '#3e6868', description);
      await db.close();
    }, description);
  await a.page.locator('#sync').click();
  await a.page.locator('#toast').filter({ hasText: '已同步标签定义' }).waitFor();
  await b.page.locator('#sync').click();
  await b.page.getByRole('button', { name: '处理冲突', exact: true }).click();
  const tagConflict = b.page.getByRole('dialog', { name: '选择要保留的记录版本', exact: true });
  assert.match(await tagConflict.innerText(), /标签描述 A/);
  assert.match(await tagConflict.innerText(), /标签描述 B/);
  await tagConflict.getByRole('button', { name: '保留浏览器版本', exact: true }).click();
  await b.page.locator('#toast').filter({ hasText: '已保留浏览器版本' }).waitFor();
  await b.page.locator('#sync').click();
  await b.page.locator('#toast').filter({ hasText: '已同步标签定义' }).waitFor();
  pass('标签定义同时修改时在界面保留双方版本，选择浏览器版本后可手动上传');
  const downloadEvent = b.page.waitForEvent('download');
  await b.page.locator('#save-local').click();
  await b.page
    .getByRole('dialog', { name: '选择导出整理方式', exact: true })
    .getByRole('button', { name: '开始导出', exact: true })
    .click();
  const download = await downloadEvent,
    backupPath = path.join(output, 'direct-drive-browser-backup.zip');
  await download.saveAs(backupPath);
  const zip = await readZip(new Blob([await readFile(backupPath)]));
  const backup = JSON.parse(new TextDecoder().decode(zip.get('backup.json')));
  assert.equal(backup.records[0].record.content, 'A 的新修改');
  assert.equal(backup.tag_library.definitions[0].description, '标签描述 B');
  assert.ok(backup.shortcut_library.shortcuts.some((site) => site.name === '第二设备文档'));
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

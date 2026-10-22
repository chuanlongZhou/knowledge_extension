import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
import { MockDirectDrive } from './mock-direct-drive.js';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(output, 'attachments-browser-'));
const server = new MockDirectDrive(),
  errors = [],
  checks = [];
let failUpload = false,
  blockedUpload,
  context,
  page;
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
const http = createServer(async (req, res) => {
  try {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    if (blockedUpload && req.url.includes('upload_id=')) await blockedUpload;
    if (failUpload && req.url.includes('upload_id=')) {
      failUpload = false;
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }));
      return;
    }
    const body = new Blob(parts);
    const result = await server.fetch(`https://www.googleapis.com${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(parts.length
        ? {
            body:
              req.method === 'POST' && req.headers['content-type']?.startsWith('application/json')
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
const patch = (origin) => {
  if (!globalThis.chrome?.identity) return;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (url, options) =>
    original(String(url).replace('https://www.googleapis.com', origin), options);
  chrome.identity.getAuthToken = async () => ({ token: 'alice' });
  chrome.identity.removeCachedAuthToken = async () => {};
};
try {
  const extension = path.join(temporary, 'extension');
  await cp(path.resolve('extension'), extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1440, height: 1050 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
  await context.addInitScript(patch, origin);
  await context.route('https://drive.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Drive preview fixture</h1>' }),
  );
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  await worker.evaluate(patch, origin);
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  page = await context.newPage();
  await page.goto(base + 'dashboard.html');
  const listId = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const { GoogleDrive } = await import('./lib/drive-client.js');
    const { bindFolder } = await import('./lib/drive-sync.js');
    const { EXAMPLES_VISIBLE } = await import('./lib/examples.js');
    const db = new Database();
    const drive = new GoogleDrive();
    const account = await drive.authorize();
    const folder = await drive.createFolder('Attachment fixture');
    await bindFolder(db, account, folder);
    await chrome.storage.local.set({ driveAccount: account });
    await db.setState(EXAMPLES_VISIBLE, false);
    const list = newRecord({
      type: 'list',
      list: [
        { id: 'todo-file', kind: 'item', text: '带文件的待办', is_checkbox: true, checked: false },
        { id: 'idea-file', kind: 'item', text: '带文件的想法', is_checkbox: false, checked: false },
      ],
    });
    await db.save(list);
    await db.close();
    return list.id;
  });
  await page.reload();
  await page.locator('#new').click();
  const editor = page.locator('#editor-form');
  await editor.locator('[name=title]').fill('多个文件的普通记录');
  await editor.locator('[name=content]').fill('文件只在 Google Drive 中预览。');
  await editor.locator('[data-attachment-file=record]').setInputFiles([
    { name: '设计说明.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf fixture') },
    {
      name: '预算.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('xlsx fixture'),
    },
  ]);
  await editor.locator('.drive-attachment').filter({ hasText: '预算.xlsx' }).waitFor();
  assert.equal(await editor.locator('[data-attachment-file=record]').inputValue(), '');
  assert.equal(await editor.locator('img[src^="blob:"], audio, iframe').count(), 0);
  await page.screenshot({ path: path.join(output, 'attachments-note.png') });
  let releaseUpload;
  blockedUpload = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  await editor.locator('[data-attachment-file=record]').setInputFiles({
    name: '保存时仍在上传.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('pending upload'),
  });
  await editor.locator('button[type=submit]').click();
  assert.equal(await editor.isVisible(), true, 'Saving must wait for a pending file upload');
  assert.equal(await editor.locator('button[type=submit]').isDisabled(), true);
  blockedUpload = null;
  releaseUpload();
  await editor.waitFor({ state: 'detached' });
  await page.getByText('记录与附件关联已同步到 Google Drive。', { exact: true }).waitFor();
  const noteFile = [...server.items.values()].find(
    (f) => f.appProperties?.pkm_role === 'record' && f.appProperties.record_id !== listId,
  );
  const note = JSON.parse(new TextDecoder().decode(noteFile.bytes)).record;
  assert.equal(note.attachments.length, 3);
  pass('普通记录选择多个文件立即上传，保存后自动同步记录，输入框释放 FileList');

  await page.goto(base + 'dashboard.html?new=list');
  const todo = editor.locator('[data-list-item-id=todo-file]');
  await todo.locator('[data-attachment-file=todo-file]').setInputFiles([
    { name: '待办附件.pdf', mimeType: 'application/pdf', buffer: Buffer.from('todo') },
    { name: '待办附件.zip', mimeType: 'application/zip', buffer: Buffer.from('todo zip') },
  ]);
  await todo.locator('.drive-attachment').filter({ hasText: '待办附件.zip' }).waitFor();
  await todo.locator('input[type=text]').fill('已修改的待办');
  await todo.locator('input[type=checkbox]').check();
  await editor.getByRole('tab', { name: 'Idea', exact: true }).click();
  const idea = editor.locator('[data-list-item-id=idea-file]');
  await idea
    .locator('[data-attachment-file=idea-file]')
    .setInputFiles({ name: '想法.txt', mimeType: 'text/plain', buffer: Buffer.from('idea') });
  await idea.locator('.drive-attachment').filter({ hasText: '想法.txt' }).waitFor();
  await page.screenshot({ path: path.join(output, 'attachments-idea.png') });
  await editor.locator('button[type=submit]').click();
  await editor.waitFor({ state: 'detached' });
  const listFile = [...server.items.values()].find(
    (f) => f.appProperties?.pkm_role === 'record' && f.appProperties.record_id === listId,
  );
  let list = JSON.parse(new TextDecoder().decode(listFile.bytes)).record;
  assert.deepEqual(
    list.attachments.map((a) => a.item_id),
    ['todo-file', 'todo-file', 'idea-file'],
  );
  assert.equal(list.list.find((i) => i.id === 'todo-file').text, '已修改的待办');
  assert.equal(list.list.find((i) => i.id === 'todo-file').checked, true);
  pass('Todo 与 Idea 附件按固定条目 ID 区分，修改文字与勾选后关联保持');

  await page.goto(base + 'start.html');
  await page.locator('#todo-items .start-file-link').filter({ hasText: '待办附件.pdf' }).waitFor();
  await page.locator('#idea-items .start-file-link').filter({ hasText: '想法.txt' }).waitFor();
  const popup = page.waitForEvent('popup');
  await page.locator('#todo-items .start-file-link').filter({ hasText: '待办附件.pdf' }).click();
  const preview = await popup;
  assert.match(preview.url(), /^https:\/\/drive.google.com\/file\/d\/file_\d+\/view$/);
  await preview.close();
  await page.locator('#todo-items .start-task-files').click();
  const dialog = page.getByRole('dialog', { name: '文件附件', exact: true });
  await dialog
    .locator('[data-attachment-file=todo-file]')
    .setInputFiles({ name: '启动页附件.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y') });
  await dialog.locator('.drive-attachment').filter({ hasText: '启动页附件.csv' }).waitFor();
  await page.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const row = await db.get('nexus-list');
    await db.close();
    return row.record.attachments.some((a) => a.name === '启动页附件.csv') && !row.dirty;
  });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'attachments-start.png') });
  pass('启动页每条 Todo / Idea 可添加与查看文件，点击预览只打开 Drive 链接');

  await page.locator('#todo-items .start-task-files').click();
  failUpload = true;
  await dialog.locator('[data-attachment-file=todo-file]').setInputFiles({
    name: '失败.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('failed'),
  });
  await dialog
    .getByRole('status')
    .filter({ hasText: /上传失败.*存储空间/ })
    .waitFor();
  await dialog
    .locator('[data-attachment-file=todo-file]')
    .setInputFiles({ name: '重试.pdf', mimeType: 'application/pdf', buffer: Buffer.from('retry') });
  await dialog.locator('.drive-attachment').filter({ hasText: '重试.pdf' }).waitFor();
  await page.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const row = await db.get('nexus-list');
    await db.close();
    return row.record.attachments.some((a) => a.name === '重试.pdf') && !row.dirty;
  });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const otherPage = await context.newPage();
  await otherPage.goto(base + 'start.html');
  await otherPage.locator('#todo-items .start-task-files').click();
  const otherDialog = otherPage.getByRole('dialog', { name: '文件附件', exact: true });
  await page.locator('#todo-items .start-task-files').click();
  await dialog.locator('[data-attachment-file=todo-file]').setInputFiles({
    name: '窗口A.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('window a'),
  });
  await page.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const row = await db.get('nexus-list');
    await db.close();
    return row.record.attachments.some((a) => a.name === '窗口A.txt') && !row.dirty;
  });
  await otherDialog.locator('[data-attachment-file=todo-file]').setInputFiles({
    name: '窗口B.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('window b'),
  });
  await otherPage.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const row = await db.get('nexus-list');
    await db.close();
    return (
      ['窗口A.txt', '窗口B.txt'].every((name) =>
        row.record.attachments.some((a) => a.name === name),
      ) && !row.dirty
    );
  });
  await otherDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await otherPage.close();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  pass('两个窗口从旧视图给同一条目追加文件，不覆盖另一窗口的新附件');
  await page.locator('#todo-items .start-task-files').click();
  const removedFile = [...server.items.values()].find((file) => file.name === '启动页附件.csv');
  await dialog
    .locator('.file-attachment-row')
    .filter({ hasText: '启动页附件.csv' })
    .getByRole('button', { name: '移除附件', exact: true })
    .click();
  await page.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const row = await db.get('nexus-list');
    await db.close();
    return !row.record.attachments.some((a) => a.name === '启动页附件.csv') && !row.dirty;
  });
  assert.ok(server.items.has(removedFile.id), 'Unlink must preserve original file');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  pass('移除单个文件自动同步关联并保留 Drive 原文件');
  await page.setViewportSize({ width: 420, height: 900 });
  await page.screenshot({ path: path.join(output, 'attachments-start-narrow.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  pass('上传失败给出错误并可重新选择重试，窄屏无横向溢出');
  const assets = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const values = await db.allAssets();
    await db.close();
    return values;
  });
  assert.deepEqual(assets, []);
  for (const call of server.calls.filter((c) => c.query.includes('alt=media')))
    assert.notEqual(
      server.items.get(call.path.split('/').pop()).appProperties.pkm_role,
      'attachment',
    );
  list = JSON.parse(new TextDecoder().decode(listFile.bytes)).record;
  assert.equal(
    list.attachments.some((a) => a.name === '失败.pdf'),
    false,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'attachments-browser-report.json'),
    JSON.stringify(
      { checks, errors, realGoogleOAuth: 'not-tested', transport: 'mock-google-http' },
      null,
      2,
    ),
  );
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'attachments-failure.png') }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => http.close(resolve));
  if (
    !temporary.startsWith(output + path.sep) ||
    !path.basename(temporary).startsWith('attachments-browser-')
  )
    throw new Error('Unexpected fixture path');
  await rm(temporary, { recursive: true, force: true });
}

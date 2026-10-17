import { browserOptions, authorizedExtension } from './browser-options.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSyncHarness, enableLocal } from './browser-sync.mjs';
import { readZip } from '../extension/lib/zip.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  output = path.join(root, 'test-results'),
  extension = path.join(root, 'extension');
await mkdir(output, { recursive: true });
const profiles = await mkdtemp(path.join(output, 'media-profiles-')),
  contexts = [],
  errors = [],
  repo = new BrowserSyncHarness(),
  checks = [];
function pass(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function launch(name) {
  const testExtension = await authorizedExtension(extension, profiles);
  const context = await chromium.launchPersistentContext(path.join(profiles, name), {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1360, height: 980 },
    args: [
      `--disable-extensions-except=${testExtension}`,
      `--load-extension=${testExtension}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  contexts.push(context);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  await repo.connect(context, worker);
  const id = worker.url().split('/')[2],
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  return { context, id, page };
}
async function rows(page) {
  return page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const rows = await db.allRows();
    await db.close();
    return rows;
  });
}
const configure = enableLocal;
async function sync(page, selector = '#sync') {
  await page.locator(selector).click();
  await page.waitForFunction(
    () =>
      document.querySelector('#toast').textContent.includes('同步完成') ||
      document.querySelector('#toast').classList.contains('error'),
  );
  assert.match(await page.locator('#toast').innerText(), /同步完成/);
  await page.waitForFunction((selector) => !document.querySelector(selector).disabled, selector);
}
try {
  const a = await launch('a'),
    side = await a.context.newPage();
  side.on('pageerror', (e) => errors.push(e.message));
  await side.setViewportSize({ width: 360, height: 950 });
  await side.goto(`chrome-extension://${a.id}/sidepanel.html`);
  await side.locator('#capture-form').waitFor();
  assert.equal(await side.locator('.panel-header').count(), 0);
  assert.equal(await side.getByText('仅本地', { exact: false }).count(), 0);
  assert.ok(
    await a.page
      .locator('.sidebar .brand-penguin')
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  pass('企鹅图标、移除侧栏顶部与仅本地选项');
  const site = await a.context.newPage();
  await a.context.route('https://capture-test.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<meta charset="utf-8"><title>导航后的当前网页</title><p id="selection">这是按钮实际收集的选中文字。</p>',
    }),
  );
  await site.goto('https://capture-test.example/after-navigation');
  await site.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#selection'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await site.bringToFront();
  // A standalone extension tab stands in for the native side panel. Keep the website active.
  await side.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '捕获当前网页').click(),
  );
  await side.waitForFunction(
    () => document.querySelector('#capture-form [name=title]').value === '导航后的当前网页',
  );
  assert.equal((await rows(side)).length, 0);
  assert.match(
    await side.locator('#capture-form [name=content]').inputValue(),
    /## collected:[\s\S]*- 这是按钮实际收集的选中文字。/,
  );
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await side.locator('#records').filter({ hasText: '导航后的当前网页' }).waitFor();
  const captured = (await rows(side))[0];
  assert.equal(captured.record.sources[0].url, 'https://capture-test.example/after-navigation');
  assert.equal(captured.record.type, 'note');
  pass('网页导航后捕获先进入编辑器，用户保存后才进入收件箱');
  await side.bringToFront();
  await side.locator('#capture-form [name=title]').fill('图片与录音的同一条笔记');
  const content = side.locator('#capture-form [name=content]');
  await content.fill('# 灵感\n\n图片和录音放在同一条 Markdown 中。');
  const image = await readFile(path.join(extension, 'icons/penguin.png'));
  await content.evaluate(
    (node, bytes) => {
      const file = new File([new Uint8Array(bytes)], '企鹅.png', { type: 'image/png' }),
        data = new DataTransfer();
      data.items.add(file);
      node.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    [...image],
  );
  await side.waitForFunction(() => document.querySelector('.media-gallery img')?.naturalWidth > 0);
  assert.match(await content.inputValue(), /!\[企鹅.png\]\(assets\/[a-f0-9]{64}\.png\)/);
  pass('粘贴图片写入本机二进制附件并插入 Markdown，预览可见');
  await side.evaluate(() => {
    window.originalPermissionQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async (descriptor) =>
      descriptor.name === 'microphone'
        ? { state: 'prompt' }
        : window.originalPermissionQuery(descriptor);
  });
  const canceledPage = a.context.waitForEvent('page');
  await side.getByRole('button', { name: '开始录音', exact: true }).click();
  const canceled = await canceledPage;
  await canceled.waitForURL('**/microphone.html?request=*');
  await canceled.getByRole('button', { name: '取消', exact: true }).click();
  await side.waitForFunction(() =>
    document.querySelector('.media-composer .error-text')?.textContent.includes('取消'),
  );
  assert.equal(await side.getByRole('button', { name: '开始录音', exact: true }).isEnabled(), true);
  pass('首次录音打开可见授权页，取消后不录音且按钮恢复');
  const deniedPage = a.context.waitForEvent('page');
  await side.getByRole('button', { name: '开始录音', exact: true }).click();
  const denied = await deniedPage;
  await denied.waitForURL('**/microphone.html?request=*');
  await denied.evaluate(
    () =>
      (navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('denied', 'NotAllowedError');
      }),
  );
  await denied.getByRole('button', { name: '允许麦克风', exact: true }).click();
  await side.waitForFunction(() =>
    document.querySelector('.media-composer .error-text')?.textContent.includes('阻止'),
  );
  assert.equal(
    await denied.getByRole('button', { name: '打开浏览器麦克风设置', exact: true }).count(),
    1,
  );
  await denied.getByRole('button', { name: '取消', exact: true }).click();
  pass('拒绝麦克风权限显示明确原因与设置入口，没有伪装成已录音');
  const authorizedPage = a.context.waitForEvent('page');
  await side.getByRole('button', { name: '开始录音', exact: true }).click();
  const authorized = await authorizedPage;
  await authorized.waitForURL('**/microphone.html?request=*');
  await authorized.getByRole('button', { name: '允许麦克风', exact: true }).click();
  await side.getByRole('button', { name: '停止录音', exact: true }).waitFor();
  await side.evaluate(() => (navigator.permissions.query = window.originalPermissionQuery));
  pass('授权页允许后自动回到侧栏并开始真实 MediaRecorder 录音（模拟麦克风）');
  await side.getByRole('button', { name: '停止录音', exact: true }).waitFor();
  assert.equal(await side.getByRole('button', { name: '停止录音', exact: true }).isEnabled(), true);
  await side.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const sessions = await db.recordings();
    await db.close();
    return sessions.some((s) => s.chunks >= 2);
  });
  await side.getByRole('button', { name: '停止录音', exact: true }).click();
  await side.waitForFunction(
    () =>
      !!document.querySelector('.media-gallery audio') &&
      !document.querySelector('.media-toolbar button:last-of-type')?.disabled,
  );
  await side.getByRole('button', { name: '开始录音', exact: true }).waitFor();
  await side.locator('.media-gallery audio').evaluate(async (audio) => {
    await audio.play();
  });
  await side.waitForFunction(() => document.querySelector('.media-gallery audio')?.currentTime > 0);
  pass('实际 MediaRecorder 录音、每秒落盘、停止后生成可播放音频（虚拟麦克风）');
  await side.getByRole('button', { name: '预览', exact: true }).click();
  await side.waitForFunction(
    () =>
      document.querySelector('.markdown img')?.naturalWidth > 0 &&
      !!document.querySelector('.markdown audio'),
  );
  assert.equal(await side.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await side.evaluate(() => (document.querySelector('#toast').className = ''));
  await side.screenshot({ path: path.join(output, 'media-sidepanel.png'), fullPage: true });
  pass('Markdown 同时显示图片和音频，360px 侧栏无横向溢出');
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await side.locator('#records').filter({ hasText: '图片与录音的同一条笔记' }).waitFor();
  const before = (await rows(side)).find((r) => r.record.title === '图片与录音的同一条笔记');
  assert.equal(before.record.attachments.length, 2);
  assert.deepEqual(before.record.attachments.map((a) => a.kind).sort(), ['audio', 'image']);
  await side.getByRole('button', { name: '打开 图片与录音的同一条笔记', exact: true }).click();
  await side.getByRole('button', { name: '完整修改', exact: true }).click();
  await side.getByRole('button', { name: '保存修改', exact: true }).waitFor();
  await side.locator('#capture-form [name=title]').fill('原记录修改后的标题');
  await side.getByRole('button', { name: '保存修改', exact: true }).click();
  await side.locator('#records').filter({ hasText: '原记录修改后的标题' }).waitFor();
  const after = (await rows(side)).find((r) => r.id === before.id);
  assert.equal((await rows(side)).length, 2);
  assert.equal(after.record.created_at, before.record.created_at);
  assert.equal(after.record.type, 'note');
  assert.equal(after.record.attachments.length, 2);
  pass('侧栏直接编辑原记录，ID、创建时间及附件保留，记录数不增加');
  const downloaded = side.waitForEvent('download');
  await side.locator('#panel-save-local').click();
  const zipPath = path.join(output, 'media-local-backup.zip');
  await (await downloaded).saveAs(zipPath);
  const bytes = await readFile(zipPath),
    files = await readZip(new Blob([bytes])),
    backupText = new TextDecoder().decode(files.get('backup.json'));
  assert.ok(!backupText.includes('fake-token'));
  for (const descriptor of after.record.attachments)
    assert.equal(files.get(descriptor.path).length, descriptor.size_bytes);
  assert.match(new TextDecoder().decode(files.get(`notes/${after.id}.md`)), /\.\.\/assets\//);
  assert.equal(repo.remote.calls.length, 0);
  pass('保存到本地下载完整 ZIP，包含全部附件、JSON 和 Markdown，不上传也不含凭证');
  await configure(a.page);
  await sync(side, '#panel-sync');
  for (const descriptor of after.record.attachments)
    assert.ok(
      [...repo.remote.files.values()].some((f) => f.appProperties?.pkm_sha256 === descriptor.id),
    );
  const b = await launch('b');
  await configure(b.page);
  await sync(b.page);
  await b.page.getByRole('button', { name: '打开 原记录修改后的标题', exact: true }).click();
  await b.page.getByRole('button', { name: '完整修改', exact: true }).click();
  const dialog = b.page.locator('dialog[open]');
  assert.equal(await dialog.locator('.media-gallery img').count(), 0);
  await dialog.getByRole('button', { name: '加载图片', exact: true }).click();
  await b.page.waitForFunction(
    () => document.querySelector('dialog .media-gallery img')?.naturalWidth > 0,
  );
  await dialog.getByRole('button', { name: '加载录音', exact: true }).click();
  await dialog.locator('audio').evaluate(async (audio) => {
    await audio.play();
  });
  await b.page.waitForFunction(() => document.querySelector('dialog audio')?.currentTime > 0);
  pass('真实双浏览器手动同步附件，按需加载图片与录音并可播放');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const c = await launch('c');
  await c.context.setOffline(true);
  await c.page.locator('#settings').click();
  await c.page.locator('dialog input[type=file]').setInputFiles(zipPath);
  await c.page.getByRole('button', { name: '导入到本机', exact: true }).click();
  await c.page.locator('#records').filter({ hasText: '原记录修改后的标题' }).waitFor();
  await c.page.getByRole('button', { name: '打开 原记录修改后的标题', exact: true }).click();
  await c.page.getByRole('button', { name: '完整修改', exact: true }).click();
  await c.page.waitForFunction(
    () =>
      document.querySelector('dialog .media-gallery img')?.naturalWidth > 0 &&
      !!document.querySelector('dialog .media-gallery audio'),
  );
  const restored = (await rows(c.page)).find((r) => r.id === after.id);
  assert.deepEqual(restored.record, after.record);
  pass('完整 ZIP 从真实界面离线导入，保留同一 ID 与可预览附件');
  await a.page.locator('#new').click();
  const recordingDialog = a.page.locator('dialog[open]');
  await recordingDialog.locator('[name=title]').fill('中断录音的恢复');
  await recordingDialog.getByRole('button', { name: '开始录音', exact: true }).click();
  await a.page.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const sessions = await db.recordings();
    await db.close();
    return sessions.some((s) => s.chunks >= 2);
  });
  await recordingDialog.getByRole('button', { name: '×', exact: true }).click();
  await a.page.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const sessions = await db.recordings();
    await db.close();
    return sessions.some((s) => s.chunks >= 2);
  });
  await a.page.locator('#settings').click();
  await a.page.getByRole('button', { name: '恢复到收件箱', exact: true }).click();
  await a.page.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const sessions = await db.recordings(),
      rows = await db.allRows();
    await db.close();
    return (
      !sessions.length &&
      rows.some(
        (r) =>
          r.record.type === 'note' &&
          r.record.attachments.length === 1 &&
          r.record.attachments[0].kind === 'audio',
      )
    );
  });
  pass('关闭正在录音的编辑窗口保留片段，设置中恢复为普通记录');
  assert.deepEqual(errors, []);
  pass('新增界面场景没有未处理异常');
  await writeFile(
    path.join(output, 'media-browser-report.json'),
    JSON.stringify({ checks, record: after.record, zipBytes: bytes.length }, null, 2),
  );
} finally {
  await repo.close();
  for (const context of contexts) await context.close();
  if (
    !path.resolve(profiles).startsWith(path.resolve(output) + path.sep) ||
    !path.basename(profiles).startsWith('media-profiles-')
  )
    throw new Error('Unexpected cleanup path');
  await rm(profiles, { recursive: true, force: true });
}

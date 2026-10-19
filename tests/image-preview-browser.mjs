import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions, authorizedExtension } from './browser-options.mjs';
import { readZip } from '../extension/lib/zip.js';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'image-preview-'));
const checks = [],
  errors = [];
const pass = (text) => {
  checks.push(text);
  console.log('PASS ' + text);
};
let context, page;
try {
  const extension = await authorizedExtension(path.resolve('extension'), profile);
  context = await chromium.launchPersistentContext(path.join(profile, 'browser'), {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1360, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  page = await context.newPage();
  await page.goto(base + 'dashboard.html');
  await page.locator('#heading').waitFor();
  assert.equal(await page.title(), 'GUGA Knowledge · 知识收件箱');
  assert.equal(await page.locator('.sidebar .brand-name').innerText(), 'GUGA Knowledge');
  assert.equal(await page.locator('.brand-sub').innerText(), 'YOUR KNOWLEDGE, GUGUGAGA');
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.name, 'GUGA Knowledge · 个人知识收件箱');
  assert.equal(new URL(base).hostname, 'jjpdanoikikedmildkmhndmbjnajjaho');
  pass('品牌、标语、页面标题与扩展名称更新，固定扩展身份和原有数据库沿用');
  const png = await readFile(path.resolve('extension/icons/icon-128.png'));
  const detached = await page.evaluate(
    async (bytes) => {
      const { assetView } = await import('./lib/dom.js');
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      const descriptor = {
        id: 'fixture',
        name: '测试图片.png',
        kind: 'image',
        size_bytes: blob.size,
        mime_type: 'image/png',
      };
      const view = assetView(descriptor, { local: async () => blob, load: async () => blob });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const renderedWhileDetached = !!view.querySelector('img');
      document.body.append(view);
      await view.querySelector('img')?.decode();
      const decoded = view.querySelector('img')?.naturalWidth;
      view.dispose();
      view.remove();
      let release;
      const disposed = assetView(descriptor, {
        local: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      });
      disposed.dispose();
      release(blob);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        renderedWhileDetached,
        decoded,
        disposedImages: disposed.querySelectorAll('img').length,
      };
    },
    [...png],
  );
  assert.equal(detached.renderedWhileDetached, true);
  assert.equal(detached.decoded, 128);
  assert.equal(detached.disposedImages, 0);
  pass('本地读取早于挂载时仍自动显示图片；关闭后的延迟读取不再创建预览');

  const side = await context.newPage();
  await side.setViewportSize({ width: 360, height: 1000 });
  await side.goto(base + 'sidepanel.html');
  await side.locator('#capture-form').waitFor();
  await side.locator('[name=title]').fill('立即保存的图片');
  await side.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const original = Database.prototype.storeAsset;
    const gate = new Promise((resolve) => {
      globalThis.releaseImageImport = resolve;
    });
    Database.prototype.storeAsset = async function (...args) {
      await gate;
      return original.apply(this, args);
    };
    globalThis.restoreImageImport = () => {
      Database.prototype.storeAsset = original;
    };
  });
  await side
    .locator('[data-media-file=image]')
    .setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  assert.equal(
    await side.getByRole('button', { name: '保存到收件箱', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.evaluate(async () => {
      const { Database } = await import('./lib/db.js');
      const db = new Database();
      const rows = await db.allRows();
      await db.close();
      return rows.length;
    }),
    0,
  );
  await side.evaluate(() => globalThis.releaseImageImport());
  await page.waitForFunction(() =>
    document.querySelector('#records')?.textContent.includes('立即保存的图片'),
  );
  await side.evaluate(() => globalThis.restoreImageImport());
  const saved = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const row = (await db.allRows()).find((row) => row.record.title === '立即保存的图片');
    await db.close();
    return row.record;
  });
  assert.equal(saved.attachments.length, 1);
  assert.match(saved.content, /!\[image.png\]\(assets\/[a-f0-9]{64}\.png\)/);
  await page.locator(`[data-record-id="${saved.id}"] .record-top h2`).click();
  const preview = page.getByRole('dialog', { name: '预览记录', exact: true });
  await preview.locator('img').evaluate((image) => image.decode());
  assert.equal(
    await preview.getByRole('button', { name: '加载图片', exact: true }).isVisible(),
    false,
  );
  await page.screenshot({ path: path.join(output, 'image-auto-preview.png') });
  await preview.getByRole('button', { name: '关闭', exact: true }).click();
  pass('图片写入期间立即保存会等待附件，保存后的普通预览自动显示完整图片');

  await side.locator('[name=title]').fill('粘贴图片');
  await side.locator('[name=content]').evaluate(
    (node, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'paste.png', { type: 'image/png' }));
      node.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    [...png],
  );
  await side.locator('.media-gallery img').evaluate((image) => image.decode());
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#records')?.textContent.includes('粘贴图片'),
  );
  pass('Ctrl+V 图片可离线预览并保存附件和 Markdown 引用');

  await context.route('https://image-collect.example/**', (route) =>
    route.request().url().endsWith('/image.png')
      ? route.fulfill({ contentType: 'image/png', body: png })
      : route.fulfill({
          contentType: 'text/html',
          body: '<meta charset="utf-8"><title>图片收集页面</title><img src="/image.png" alt="收集的图片说明">',
        }),
  );
  const web = await context.newPage();
  await web.goto('https://image-collect.example/page');
  await web.locator('img').evaluate((image) => image.decode());
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({})).find((tab) => tab.url === 'https://image-collect.example/page')
        .id,
  );
  const response = await page.evaluate(
    async (tabId) =>
      chrome.runtime.sendMessage({
        type: 'collect-context',
        tabId,
        info: {
          menuItemId: 'capture-image',
          srcUrl: 'https://image-collect.example/image.png',
          pageUrl: 'https://image-collect.example/page',
        },
      }),
    tabId,
  );
  assert.equal(response.ok, true);
  await side.waitForFunction(() =>
    document.querySelector('[name=content]')?.value.includes('原图'),
  );
  await side.locator('.media-gallery img').evaluate((image) => image.decode());
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#records')?.textContent.includes('图片收集页面'),
  );
  const attachmentCounts = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const rows = await db.allRows();
    await db.close();
    return rows.map((row) => row.record.attachments.length);
  });
  assert.deepEqual(attachmentCounts, [1, 1, 1]);
  pass('网页右键图片通过正式后台收集链路保存为本地附件，编辑器可直接解码预览');
  const event = page.waitForEvent('download');
  await page.locator('#save-local').click();
  await page
    .getByRole('dialog', { name: '选择导出整理方式', exact: true })
    .getByRole('button', { name: '开始导出', exact: true })
    .click();
  const download = await event;
  assert.match(download.suggestedFilename(), /^GUGA-Knowledge-data-/);
  const file = path.join(output, 'guga-image-backup.zip');
  await download.saveAs(file);
  const files = await readZip(new Blob([await readFile(file)]));
  const backup = JSON.parse(new TextDecoder().decode(files.get('backup.json')));
  assert.equal(backup.format, 'pkm-nexus-backup');
  assert.equal(backup.records.length, 3);
  assert.ok(files.has(saved.attachments[0].path));
  pass('新品牌备份含图片原文件，继续兼容现有备份格式');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'image-preview-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'image-preview-failure.png') }).catch(() => {});
  await writeFile(path.join(output, 'image-preview-failure.txt'), String(error.stack));
  throw error;
} finally {
  await context?.close();
  if (
    !path.resolve(profile).startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('image-preview-')
  )
    throw new Error('Unexpected test profile path');
  await rm(profile, { recursive: true, force: true });
}

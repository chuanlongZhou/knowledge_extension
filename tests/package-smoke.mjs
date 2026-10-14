import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'test-results'), extension = path.join(root, 'dist', 'pkm-nexus');
await mkdir(output, {recursive: true}); const profile = await mkdtemp(path.join(output, 'package-profile-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {channel: 'chromium', headless: true, viewport: {width: 1280, height: 900}, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const errors = [], requests = []; context.on('request', request => { if (request.url().startsWith('https://api.github.com')) requests.push(request.url()); });
  let [worker] = context.serviceWorkers(); if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2], page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/dashboard.html`); await page.locator('#heading').filter({hasText: '收件箱'}).waitFor();
  await page.locator('#new').click(); const modal = page.locator('dialog[open]'); await modal.locator('[name=title]').fill('安装包验证'); await modal.locator('[name=content]').fill('完整安装包可以独立运行，无需 npm 或本地服务。'); await modal.getByRole('button', {name: '保存到本机', exact: true}).click(); await modal.waitFor({state:'hidden'}); await page.locator('#records').filter({hasText:'安装包验证'}).waitFor();
  const image = await page.evaluate(async () => { const response = await fetch(chrome.runtime.getURL('icons/icon-128.png')); const blob = await response.blob(); const bitmap = await createImageBitmap(blob); return {width: bitmap.width, height: bitmap.height}; });
  assert.deepEqual(image, {width:128, height:128}); assert.equal(errors.length,0); assert.equal(requests.length,0);
  console.log('PASS built extension installs, loads all modules, writes IndexedDB, decodes PNG icon, and makes no automatic GitHub request');
} finally {
  await context?.close(); if (!path.resolve(profile).startsWith(path.resolve(output)+path.sep) || !path.basename(profile).startsWith('package-profile-')) throw new Error('Unexpected profile cleanup path'); await rm(profile,{recursive:true,force:true});
}

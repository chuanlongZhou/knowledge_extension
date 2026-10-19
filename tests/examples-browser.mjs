import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'examples-profile-')),
  checks = [],
  errors = [],
  external = [];
let context;
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
try {
  const extension = path.resolve(process.argv.includes('--built') ? 'dist/pkm-nexus' : 'extension');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1360, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) external.push(request.url());
  });
  await context.setOffline(true);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2],
    page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  const region = page.locator('#builtin-examples');
  await region.locator('.example-card').nth(5).waitFor();
  const rows = () =>
    page.evaluate(async () => {
      const { Database } = await import('./lib/db.js'),
        db = new Database('pkm-nexus-v1', { broadcast: false });
      try {
        return { records: await db.allRows(), assets: (await db.allAssets()).length };
      } finally {
        await db.close();
      }
    });
  assert.deepEqual(await rows(), { records: [], assets: 0 });
  assert.match(await region.innerText(), /只读预览/);
  await region.screenshot({ path: path.join(output, 'builtin-examples-inbox.png') });
  pass('收件箱离线展示六条示例，个人数据库和待同步记录保持为空');
  for (const title of [
    '网页链接',
    '纯文字笔记',
    '文字 + 录音',
    '网页 + 文字 + 录音 + 图片',
    'Wiki 页面快照',
    'CHETNA 页面快照',
  ]) {
    await region.getByRole('button', { name: `查看示例：${title}`, exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('button', { name: '保存到我的收件箱', exact: true }).waitFor();
    const images = dialog.locator('.asset-view img');
    if (
      (await dialog.locator('.asset-view').count()) &&
      (title.includes('图片') || title.includes('快照'))
    ) {
      await page.waitForFunction(() =>
        [...document.querySelectorAll('dialog .asset-view img')].some(
          (img) => img.naturalWidth > 0,
        ),
      );
      assert.ok(await images.count());
    }
    if (title.includes('录音')) {
      await dialog.locator('audio').waitFor();
      await dialog.locator('audio').evaluate(async (audio) => {
        await audio.play();
      });
      await page.waitForFunction(() => document.querySelector('dialog audio')?.currentTime > 0.2);
      await dialog.locator('audio').evaluate((audio) => audio.pause());
    }
    if (title === '网页 + 文字 + 录音 + 图片')
      await dialog.screenshot({ path: path.join(output, 'builtin-example-multimedia.png') });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
  assert.deepEqual(await rows(), { records: [], assets: 0 });
  pass('六条示例可离线打开；两段测试音频实际播放、快照解码，预览不写入数据库');
  await region
    .getByRole('button', { name: '查看示例：网页 + 文字 + 录音 + 图片', exact: true })
    .click();
  await page.getByRole('button', { name: '保存到我的收件箱', exact: true }).click();
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  await page
    .locator('#records article')
    .filter({ hasText: 'CHETNA 城市排放页面阅读笔记' })
    .waitFor();
  let current = await rows();
  assert.equal(current.records.length, 1);
  assert.equal(current.assets, 2);
  const saved = current.records[0];
  assert.equal(saved.dirty, true);
  assert.equal(saved.record.sources[0].url, 'https://chetna-indian.netlify.app/');
  pass('主动保存后正文、来源、图片和音频作为同一条普通收件箱记录，按现有规则待同步');
  await page.getByRole('button', { name: `打开 ${saved.record.title}`, exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '完整修改', exact: true }).click();
  const editor = page.locator('dialog[open]');
  await editor.locator('[name=content]').fill('用户自行编辑后的示例正文。');
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  if (!(await region.locator('details').evaluate((node) => node.open)))
    await region.locator('summary').click();
  await region
    .getByRole('button', { name: '查看示例：网页 + 文字 + 录音 + 图片', exact: true })
    .click();
  await page.getByRole('button', { name: '保存到我的收件箱', exact: true }).click();
  await page.getByRole('button', { name: '已保存过此示例', exact: true }).waitFor();
  current = await rows();
  assert.equal(current.records.length, 1);
  assert.equal(current.records[0].record.content, '用户自行编辑后的示例正文。');
  await page.locator('dialog[open]').getByRole('button', { name: '关闭', exact: true }).click();
  pass('保存的示例可正常编辑，重复点击保存不会复制或覆盖用户修改');
  await region.getByRole('button', { name: '隐藏内置示例', exact: true }).click();
  await region.waitFor({ state: 'hidden' });
  await page.locator('#examples-shortcut').waitFor({ state: 'hidden' });
  await page.reload();
  await region.waitFor({ state: 'hidden' });
  await page.locator('#examples-shortcut').waitFor({ state: 'hidden' });
  await page.locator('#settings').click();
  const hiddenSetting = page
    .getByRole('dialog', { name: '设置与数据管理' })
    .getByLabel('完全隐藏内置示例');
  assert.equal(await hiddenSetting.isChecked(), true);
  await hiddenSetting.uncheck();
  await page
    .getByRole('dialog', { name: '设置与数据管理' })
    .getByRole('button', { name: '关闭' })
    .click();
  await region.locator('.example-card').nth(5).waitFor();
  assert.equal((await rows()).records.length, 1);
  pass('隐藏状态跨刷新保留，设置页可恢复预览，个人记录不受影响');
  const side = await context.newPage();
  await side.setViewportSize({ width: 360, height: 1000 });
  await side.goto(`chrome-extension://${id}/sidepanel.html`);
  await side.locator('#builtin-examples summary').waitFor();
  assert.equal(await side.locator('#builtin-examples details').evaluate((node) => node.open), true);
  const shortcut = side.getByRole('button', { name: '查看 6 条内置示例', exact: true });
  const shortcutBox = await shortcut.boundingBox();
  assert.ok(shortcutBox.y > 750 && shortcutBox.y + shortcutBox.height < 1000);
  assert.equal(await side.locator('.panel-start').count(), 0);
  assert.equal(
    await side.locator('#extension-version').innerText(),
    `GUGA Knowledge v${await side.evaluate(() => chrome.runtime.getManifest().version)}`,
  );
  await side.screenshot({ path: path.join(output, 'builtin-examples-sidepanel-entry.png') });
  await shortcut.click();
  await side.waitForFunction(
    () => document.querySelector('#builtin-examples').getBoundingClientRect().top < 100,
  );
  assert.ok((await side.locator('#builtin-examples').boundingBox()).y < 100);
  await side.locator('#builtin-examples .example-card').nth(5).waitFor();
  assert.equal(await side.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await side
    .locator('#builtin-examples')
    .screenshot({ path: path.join(output, 'builtin-examples-sidepanel.png') });
  pass('已有个人记录时示例默认展开，360px 侧栏底部入口可一键到达，版本可见');
  await side.getByRole('button', { name: '隐藏内置示例', exact: true }).click();
  await side.locator('#builtin-examples').waitFor({ state: 'hidden' });
  await side.locator('#examples-shortcut').waitFor({ state: 'hidden' });
  await side.reload();
  await side.locator('#examples-shortcut').waitFor({ state: 'hidden' });
  const openedSettings = context.waitForEvent('page');
  await side.getByRole('button', { name: '打开设置', exact: true }).click();
  const settingsPage = await openedSettings;
  const sideSetting = settingsPage
    .getByRole('dialog', { name: '设置与数据管理' })
    .getByLabel('完全隐藏内置示例');
  assert.equal(await sideSetting.isChecked(), true);
  await sideSetting.uncheck();
  await side.locator('#examples-shortcut').waitFor({ state: 'visible' });
  await settingsPage.close();
  await side.locator('#builtin-examples .example-card').nth(5).waitFor();
  assert.equal((await rows()).records.length, 1);
  pass('设置可跨整理页和侧栏彻底隐藏或恢复样例及入口，个人记录仍保留');
  await side.getByRole('button', { name: '全部加入我的收件箱', exact: true }).click();
  await side.waitForFunction(() => document.querySelectorAll('#records article').length === 6);
  current = await rows();
  assert.equal(current.records.length, 6);
  assert.equal(current.assets, 4);
  assert.equal(
    current.records.find((r) => r.id === saved.id).record.content,
    '用户自行编辑后的示例正文。',
  );
  assert.ok(current.records.every((r) => r.dirty));
  await side.locator('#builtin-examples summary').click();
  await side.getByRole('button', { name: '全部加入我的收件箱', exact: true }).click();
  await side
    .getByText('已加入 0 条示例到收件箱；6 条已保存过，保留原有内容。', { exact: true })
    .waitFor();
  assert.equal((await rows()).records.length, 6);
  pass('全部加入得到六条普通收件箱记录及全部媒体，重复导入跳过并保留已编辑内容');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  pass('360px 侧栏布局无横向溢出；全部预览、单条保存及整批导入均无外部请求');
  await writeFile(
    path.join(
      output,
      process.argv.includes('--built')
        ? 'examples-built-report.json'
        : 'examples-browser-report.json',
    ),
    JSON.stringify(
      {
        extensionVersion: await page.evaluate(() => chrome.runtime.getManifest().version),
        checks,
        externalRequests: external.length,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await context?.close();
  if (
    !profile.startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('examples-profile-')
  )
    throw new Error('Unexpected example test profile');
  await rm(profile, { recursive: true, force: true });
}

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'customization-profile-'));
const checks = [],
  errors = [];
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
let context;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1440, height: 1060 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + 'dashboard.html');
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const project = newRecord({ type: 'project', title: '阅读计划' });
    const retired = newRecord({
      type: 'project',
      title: '已删除项目',
      deleted_at: new Date().toISOString(),
    });
    const records = [
      project,
      retired,
      newRecord({
        title: '项目中的读书笔记',
        tags: ['阅读'],
        organization_state: 'organized',
        project_ids: [project.id],
      }),
      newRecord({
        title: '尚未放入项目的读书笔记',
        content: '旅行灵感',
        tags: ['阅读'],
        organization_state: 'organized',
      }),
      newRecord({
        title: '原项目已删除的笔记',
        tags: ['灵感'],
        organization_state: 'organized',
        project_ids: [retired.id],
      }),
      newRecord({ title: '收件箱草稿', tags: ['阅读'] }),
    ];
    await db.saveMany(records.map((record) => ({ record })));
    await db.close();
  });
  await page.locator('#tags-nav [data-tag="阅读"]').waitFor();
  assert.deepEqual(await page.locator('#tags-nav .tag-chip').allTextContents(), ['灵感', '阅读']);
  assert.equal(await page.locator('#tags-nav .count').count(), 0);
  pass('标签只显示名称，保留名称中的文字与数字');

  const membership = page.getByLabel('是否在项目', { exact: true });
  assert.equal(await membership.isVisible(), false);
  await page.locator('[data-view=organized]').click();
  await membership.waitFor();
  await membership.selectOption('no-project');
  await page.waitForFunction(
    () =>
      document.querySelector('#records').textContent.includes('原项目已删除的笔记') &&
      document.querySelectorAll('#records article').length === 2,
  );
  await page.getByLabel('标签筛选', { exact: true }).selectOption('阅读');
  await page.waitForFunction(() => document.querySelectorAll('#records article').length === 1);
  await page.getByRole('tab', { name: '普通记录', exact: true }).click();
  await page.getByLabel('搜索记录', { exact: true }).fill('旅行灵感');
  await page.locator('#records article').filter({ hasText: '尚未放入项目的读书笔记' }).waitFor();
  await page.reload();
  await page.locator('#records article').filter({ hasText: '尚未放入项目的读书笔记' }).waitFor();
  assert.equal(await membership.inputValue(), 'no-project');
  assert.equal(await page.getByLabel('搜索记录', { exact: true }).inputValue(), '旅行灵感');
  await page.getByLabel('搜索记录', { exact: true }).fill('');
  await page.getByLabel('标签筛选', { exact: true }).selectOption('');
  await membership.selectOption('in-project');
  await page.locator('#records article').filter({ hasText: '项目中的读书笔记' }).waitFor();
  assert.equal(await page.locator('#records article').count(), 1);
  await membership.selectOption('no-project');
  await page.waitForFunction(() => document.querySelectorAll('#records article').length === 2);
  await page.screenshot({ path: path.join(output, 'organized-project-filter.png') });
  await page.locator('[data-view=all]').click();
  await page.waitForFunction(() => document.querySelector('#project-membership-filter').hidden);
  await page.waitForFunction(() => document.querySelectorAll('#records article').length === 4);
  pass('项目归属筛选与搜索、标签、类型组合，刷新保留，离开已整理后不影响其他列表');

  await page.locator('#settings').click();
  await page.locator('#theme').click();
  let dialog = page.getByRole('dialog', { name: '主题与字体', exact: true });
  assert.equal(await dialog.locator('.theme-preset').count(), 6);
  const expectedHex = [
    '#3E6868',
    '#C94E44',
    '#C1AB85',
    '#FBC359',
    '#73A642',
    '#4B848A',
    '#3D5D52',
    '#352D27',
    '#D3B8A6',
    '#632626',
    '#9D5353',
    '#BF8567',
    '#DBC896',
    '#4E635E',
    '#E2E0C8',
    '#A6B49E',
    '#818C78',
    '#D6BD98',
    '#677D6A',
    '#40534C',
    '#1A3636',
  ];
  const titles = await dialog
    .locator('.theme-preset-swatch')
    .evaluateAll((nodes) => nodes.map((n) => n.title));
  assert.deepEqual(
    titles.map((title) => title.slice(-7)),
    expectedHex,
  );
  for (const [id, accent] of [
    ['vintage-vinyl', '#3E6868'],
    ['hawaiian-surf', '#4B848A'],
    ['french-vintage', '#3D5D52'],
    ['spiced-chai', '#632626'],
    ['ocean-mist', '#4E635E'],
    ['matcha-forest', '#40534C'],
  ]) {
    await dialog.locator(`[data-preset="${id}"]`).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), id);
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--green').toUpperCase(),
      ),
      accent,
    );
    assert.equal(await dialog.locator('.theme-preset[aria-pressed=true]').count(), 1);
  }
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
  pass('六套配色与 21 个原始 HEX 一致，逐套预览，取消后恢复原主题');

  const side = await context.newPage();
  side.on('pageerror', (e) => errors.push(e.message));
  await side.setViewportSize({ width: 360, height: 1000 });
  await side.goto(base + 'sidepanel.html');
  await side.locator('#capture-form').waitFor();
  await page.locator('#theme').click();
  dialog = page.getByRole('dialog', { name: '主题与字体', exact: true });
  await dialog.getByLabel('编辑器字号', { exact: true }).fill('16');
  await dialog.locator('[data-preset=ocean-mist]').click();
  assert.equal(await dialog.getByLabel('编辑器字号', { exact: true }).inputValue(), '16');
  await dialog
    .locator('.theme-presets')
    .screenshot({ path: path.join(output, 'six-theme-presets.png') });
  await dialog.getByRole('button', { name: '保存主题', exact: true }).click();
  await side.waitForFunction(() => document.documentElement.dataset.theme === 'ocean-mist');
  await side.reload();
  await side.locator('#capture-form').waitFor();
  assert.equal(await side.evaluate(() => document.documentElement.dataset.theme), 'ocean-mist');
  assert.equal(
    await side.locator('#capture-form').evaluate((n) => getComputedStyle(n).fontSize),
    '16px',
  );
  const guide = await context.newPage();
  await guide.goto(base + 'manual.html');
  await guide.waitForFunction(() => document.documentElement.dataset.theme === 'ocean-mist');
  await guide.close();
  await side.getByRole('button', { name: '主题与字体', exact: true }).click();
  const sideDialog = side.getByRole('dialog', { name: '主题与字体', exact: true });
  await sideDialog.locator('[data-preset=matcha-forest]').click();
  assert.equal(await sideDialog.evaluate((n) => n.scrollWidth > n.clientWidth), false);
  await sideDialog
    .locator('.theme-presets')
    .screenshot({ path: path.join(output, 'six-theme-presets-narrow.png') });
  await sideDialog.getByRole('button', { name: '取消', exact: true }).click();
  await side.waitForFunction(() => document.documentElement.dataset.theme === 'ocean-mist');
  await page.reload();
  await page.locator('#heading').filter({ hasText: '全部记录' }).waitFor();
  await page.screenshot({ path: path.join(output, 'ocean-mist-dashboard.png') });
  pass('主题跨整理页、360px 侧栏与帮助页保存并恢复，字体保留，窄屏主题面板无横向溢出');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'ui-customization-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  if (context)
    for (const [index, page] of context.pages().entries())
      await page
        .screenshot({ path: path.join(output, `customization-failure-${index}.png`) })
        .catch(() => {});
  throw error;
} finally {
  await context?.close();
  if (
    !profile.startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('customization-profile-')
  )
    throw new Error('Unexpected test profile');
  await rm(profile, { recursive: true, force: true });
}

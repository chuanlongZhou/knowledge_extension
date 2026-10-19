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
const profiles = await mkdtemp(path.join(output, 'types-profiles-')),
  contexts = [],
  errors = [],
  checks = [],
  repo = new BrowserSyncHarness();
const pass = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
async function launch(name) {
  const testExtension = await authorizedExtension(extension, profiles);
  const context = await chromium.launchPersistentContext(path.join(profiles, name), {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1400, height: 1000 },
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`],
  });
  contexts.push(context);
  await context.route('https://types.example/**', (route) => {
    const title = new URL(route.request().url()).pathname.slice(1);
    return route.fulfill({
      contentType: 'text/html',
      body: `<title>${title}</title><h1>${title}</h1><p>Local browser fixture.</p>`,
    });
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  await repo.connect(context, worker);
  const id = worker.url().split('/')[2],
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  return { context, page, id };
}
async function rows(page) {
  return page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const result = await db.allRows();
    await db.close();
    return result;
  });
}
async function fixture(context, name) {
  const page = await context.newPage();
  await page.goto(`https://types.example/${name}`);
  return page;
}
async function type(side, value) {
  await side.locator(`#capture-form .type-tab[data-type=${value}]`).click();
  await side.locator(`#capture-form [data-pane=${value}]:visible`).waitFor();
}
async function save(side, label = '保存到收件箱') {
  await side.getByRole('button', { name: label, exact: true }).click();
  await side.waitForFunction(
    () =>
      !!document.querySelector('#toast').textContent ||
      !!document.querySelector('#capture-form .error-text').textContent,
  );
  assert.equal(await side.locator('#capture-form .error-text').innerText(), '');
}
async function configureSync(page) {
  await enableLocal(page);
  await page.locator('#sync').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#toast').textContent.includes('同步完成') ||
      document.querySelector('#toast').classList.contains('error'),
  );
  assert.match(await page.locator('#toast').innerText(), /同步完成/);
}
try {
  const a = await launch('a'),
    side = await a.context.newPage();
  side.on('pageerror', (e) => errors.push(e.message));
  await side.setViewportSize({ width: 360, height: 1050 });
  await side.goto(`chrome-extension://${a.id}/sidepanel.html`);
  await side.locator('#capture-form').waitFor();
  assert.equal(await side.locator('#capture-form > .type-tabs .type-tab').count(), 4);
  assert.equal(await side.locator('#capture-form select').count(), 0);
  assert.equal(await side.getByRole('button', { name: '添加音频', exact: true }).count(), 0);
  assert.equal(await a.page.locator('[name=purpose]').count(), 0);
  assert.equal(
    await a.page.locator('.sidebar .brand-penguin').evaluate((img) => getComputedStyle(img).width),
    '50px',
  );
  pass('四个直接入口，无类型下拉与添加音频，企鹅放大');
  const archivePage = await fixture(a.context, 'Snapshot');
  await archivePage.bringToFront();
  await side.evaluate(() => document.querySelector('.type-tab[data-type=snapshot]').click());
  await side.locator('[data-pane=snapshot]:visible').waitFor();
  await side.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '捕获网页快照').click(),
  );
  await side.waitForFunction(
    () => document.querySelector('.snapshot-display img')?.naturalWidth > 0,
  );
  assert.equal((await rows(side)).length, 0);
  const downloaded = side.waitForEvent('download');
  await side
    .locator('.snapshot-display')
    .getByRole('button', { name: '下载图片', exact: true })
    .click();
  const png = path.join(output, 'captured-snapshot.png');
  await (await downloaded).saveAs(png);
  assert.deepEqual([...(await readFile(png)).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await save(side);
  await side.locator('#records .record-snapshot').scrollIntoViewIfNeeded();
  await side.locator('#records .record-snapshot .asset-view img').waitFor();
  const snapshot = (await rows(side)).find((r) => r.record.type === 'snapshot');
  assert.equal(snapshot.record.snapshot.format, 'png');
  assert.ok(snapshot.record.attachments.some((a) => a.kind === 'image'));
  await side.locator('#capture-form [data-type=snapshot][aria-selected=true]').waitFor();
  pass('真实 captureVisibleTab 生成 PNG 页面图片，编辑器预览与下载，保存后进入收件箱');
  await type(side, 'list');
  assert.equal(await side.locator('#capture-form [name=title]').isVisible(), false);
  if (!(await side.locator('[name=list_markdown]').isVisible()))
    await side.locator('.list-source summary').click();
  await side.locator('[name=list_markdown]').fill('- [ ] 完成本周整理\n---');
  await side.locator('#capture-form').getByRole('tab', { name: 'Idea', exact: true }).click();
  if (!(await side.locator('[name=list_markdown]').isVisible()))
    await side.locator('.list-source summary').click();
  await side.locator('[name=list_markdown]').fill('- 把创意写在一起');
  await save(side, '保存清单');
  await side.locator('.record-list').waitFor();
  await side.locator('#capture-form [data-type=list][aria-selected=true]').waitFor();
  await side.locator('#capture-form [data-mode=false][aria-selected=true]').waitFor();
  await side.reload();
  await side.locator('#capture-form [data-mode=false][aria-selected=true]').waitFor();
  const list = (await rows(side)).find((r) => r.record.type === 'list');
  assert.equal(list.id, 'nexus-list');
  assert.equal(list.record.title, '');
  assert.equal(list.record.list.length, 3);
  assert.equal(list.record.list.find((i) => i.kind === 'divider').text, '');
  await side.getByRole('checkbox', { name: '完成 完成本周整理', exact: true }).check();
  await side
    .locator('.record-list .list-preview-line.completed')
    .filter({ hasText: '完成本周整理' })
    .waitFor();
  const previousListForm = await side.locator('#capture-form').elementHandle();
  await type(side, 'list');
  await previousListForm.waitForElementState('hidden');
  await side.locator('#capture-form').getByRole('tab', { name: 'Todo', exact: true }).click();
  assert.equal(
    (await side.locator('[name=list_markdown]').inputValue()).includes('完成本周整理'),
    true,
  );
  await side.locator('#capture-form').getByRole('tab', { name: 'Idea', exact: true }).click();
  if (!(await side.locator('[name=list_markdown]').isVisible()))
    await side.locator('.list-source summary').click();
  await side.locator('[name=list_markdown]').fill('- 第二次回来完善灵感');
  await save(side, '保存修改');
  assert.equal((await rows(side)).filter((r) => r.record.type === 'list').length, 1);
  pass('无名称的唯一清单切换 Todo / Idea，分割线没有文字输入，状态与 ID 保留');
  const one = await fixture(a.context, 'Read-one'),
    two = await fixture(a.context, 'Read-two');
  await type(side, 'website_group');
  await side.locator('#capture-form [name=title]').fill('本周阅读');
  await side.getByRole('button', { name: '选择已打开网页', exact: true }).click();
  await side.getByRole('checkbox', { name: '选择标签页 Read-one', exact: true }).check();
  await side.getByRole('checkbox', { name: '选择标签页 Read-two', exact: true }).check();
  await side.getByRole('button', { name: '加入所选网页', exact: true }).click();
  assert.equal(one.isClosed(), false);
  assert.equal(two.isClosed(), false);
  await save(side);
  await side.locator('#records').filter({ hasText: '本周阅读' }).waitFor();
  await side.waitForFunction(() => document.querySelector('#toast').textContent.includes('关闭 2'));
  assert.equal(one.isClosed(), true);
  assert.equal(two.isClosed(), true);
  const group = (await rows(side)).find((r) => r.record.type === 'website_group');
  assert.equal(group.record.url_list.length, 2);
  pass('多选当前窗口网页归入网页组，先保存后关闭两个真实标签页');
  const three = await fixture(a.context, 'Read-three');
  await type(side, 'website_group');
  await side.getByRole('button', { name: '选择已打开网页', exact: true }).click();
  const dragRow = side.locator('.tab-row').filter({ hasText: 'Read-three' }),
    target = side.locator('.record-website_group').filter({ hasText: '本周阅读' });
  await side.bringToFront();
  await dragRow.scrollIntoViewIfNeeded();
  await dragRow.hover();
  await side.mouse.down();
  const sourceBox = await dragRow.boundingBox();
  await side.mouse.move(sourceBox.x + 15, sourceBox.y + 15, { steps: 5 });
  await target.scrollIntoViewIfNeeded();
  const targetBox = await target.boundingBox();
  await side.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 10,
  });
  await side.mouse.move(
    targetBox.x + targetBox.width / 2 + 3,
    targetBox.y + targetBox.height / 2 + 3,
    { steps: 3 },
  );
  await side.mouse.up();
  await side.waitForFunction(() => document.querySelector('#toast').textContent.includes('关闭 1'));
  assert.equal(three.isClosed(), true);
  assert.equal((await rows(side)).find((r) => r.id === group.id).record.url_list.length, 3);
  pass('真实拖动插件内标签页到已有网页组，原组追加并关闭拖入标签页');
  await side.getByRole('checkbox', { name: '已读 Read-one', exact: true }).check();
  await side.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const rows = await db.allRows();
    await db.close();
    return rows.some((r) => r.record.url_list?.some((u) => u.title === 'Read-one' && u.read_at));
  });
  pass('网页组卡片单独标记网址已读');
  const moving = await fixture(a.context, 'Before-navigation');
  await side.getByRole('button', { name: '选择已打开网页', exact: true }).click();
  await side.getByRole('checkbox', { name: '选择标签页 Before-navigation', exact: true }).check();
  await side.getByRole('button', { name: '加入所选网页', exact: true }).click();
  await side.locator('#capture-form [name=title]').fill('导航保护');
  await moving.goto('https://types.example/After-navigation');
  await save(side);
  await side.locator('#records').filter({ hasText: '导航保护' }).waitFor();
  assert.equal(moving.isClosed(), false);
  assert.equal(
    (await rows(side)).find((r) => r.record.title === '导航保护').record.url_list[0].url,
    'https://types.example/Before-navigation',
  );
  pass('保存前发生导航的标签页保留，不误关闭新的网页');
  const retained = await fixture(a.context, 'Keep-open');
  await type(side, 'website_group');
  await side.getByRole('button', { name: '选择已打开网页', exact: true }).click();
  await side.getByRole('checkbox', { name: '选择标签页 Keep-open', exact: true }).check();
  await side.getByRole('button', { name: '加入所选网页', exact: true }).click();
  await side.locator('#capture-form [name=title]').fill('保留标签页');
  await side.locator('[name=close_tabs]').uncheck();
  await save(side);
  await side.locator('#records').filter({ hasText: '保留标签页' }).waitFor();
  assert.equal(retained.isClosed(), false);
  pass('用户可以取消保存后关闭，网页仍保留');
  assert.equal(repo.remote.calls.length, 0);
  await a.page.reload();
  await a.page.locator('#records').filter({ hasText: '本周阅读' }).waitFor();
  await a.page.screenshot({ path: path.join(output, 'four-types-dashboard.png'), fullPage: true });
  await configureSync(a.page);
  const b = await launch('b');
  await configureSync(b.page);
  assert.deepEqual(
    (await rows(b.page)).map((r) => r.id).sort(),
    (await rows(a.page)).map((r) => r.id).sort(),
  );
  assert.equal((await rows(b.page)).find((r) => r.id === group.id).record.url_list.length, 3);
  await b.page.locator('.record-snapshot h2').filter({ hasText: 'Snapshot' }).click();
  await b.page.locator('dialog[open] .record-preview').waitFor();
  await b.page
    .locator('dialog[open]')
    .getByRole('button', { name: '加载图片', exact: true })
    .click();
  await b.page.waitForFunction(
    () => document.querySelector('dialog .record-preview img')?.naturalWidth > 0,
  );
  pass('四类数据手动同步，另一浏览器按需获取 PNG 快照');
  const zipDownload = side.waitForEvent('download');
  await side.locator('#panel-save-local').click();
  await side
    .getByRole('dialog', { name: '选择导出整理方式', exact: true })
    .getByRole('button', { name: '开始导出', exact: true })
    .click();
  const zipPath = path.join(output, 'four-types-backup.zip');
  await (await zipDownload).saveAs(zipPath);
  const files = await readZip(new Blob([await readFile(zipPath)]));
  assert.ok(files.has(snapshot.record.attachments[0].path));
  const exportIndex = JSON.parse(new TextDecoder().decode(files.get('export-index.json')));
  assert.match(
    new TextDecoder().decode(files.get(exportIndex.records.find((r) => r.id === list.id).paths[0])),
    /- \[x\] 完成本周整理/,
  );
  assert.match(
    new TextDecoder().decode(
      files.get(exportIndex.records.find((r) => r.id === group.id).paths[0]),
    ),
    /Read-three/,
  );
  pass('完整本地 ZIP 包含快照文件、清单勾选状态及网址组 Markdown');
  await a.context.route('https://types.example/Target-title', (route) =>
    route.fulfill({
      contentType: 'text/html;charset=utf-8',
      body: '<html><head><title>网页原始标题</title><meta property="og:title" content="拖入链接的真实文章标题"></head><body>target</body></html>',
    }),
  );
  await type(side, 'website_group');
  await side.locator('.website-drop-zone').evaluate((node) => {
    const data = new DataTransfer();
    data.setData('text/uri-list', 'https://types.example/Target-title');
    node.dispatchEvent(
      new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
    );
  });
  await side
    .locator('.url-editor .website-title')
    .filter({ hasText: '拖入链接的真实文章标题' })
    .waitFor();
  assert.equal((await side.locator('.url-editor').innerText()).includes('https://'), false);
  assert.equal(
    await side.locator('.url-editor a').first().getAttribute('href'),
    'https://types.example/Target-title',
  );
  await side.locator('.url-editor img').first().scrollIntoViewIfNeeded();
  await side.waitForFunction(() => document.querySelector('.url-editor img')?.naturalWidth > 0);
  pass('已授权的外部链接没有拖拽文字时读取网页标题，以图标＋标题显示，保留原 URL');
  let redundantTitleRequests = 0;
  await a.context.route('https://types.example/Blocked-title', (route) => {
    redundantTitleRequests++;
    return route.fulfill({ status: 403, contentType: 'text/html', body: 'blocked' });
  });
  await side.locator('.website-drop-zone').evaluate((node) => {
    const data = new DataTransfer();
    data.setData('text/uri-list', 'https://types.example/Blocked-title');
    data.setData('text/html', '<a href="https://types.example/Blocked-title">原链接的文章标题</a>');
    node.dispatchEvent(
      new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
    );
  });
  await side
    .locator('.url-editor .website-title')
    .filter({ hasText: '原链接的文章标题' })
    .waitFor();
  assert.equal((await side.locator('.url-editor').innerText()).includes('https://'), false);
  assert.equal(redundantTitleRequests, 0);
  pass('有拖拽文字时直接使用原链接标题，不再次请求网页，也不显示长 URL');
  await type(side, 'list');
  assert.equal(await side.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await side.evaluate(() => (document.querySelector('#toast').className = ''));
  await side.screenshot({ path: path.join(output, 'four-types-sidepanel.png'), fullPage: true });
  assert.deepEqual(errors, []);
  pass('360px 四种入口布局和浏览器异常检查通过');
  await writeFile(
    path.join(output, 'types-browser-report.json'),
    JSON.stringify({ checks }, null, 2),
  );
} finally {
  await repo.close();
  for (const context of contexts) await context.close();
  if (
    !path.resolve(profiles).startsWith(path.resolve(output) + path.sep) ||
    !path.basename(profiles).startsWith('types-profiles-')
  )
    throw new Error('Unexpected cleanup path');
  await rm(profiles, { recursive: true, force: true });
}

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions, authorizedExtension } from './browser-options.mjs';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'collection-profile-'));
const checks = [],
  errors = [];
let context;
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
try {
  const extension = await authorizedExtension(path.resolve('extension'), profile);
  context = await chromium.launchPersistentContext(path.join(profile, 'browser'), {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1360, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const png = await readFile(path.resolve('extension/icons/icon-128.png'));
  await context.route('https://collect.example/**', (route) =>
    route.request().url().endsWith('/image.png')
      ? route.fulfill({ contentType: 'image/png', body: png })
      : route.fulfill({
          contentType: 'text/html;charset=utf-8',
          body: '<title>收集测试页</title><p id="excerpt">页面中当前选中的其他文字</p><a href="https://collect.example/target">有意义的链接文字</a><img src="/image.png" alt="图片说明">',
        }),
  );
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  const control = await context.newPage();
  await control.goto(base + 'dashboard.html');
  await control.locator('#heading').waitFor();
  let side = await context.newPage();
  await side.setViewportSize({ width: 360, height: 1000 });
  await side.goto(base + 'sidepanel.html');
  await side.locator('#capture-form').waitFor();
  await side.locator('[name=title]').fill('连续收集研究笔记');
  await side.locator('[name=content]').fill('这是用户已经写下的正文。');
  const web = await context.newPage();
  await web.goto('https://collect.example/one');
  await web.locator('img').evaluate((image) => image.decode());
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({})).find((tab) => tab.url === 'https://collect.example/one').id,
  );
  const collect = (info) =>
    control.evaluate(
      async ({ info, tabId }) => {
        const result = await chrome.runtime.sendMessage({ type: 'collect-context', info, tabId });
        if (!result?.ok) throw new Error(result?.error || '收集失败');
        return result.id;
      },
      { info: { pageUrl: 'https://collect.example/one', ...info }, tabId },
    );
  const captures = await Promise.all([
    collect({ menuItemId: 'capture-selection', selectionText: '第一段摘录\n第二行' }),
    collect({ menuItemId: 'capture-selection', selectionText: '第二段摘录' }),
    collect({ menuItemId: 'capture-link', linkUrl: 'https://collect.example/target' }),
    collect({ menuItemId: 'capture-image', srcUrl: 'https://collect.example/image.png' }),
  ]);
  await side.waitForFunction(() =>
    document.querySelector('[name=content]')?.value.includes('原图'),
  );
  let content = await side.locator('[name=content]').inputValue();
  assert.match(content, /^这是用户已经写下的正文。/);
  assert.equal((content.match(/^## collected:/gm) || []).length, 1);
  assert.equal((content.match(/^- /gm) || []).length, 4);
  assert.ok(content.indexOf('第一段摘录') < content.indexOf('第二段摘录'));
  assert.match(content, /\[有意义的链接文字\]\(https:\/\/collect.example\/target\)/);
  assert.match(content, /!\[图片说明\]\(assets\/[a-f0-9]{64}\.png\)/);
  pass('快速连续收集文字、链接与图片，保留正文，在单个 collected 区域按顺序追加 bullet');

  await control.evaluate(
    async ({ id }) => {
      const { Database } = await import('./lib/db.js');
      const { newRecord } = await import('./lib/model.js');
      const db = new Database();
      await db.setState('capture:editor', [
        { nonce: id, record: newRecord({ id, content: '不能再次追加' }) },
      ]);
      await db.close();
    },
    { id: captures[0] },
  );
  await side.getByRole('button', { name: '预览', exact: true }).click();
  await side.locator('.markdown .asset-view img').waitFor();
  assert.equal(await side.locator('.markdown a[href="https://collect.example/target"]').count(), 1);
  await control.evaluate(async () => {
    const { markdownPreview } = await import('./lib/dom.js');
    document.body.append(markdownPreview('- ![图片说明](https://collect.example/image.png)'));
  });
  await control.waitForFunction(() => {
    const image = document.querySelector('.markdown-line img');
    return image?.complete && image.naturalWidth > 0;
  });
  await side.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal((await side.locator('[name=content]').inputValue()).includes('不能再次追加'), false);
  pass('收集事件可重试而不重复追加，Markdown 预览显示本机与在线图片、可点击链接');

  await side.close();
  await collect({ menuItemId: 'capture-selection', selectionText: '侧栏关闭时的第五条' });
  await collect({ menuItemId: 'capture-selection', selectionText: '侧栏关闭时的第六条' });
  side = await context.newPage();
  await side.setViewportSize({ width: 360, height: 1000 });
  await side.goto(base + 'sidepanel.html');
  await side.waitForFunction(() =>
    document.querySelector('[name=content]')?.value.includes('第六条'),
  );
  content = await side.locator('[name=content]').inputValue();
  assert.equal((content.match(/^- /gm) || []).length, 6);
  assert.match(content, /第五条[\s\S]*第六条/);
  pass('侧栏关闭时多次收集仍排队持久化，重新打开后全部追加');
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await side.locator('#toast').filter({ hasText: '已保存' }).waitFor();
  const saved = await side.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    try {
      return (await db.allRows()).map((row) => row.record);
    } finally {
      await db.close();
    }
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].attachments.length, 1);
  assert.equal((saved[0].content.match(/^- /gm) || []).length, 6);
  assert.equal(await side.locator('[name=content]').inputValue(), '');
  await side.reload();
  await side.locator('#capture-form').waitFor();
  assert.equal(await side.locator('[name=content]').inputValue(), '');
  pass('混合收集保存为同一记录，图片为本机附件；保存后清空内容且不恢复旧收集');

  await side.locator('#capture-form [data-type=website_group]').click();
  await side.locator('[name=close_tabs]').uncheck();
  await side.locator('[name=website_url]').fill('https://collect.example/manual');
  await side.locator('[name=website_title]').fill('独立网页组');
  await side.getByRole('button', { name: '加入链接', exact: true }).click();
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await side.locator('#toast').filter({ hasText: '已保存' }).waitFor();
  await side.locator('#capture-form [data-type=website_group][aria-selected=true]').waitFor();
  assert.equal(await side.locator('[name=close_tabs]').isChecked(), false);
  assert.equal(await side.locator('.url-editor .url-row').count(), 0);
  await side.reload();
  await side.locator('#capture-form [data-type=website_group][aria-selected=true]').waitFor();
  pass('保存网页组后保留记录类型与关闭标签页偏好，内容清空且刷新仍保留类型');

  const extra = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const page = await context.newPage();
      await page.goto(`https://collect.example/tab-${i}`);
      return page;
    }),
  );
  await side.getByRole('button', { name: '选择已打开网页', exact: true }).click();
  const drawer = side.locator('.tab-drawer');
  await drawer.locator('.tab-row').nth(12).waitFor();
  await drawer.scrollIntoViewIfNeeded();
  await drawer.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const positions = await drawer.evaluate((node) => {
    const drawer = node.getBoundingClientRect(),
      button = node.querySelector('.tab-drawer-actions button').getBoundingClientRect();
    return {
      top: drawer.top,
      bottom: drawer.bottom,
      buttonTop: button.top,
      buttonBottom: button.bottom,
    };
  });
  assert.ok(positions.buttonTop >= positions.top && positions.buttonBottom <= positions.bottom);
  assert.equal(
    await drawer
      .locator('.tab-drawer-actions')
      .getByRole('button', { name: '加入所选网页', exact: true })
      .count(),
    1,
  );
  await side.screenshot({ path: path.join(output, 'collection-top-actions.png') });
  for (const page of extra) await page.close();
  pass('网页选择操作位于顶部，列表滚到底部后按钮仍在列表可见范围内');

  const dashboard = await context.newPage();
  await dashboard.goto(base + 'dashboard.html');
  await dashboard.locator('#heading').waitFor();
  await dashboard.getByRole('button', { name: '新增项目', exact: true }).click();
  let dialog = dashboard.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('研究项目');
  await dialog.getByRole('button', { name: '保存项目', exact: true }).click();
  await dashboard.locator('#projects-nav .project-nav').waitFor();
  const card = dashboard.locator(`#records [data-record-id="${saved[0].id}"]`);
  await card.getByRole('button', { name: '加入项目…', exact: true }).click();
  dialog = dashboard.getByRole('dialog', { name: '加入项目', exact: true });
  await dialog.getByRole('checkbox', { name: '研究项目', exact: true }).check();
  await dialog.getByRole('button', { name: '加入项目', exact: true }).click();
  await dashboard
    .locator('#projects-nav')
    .getByRole('button', { name: '📁  研究项目', exact: true })
    .click();
  await card.waitFor();
  assert.equal(
    await dashboard.getByRole('checkbox', { name: '查看关键词建议', exact: true }).count(),
    0,
  );
  assert.equal(await card.getByRole('button', { name: '标记已整理', exact: true }).count(), 1);
  await dashboard.screenshot({ path: path.join(output, 'collection-project-members.png') });
  pass('不设置关键词也能创建项目并手动加入记录，项目默认显示已关联且不改变整理状态');
  await dashboard.getByRole('button', { name: '新增项目', exact: true }).click();
  dialog = dashboard.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('资料整理');
  await dialog.getByRole('button', { name: '保存项目', exact: true }).click();
  await card.getByRole('checkbox', { name: '选择 连续收集研究笔记', exact: true }).check();
  await dashboard
    .locator('#selection-bar')
    .getByRole('button', { name: '加入项目…', exact: true })
    .click();
  dialog = dashboard.getByRole('dialog', { name: '加入项目', exact: true });
  await dialog.getByRole('checkbox', { name: '资料整理', exact: true }).check();
  await dialog.getByRole('button', { name: '加入项目', exact: true }).click();
  await dashboard.locator('#nav [data-view=all]').click();
  const projectTarget = dashboard
    .locator('#projects-nav .project-nav')
    .filter({ hasText: '资料整理' });
  await dashboard.locator('#records .record-website_group').dragTo(projectTarget);
  await projectTarget.getByRole('button', { name: '📁  资料整理', exact: true }).click();
  await card.waitFor();
  await dashboard.locator('#records .record-website_group').waitFor();
  await dashboard
    .locator('#projects-nav')
    .getByRole('button', { name: '📁  研究项目', exact: true })
    .click();
  await card.waitFor();
  pass('批量加入项目保留已有项目关联，记录也可直接拖入项目');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'collection-browser-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(`PASS ${checks.length} collection checks`);
} catch (error) {
  console.error(errors);
  for (const [i, page] of (context?.pages() || []).entries())
    if (page.url().includes('chrome-extension://')) {
      await page
        .screenshot({ path: path.join(output, `collection-failure-${i}.png`) })
        .catch(() => {});
      console.error(
        await page
          .locator('#toast')
          .innerText()
          .catch(() => ''),
      );
    }
  throw error;
} finally {
  await context?.close();
  if (path.dirname(profile) !== output) throw new Error('Unexpected cleanup path');
  await rm(profile, { recursive: true, force: true });
}

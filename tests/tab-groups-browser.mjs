import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'tab-groups-'));
const checks = [],
  errors = [];
let context, page;
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
const poll = async (read) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Browser state did not settle');
};
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<title>本地网页 ${req.url}</title><h1>网页组测试</h1>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const extension = path.resolve('dist/pkm-nexus');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1440, height: 1050 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', (target) => target.on('pageerror', (error) => errors.push(error.message)));
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  page = await context.newPage();
  await page.goto(base + 'dashboard.html');
  const ids = await page.evaluate(async (origin) => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const { EXAMPLES_VISIBLE } = await import('./lib/examples.js');
    const db = new Database();
    await db.setState(EXAMPLES_VISIBLE, false);
    const list = newRecord({
      type: 'list',
      list: [
        {
          id: 'todo-link',
          kind: 'item',
          text: `参考资料 ${origin}/todo?x=1#inbox/F123`,
          is_checkbox: true,
          checked: false,
        },
        {
          id: 'idea-link',
          kind: 'item',
          text: `[想法文档](${origin}/idea)`,
          is_checkbox: false,
          checked: false,
        },
        {
          id: 'plain-html',
          kind: 'item',
          text: '<img src=x onerror=alert(1)> [危险](javascript:alert(1))',
          is_checkbox: false,
          checked: false,
        },
      ],
    });
    const group = newRecord({
      type: 'website_group',
      title: '完整研究网页组',
      url_list: Array.from({ length: 12 }, (_, i) => ({
        id: `web-${i}`,
        url: `${origin}/saved-${i}`,
        title: `完整网页 ${i}`,
        added_at: new Date().toISOString(),
        read_at: null,
        ...(i === 11 ? { removed_at: new Date().toISOString() } : {}),
      })),
      schema_version: 5,
    });
    await db.save(list);
    await db.save(group);
    await db.close();
    return { list: list.id, group: group.id };
  }, origin);
  await page.reload();
  const groupCard = page.locator(`#records [data-record-id="${ids.group}"]`);
  const scroll = groupCard.locator('.website-card-list');
  await groupCard.locator('[data-website-id=web-10]').waitFor();
  assert.equal(await scroll.locator('.website-preview-line').count(), 12);
  assert.ok(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight));
  await scroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  assert.ok(await scroll.evaluate((node) => node.scrollTop > 0));
  await groupCard.locator('[data-website-id=web-10] input').check();
  await page.waitForFunction(async (id) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const row = await db.get(id);
    await db.close();
    return !!row.record.url_list[10].read_at;
  }, ids.group);
  await groupCard.locator('[data-website-id=web-10].completed').waitFor();
  assert.ok(
    await scroll.evaluate((node) => node.scrollTop > 0),
    'Reading a later website must preserve the group scroll position',
  );
  await page.screenshot({ path: path.join(output, 'website-group-scroll.png') });
  pass('整理页读取完整网页组，五条以后的网页可以滚动、阅读和操作');

  const beforeGroups = await worker.evaluate(async () => [
    ...new Set((await chrome.tabs.query({})).map((tab) => tab.groupId).filter((id) => id >= 0)),
  ]);
  await groupCard.getByRole('button', { name: '打开全部', exact: true }).click();
  const opened = await poll(() =>
    worker.evaluate(async (name) => {
      const ids = [
        ...new Set((await chrome.tabs.query({})).map((tab) => tab.groupId).filter((id) => id >= 0)),
      ];
      const group = (await Promise.all(ids.map((id) => chrome.tabGroups.get(id)))).find(
        (group) => group.title === name,
      );
      if (!group) return null;
      const tabs = await chrome.tabs.query({ groupId: group.id });
      return { group, tabs };
    }, '完整研究网页组'),
  );
  assert.ok(opened);
  assert.equal(beforeGroups.includes(opened.group.id), false);
  assert.deepEqual(
    opened.tabs.sort((a, b) => a.index - b.index).map((tab) => tab.pendingUrl || tab.url),
    Array.from({ length: 11 }, (_, i) => `${origin}/saved-${i}`),
  );
  assert.equal(opened.group.collapsed, false);
  assert.ok(opened.tabs.every((tab) => tab.groupId === opened.group.id));
  await worker.evaluate(
    (ids) => chrome.tabs.remove(ids),
    opened.tabs.map((tab) => tab.id),
  );
  pass('真实 Chrome API 新建同名标签页组，按顺序打开全部十一页，包含已读并排除已删除网页');

  const native = await worker.evaluate(async (origin) => {
    const tabs = [];
    for (let i = 0; i < 3; i++)
      tabs.push(await chrome.tabs.create({ url: `${origin}/capture-${i}`, active: false }));
    const groupId = await chrome.tabs.group({ tabIds: tabs.map((tab) => tab.id) });
    await chrome.tabGroups.update(groupId, { title: '活动采集组', color: 'blue' });
    const other = await chrome.tabs.create({ url: `${origin}/unrelated`, active: false });
    const otherId = await chrome.tabs.group({ tabIds: [other.id] });
    await chrome.tabGroups.update(otherId, { title: '别的组' });
    return { groupId, ids: tabs.map((tab) => tab.id), otherId, otherTab: other.id };
  }, origin);
  const side = await context.newPage();
  await side.goto(base + 'sidepanel.html');
  await side.getByRole('tab', { name: '网页组', exact: true }).click();
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), native.ids[0]);
  // A real side panel leaves its source webpage active. Evaluate the click on this
  // inactive test tab to reproduce that behavior without changing the active tab.
  await side
    .getByRole('button', { name: '收集活动标签页组', exact: true })
    .evaluate((button) => button.click());
  await side.waitForFunction(() => document.querySelector('[name=title]')?.value === '活动采集组');
  assert.equal(await side.locator('.url-editor .url-row').count(), 3);
  assert.equal(await side.locator('[name=close_tabs]').isChecked(), false);
  await side.locator('#capture-form button[type=submit]').click();
  await side.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const found = (await db.allCatalog()).find((row) => row.title === '活动采集组');
    await db.close();
    return !!found;
  });
  const saved = await side.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const entry = (await db.allCatalog()).find((row) => row.title === '活动采集组');
    const row = await db.get(entry.id);
    await db.close();
    return row.record;
  });
  assert.deepEqual(
    saved.url_list.map((item) => item.url),
    Array.from({ length: 3 }, (_, i) => `${origin}/capture-${i}`),
  );
  assert.equal(
    (await worker.evaluate((id) => chrome.tabs.query({ groupId: id }), native.groupId)).length,
    3,
  );
  await side.close();
  pass('侧栏直接收集活动浏览器组，采用组名和三条网页，保存后原标签页与其他组保留');

  await page.bringToFront();
  await page.locator('#new').click();
  const editor = page.locator('#editor-form');
  await editor.getByRole('tab', { name: '网页组', exact: true }).click();
  await editor.getByRole('button', { name: '收集活动标签页组', exact: true }).click();
  await editor.locator('.browser-group-choice').filter({ hasText: '活动采集组' }).click();
  assert.equal(await editor.locator('[name=title]').inputValue(), '活动采集组');
  assert.equal(await editor.locator('.url-row').count(), 3);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  pass('整理页占据活动标签页时可选择窗口内的浏览器组，不混入其他组');

  await page.goto(base + 'start.html');
  const todo = page.locator('#todo-items .start-task').filter({ hasText: '参考资料' });
  const url = `${origin}/todo?x=1#inbox/F123`;
  const todoLink = todo.locator('.task-text a');
  assert.equal(await todoLink.getAttribute('href'), url);
  assert.equal(
    await page
      .locator('#idea-items .task-text')
      .getByRole('link', { name: '想法文档', exact: true })
      .getAttribute('href'),
    `${origin}/idea`,
  );
  const popupPromise = page.waitForEvent('popup');
  await todoLink.click();
  const popup = await popupPromise;
  await popup.waitForURL(url);
  await popup.close();
  assert.equal(await todo.locator('input[type=checkbox]').isChecked(), false);
  assert.equal(await todo.locator('.task-inline-editor').count(), 0);
  assert.equal(
    await page.locator('#idea-items img[src=x], #idea-items a[href^="javascript:"]').count(),
    0,
  );
  await todo.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('Todo 内容', { exact: true })
    .fill(`参考资料 [验证文档](${origin}/updated#new)`);
  await page.getByLabel('Todo 内容', { exact: true }).press('Enter');
  await todo.getByRole('link', { name: '验证文档', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'todo-idea-links.png') });
  pass('Todo 与 Idea 的原始和 Markdown 链接可直接点击，保留片段，不误勾选或进入编辑，仍可修改');

  await page.goto(base + `dashboard.html?new=list`);
  await page
    .locator('[data-list-item-id=todo-link] .list-item-links')
    .getByRole('link', { name: '验证文档', exact: true })
    .waitFor();
  const text = page.locator('[data-list-item-id=todo-link] input[type=text]');
  await text.fill(`更新 ${origin}/live-link`);
  await page
    .locator('[data-list-item-id=todo-link] .list-item-links a')
    .filter({ hasText: '/live-link' })
    .waitFor();
  await page.locator('#editor-form button[type=submit]').click();
  await page.locator('#editor-form').waitFor({ state: 'detached' });
  await page.goto(base + `dashboard.html?record=${ids.list}`);
  await page
    .getByRole('dialog', { name: '预览记录', exact: true })
    .getByRole('link', { name: `${origin}/live-link`, exact: true })
    .waitFor();
  pass('清单编辑器实时生成可点击链接，保存后记录预览保留相同链接');
  await page
    .getByRole('dialog', { name: '预览记录', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.setViewportSize({ width: 420, height: 900 });
  await page.screenshot({ path: path.join(output, 'website-group-narrow.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'tab-groups-browser-report.json'),
    JSON.stringify(
      { checks, errors, browserTabGroups: 'real-chrome-api', websites: 'local-http-fixtures' },
      null,
      2,
    ),
  );
} catch (error) {
  for (const [index, target] of (context?.pages() || []).entries())
    await target
      .screenshot({ path: path.join(output, `tab-groups-failure-${index}.png`) })
      .catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  if (!profile.startsWith(output + path.sep) || !path.basename(profile).startsWith('tab-groups-'))
    throw new Error('Unexpected fixture path');
  await rm(profile, { recursive: true, force: true });
}

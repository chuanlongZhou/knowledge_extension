import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(output, 'start-page-')),
  contexts = [],
  checks = [],
  errors = [];
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
const poll = async (predicate) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Condition timed out');
};
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>常用工作台</title><h1>普通网页</h1>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let page;
try {
  async function device(name) {
    const extension = path.resolve('dist/pkm-nexus');
    const context = await chromium.launchPersistentContext(path.join(root, name), {
      ...browserOptions(),
      headless: true,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1100 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    contexts.push(context);
    context.setDefaultTimeout(15000);
    context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${worker.url().split('/')[2]}/`;
    const welcome = await poll(() =>
      context.pages().find((p) => p.url() === base + 'welcome.html'),
    );
    return { context, worker, base, welcome };
  }
  const { context, worker, base, welcome } = await device('main');
  page = welcome;
  assert.equal(
    await worker.evaluate(() => chrome.runtime.getManifest().chrome_url_overrides?.newtab),
    'start.html',
  );
  const original = await worker.evaluate(() => chrome.tabs.create({ active: false }));
  await poll(
    async () =>
      (await worker.evaluate((id) => chrome.tabs.get(id), original.id)).title ===
      'GUGA Knowledge · 新的一页',
  );
  await context
    .pages()
    .find((p) => p.url() === base + 'start.html')
    .locator('#todo-input')
    .waitFor();
  await worker.evaluate((id) => chrome.tabs.remove(id), original.id);
  await welcome.getByRole('link', { name: '打开启动页', exact: true }).click();
  await welcome.waitForURL(base + 'start.html');
  await welcome.locator('#todo-input').waitFor();
  const native = await worker.evaluate(() => chrome.tabs.create({ active: false }));
  await poll(
    async () =>
      (await worker.evaluate((id) => chrome.tabs.get(id), native.id)).title ===
      'GUGA Knowledge · 新的一页',
  );
  await worker.evaluate((id) => chrome.tabs.remove(id), native.id);
  const web = await worker.evaluate(
    (url) => chrome.tabs.create({ url, active: false }),
    origin + '/normal',
  );
  await poll(
    async () =>
      (await worker.evaluate((id) => chrome.tabs.get(id), web.id)).url === origin + '/normal',
  );
  await worker.evaluate((id) => chrome.tabs.remove(id), web.id);
  pass('manifest 使用官方 URL Overrides；新建空白标签页直接进入启动页，普通网站链接保留原网址');

  const ids = await page.evaluate(async (origin) => {
    const { Database } = await import('./lib/db.js'),
      { newRecord } = await import('./lib/model.js'),
      { listDocument } = await import('./lib/collections.js');
    const db = new Database();
    const project = newRecord({
      schema_version: 5,
      type: 'project',
      title: '研究计划',
      summary: '把零散的发现，连成自己的理解。',
      appearance: { icon: '📚', color: '#3e6868' },
    });
    const child = newRecord({
      schema_version: 5,
      type: 'project',
      title: '阅读与摘录',
      summary: '值得再读一次的文章与资料。',
      parent_project_id: project.id,
      appearance: { icon: '🌱', color: '#677d6a' },
    });
    const other = newRecord({
      schema_version: 5,
      type: 'project',
      title: '生活灵感',
      summary: '收集那些让日常变得有趣的小事。',
      appearance: { icon: '✧', color: '#c94e44' },
    });
    const titles = [
      '如何建立自己的知识系统',
      '慢一点，留意生活里的细节',
      '一篇值得收藏的设计笔记',
      '从阅读到行动的几个方法',
      '关于创造力的日常练习',
      '把复杂的事情讲清楚',
      '收集网页，也收集想法',
      '留给周末的一点好奇心',
      '让项目成为知识的连接',
      '阅读中的一闪而过',
      '关于时间和专注',
      '我的长期阅读计划',
    ];
    const favorites = titles.map((title, i) =>
      newRecord({
        title,
        schema_version: 5,
        favorite: true,
        content: '保存下这段值得反复阅读的内容。',
        summary: '把有价值的内容留下，在需要的时候重新遇见。',
        tags: [i % 2 ? '设计' : '阅读'],
        project_ids: i === 0 ? [project.id] : [],
        created_at: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        updated_at: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        sources: [
          {
            url: `${origin}/article/${i}`,
            title,
            captured_at: new Date().toISOString(),
            kind: 'web_page',
          },
        ],
      }),
    );
    const group = newRecord({
      type: 'website_group',
      title: '周末慢慢读',
      url_list: Array.from({ length: 4 }, (_, i) => ({
        id: crypto.randomUUID(),
        title: ['设计里的留白', '给灵感留一点时间', '重新理解阅读', '已经看完的网页'][i],
        url: `${origin}/read/${i}`,
        added_at: new Date().toISOString(),
        read_at: i === 3 ? new Date().toISOString() : null,
      })),
    });
    const item = (text, is_checkbox) => ({
      id: crypto.randomUUID(),
      kind: 'item',
      text,
      is_checkbox,
      checked: false,
    });
    const items = [
      item('整理这一周的阅读笔记', true),
      item('给研究计划加一条新线索', true),
      item('周末出去走走', true),
      item('如果用一张卡片记录一天？', false),
      item('做一个自己的小型灵感花园', false),
    ];
    const list = newRecord({
      type: 'list',
      list: items,
      content: listDocument(items, '保留已有清单备注', []),
    });
    await db.saveMany(
      [project, child, other, group, list, ...favorites].map((record) => ({ record })),
    );
    await db.close();
    return { project: project.id, note: favorites[0].id, pin: favorites.at(-1).id };
  }, origin);
  await poll(async () => (await page.locator('#favorite-cards .favorite-card').count()) === 8);
  assert.equal(await page.locator('#group-cards .group-card').count(), 1);
  assert.match(await page.locator('#group-cards').innerText(), /3 待浏览/);
  assert.equal(await page.locator('#project-cards .project-card').count(), 2);
  assert.doesNotMatch(await page.locator('#project-cards').innerText(), /阅读与摘录/);
  await page.getByLabel('添加 Todo', { exact: true }).fill('启动页新增待办');
  await page.getByRole('button', { name: '保存 Todo', exact: true }).click();
  await page
    .locator('#todo-items')
    .getByRole('button', { name: '启动页新增待办', exact: true })
    .click();
  await page
    .locator('#todo-items')
    .getByLabel('Todo 内容', { exact: true })
    .fill('启动页修改后的待办');
  await page.locator('#todo-items').getByLabel('Todo 内容', { exact: true }).press('Enter');
  await page.getByLabel('完成 启动页修改后的待办', { exact: true }).check();
  await page.getByLabel('添加 Idea', { exact: true }).fill('记录一个新想法');
  await page.getByRole('button', { name: '保存 Idea', exact: true }).click();
  await page
    .locator('#idea-items')
    .getByRole('button', { name: '记录一个新想法', exact: true })
    .click();
  await page.locator('#idea-items').getByLabel('Idea 内容', { exact: true }).fill('修改后的想法');
  await page.locator('#idea-items').getByLabel('Idea 内容', { exact: true }).press('Enter');
  await poll(() =>
    page.evaluate(async () => {
      const { Database } = await import('./lib/db.js');
      const db = new Database();
      const row = await db.get('nexus-list');
      await db.close();
      return (
        row.record.list.some((i) => i.text === '启动页修改后的待办' && i.checked) &&
        row.record.list.some((i) => i.text === '修改后的想法') &&
        row.record.content.includes('保留已有清单备注')
      );
    }),
  );
  pass('Todo / Idea 分开显示并可新增、编辑与完成；共用原清单，保留另一分区和已有备注');

  await page.getByLabel('添加 Todo', { exact: true }).fill('---');
  await page.getByRole('button', { name: '保存 Todo', exact: true }).click();
  await page.locator('#todo-items .start-divider').waitFor();
  assert.equal(await page.locator('#todo-items .start-divider input').count(), 0);
  await page.getByLabel('添加 Idea', { exact: true }).fill('---');
  await page.getByRole('button', { name: '保存 Idea', exact: true }).click();
  await page.locator('#idea-items .start-divider').waitFor();
  await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { editStartList } = await import('./lib/start-list.js');
    const db = new Database();
    await editStartList(db, (list) => [
      ...list,
      ...Array.from({ length: 16 }, (_, index) => ({
        id: crypto.randomUUID(),
        kind: 'item',
        text: `滚动条目 ${index}`,
        is_checkbox: false,
        checked: false,
      })),
    ]);
    await db.close();
  });
  await page
    .locator('#idea-items .start-task')
    .last()
    .getByRole('button', { name: '滚动条目 15', exact: true })
    .waitFor();
  assert.equal(
    await page.locator('#idea-items').evaluate((node) => node.scrollHeight > node.clientHeight),
    true,
  );
  await page.locator('#idea-items').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  assert.equal(await page.locator('#idea-items').evaluate((node) => node.scrollTop > 0), true);
  await page.getByRole('button', { name: '删除 Todo 分隔线' }).click();
  await page.locator('#todo-items .start-divider').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '删除 Idea 分隔线' }).click();
  await page.locator('#idea-items .start-divider').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '删除 Idea 滚动条目 15' }).click();
  await page
    .getByRole('button', { name: '滚动条目 15', exact: true })
    .waitFor({ state: 'detached' });
  await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { editStartList } = await import('./lib/start-list.js');
    const db = new Database();
    await editStartList(db, (list) => [
      ...list,
      { id: crypto.randomUUID(), kind: 'item', text: '---', is_checkbox: true, checked: false },
    ]);
    await db.close();
  });
  await page.locator('#todo-items .start-divider').waitFor();
  assert.match(await page.locator('#todo-count').innerText(), /^3 /);
  await page.getByRole('button', { name: '删除 Todo 分隔线' }).click();
  await page.locator('#todo-items .start-divider').waitFor({ state: 'detached' });
  pass('启动页显示完整可滚动清单，新旧 --- 均为可删除的分隔线，条目也可直接删除');

  await page
    .locator('#project-cards')
    .getByRole('button', { name: '查看 研究计划', exact: true })
    .click();
  const projectDialog = page.getByRole('dialog', { name: '研究计划', exact: true });
  await projectDialog
    .getByRole('button', { name: '查看 如何建立自己的知识系统', exact: true })
    .click();
  const preview = page.getByRole('dialog', { name: '记录详情', exact: true });
  await preview.getByText('保存下这段值得反复阅读的内容。', { exact: true }).waitFor();
  assert.match(
    await preview.getByRole('link', { name: '编辑记录 ↗', exact: true }).getAttribute('href'),
    new RegExp(ids.note),
  );
  const editOpened = context.waitForEvent('page');
  await preview.getByRole('link', { name: '编辑记录 ↗', exact: true }).click();
  const editorPage = await editOpened;
  await editorPage.getByRole('dialog', { name: '编辑记录', exact: true }).waitFor();
  assert.equal(
    await editorPage
      .getByRole('dialog', { name: '编辑记录', exact: true })
      .locator('[name=title]')
      .inputValue(),
    '如何建立自己的知识系统',
  );
  await editorPage.mouse.click(3, 3);
  await editorPage
    .getByRole('dialog', { name: '编辑记录', exact: true })
    .waitFor({ state: 'detached' });
  await editorPage.close();
  await page.mouse.click(3, 3);
  await preview.waitFor({ state: 'detached' });
  await projectDialog.waitFor();
  await projectDialog.getByRole('button', { name: '查看 阅读与摘录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '阅读与摘录', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await projectDialog.getByRole('button', { name: '关闭', exact: true }).click();
  pass('喜欢网页和项目详情可逐层展开；启动页与整理页弹窗点击外部关闭，嵌套弹窗保留父层');

  await page
    .locator('#favorite-cards')
    .getByRole('button', { name: '查看 我的长期阅读计划' })
    .click();
  let dialog = page.getByRole('dialog', { name: '记录详情', exact: true });
  await dialog.getByRole('button', { name: '置顶', exact: true }).click();
  await page.locator('#pinned-cards .pinned-card').first().waitFor();
  assert.equal(
    await page.locator('#pinned-cards .pinned-card').first().getAttribute('data-record-id'),
    ids.pin,
  );
  await page
    .getByRole('dialog', { name: '记录详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.screenshot({ path: path.join(output, 'guga-start-pinned.png'), fullPage: true });
  await page.reload();
  await page.locator('#pinned-cards .pinned-card').first().waitFor();
  await page.locator('#pinned-cards .pinned-card').first().click();
  dialog = page.getByRole('dialog', { name: '记录详情', exact: true });
  await dialog.getByRole('button', { name: '取消置顶', exact: true }).click();
  await page.locator('#pinned-section').waitFor({ state: 'hidden' });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  pass('记录可在启动页置顶和取消置顶；置顶区优先展示且跨刷新保留');

  for (const [name, url] of [
    ['常用文档', 'docs.example.test'],
    ['我的工作台', origin],
  ]) {
    await page.getByRole('button', { name: '添加常用网站', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '添加常用网站', exact: true });
    await dialog.getByLabel('网站名称', { exact: true }).fill(name);
    await dialog.getByLabel('网站地址', { exact: true }).fill(url);
    await dialog.getByRole('button', { name: '保存网站', exact: true }).click();
    await page.locator('#site-dock').getByRole('link', { name, exact: true }).waitFor();
  }
  await page.getByRole('button', { name: '管理常用网站', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '管理常用网站', exact: true });
  await dialog
    .getByRole('button', { name: '拖动排序网站 我的工作台', exact: true })
    .dragTo(dialog.locator('.dock-edit-row').filter({ hasText: '常用文档' }), {
      targetPosition: { x: 20, y: 5 },
    });
  await poll(
    async () => (await page.locator('#site-dock .dock-link').allTextContents())[0] === '我的工作台',
  );
  assert.equal(await dialog.isVisible(), true);
  assert.match(await dialog.locator('.dock-edit-row').first().innerText(), /我的工作台/);
  await page
    .getByRole('dialog', { name: '管理常用网站', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.reload();
  await page.locator('#site-dock').getByRole('link', { name: '我的工作台', exact: true }).waitFor();
  assert.equal((await page.locator('#site-dock .dock-link').allTextContents())[0], '我的工作台');
  await page.screenshot({ path: path.join(output, 'guga-start-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 950 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(output, 'guga-start-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  pass('Dock 可添加网站、调整顺序并在刷新后保留；桌面和 360px 启动页无横向溢出');

  const settingsPage = await context.newPage();
  await settingsPage.goto(base + 'dashboard.html#settings');
  const settings = settingsPage.getByRole('dialog', { name: '设置与数据管理', exact: true });
  await settings.getByLabel('启动页喜爱网页数量', { exact: true }).selectOption('5');
  await poll(async () => (await page.locator('#favorite-cards .favorite-card').count()) === 5);
  assert.equal(
    await settings.getByLabel('使用 GUGA 启动页作为新标签页', { exact: true }).count(),
    0,
  );
  // A saved preference from an older release cannot change the native override.
  await worker.evaluate(() =>
    chrome.storage.local.set({ startPage: { enabled: true, decided: true, favoritesLimit: 5 } }),
  );
  const opened = context.waitForEvent('page');
  await settings.getByRole('button', { name: '打开新标签页', exact: true }).click();
  const startPreview = await opened;
  await startPreview.waitForURL(base + 'start.html');
  await startPreview.locator('#todo-input').waitFor();
  await startPreview.close();
  const disabledTab = await worker.evaluate(() => chrome.tabs.create({ active: false }));
  await poll(
    async () =>
      (await worker.evaluate((id) => chrome.tabs.get(id), disabledTab.id)).title ===
      'GUGA Knowledge · 新的一页',
  );
  await worker.evaluate((id) => chrome.tabs.remove(id), disabledTab.id);
  await settingsPage.close();
  pass('设置可调整喜爱卡片数量并打开真正的新标签页；旧版偏好不改变原生替换');

  const sorting = await context.newPage();
  // Seed before opening the organizer: its initial render persists the restored
  // view and could otherwise race the fixture's session preference write.
  await sorting.goto(base + 'start.html');
  const sortIds = await sorting.evaluate(async () => {
    const { Database } = await import('./lib/db.js'),
      { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const notes = [3, 2, 1].map((n) =>
      newRecord({
        title: `排序记录${n}`,
        created_at: `2024-01-0${n}T00:00:00.000Z`,
        updated_at: `2029-01-0${n}T00:00:00.000Z`,
        organization_state: 'organized',
        tags: [n === 1 ? 'Alpha' : 'Beta'],
      }),
    );
    await db.saveMany(notes.map((record) => ({ record })));
    await db.close();
    await chrome.storage.session.set({
      'ui:dashboard': {
        view: 'all',
        query: '',
        tag: '',
        type: '',
        project: '',
        limit: 3,
        sortMode: 'updated_at',
        sortDirection: 'desc',
      },
    });
    return notes.map((r) => r.id);
  });
  await sorting.goto(base + 'dashboard.html');
  const rootProjects = sorting.locator('#projects-nav > .project-branch > .project-nav');
  await poll(async () => (await rootProjects.count()) === 2);
  const rootIds = await rootProjects.evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.projectId),
  );
  await sorting
    .locator(`.project-nav[data-project-id="${rootIds[1]}"] .project-drag-handle`)
    .dragTo(sorting.locator(`.project-nav[data-project-id="${rootIds[0]}"]`), {
      targetPosition: { x: 25, y: 5 },
    });
  await poll(
    async () => (await rootProjects.first().getAttribute('data-project-id')) === rootIds[1],
  );
  await sorting.reload();
  assert.equal(await rootProjects.first().getAttribute('data-project-id'), rootIds[1]);
  const recordIds = () =>
    sorting
      .locator('#records > article')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.recordId));
  await poll(
    async () => (await recordIds()).join() === ['nexus-list', sortIds[0], sortIds[1]].join(),
  );
  await sorting.locator(`#records [data-record-id="${sortIds[1]}"] .record-main`).click();
  await sorting
    .getByRole('dialog', { name: '预览记录', exact: true })
    .getByRole('button', { name: '完整修改', exact: true })
    .click();
  dialog = sorting.getByRole('dialog', { name: '编辑记录', exact: true });
  await dialog.locator('[name=title]').fill('编辑后仍留在原位');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await sorting
    .locator(`#records [data-record-id="${sortIds[1]}"]`)
    .filter({ hasText: '编辑后仍留在原位' })
    .waitFor();
  assert.deepEqual(await recordIds(), ['nexus-list', sortIds[0], sortIds[1]]);
  assert.match(await sorting.locator('#order-hint').innerText(), /下次进入/);
  await sorting.reload();
  await poll(
    async () => (await recordIds()).join() === ['nexus-list', sortIds[0], sortIds[2]].join(),
  );
  await sorting.evaluate(async (id) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    await db.mutate(id, (r) => ({
      ...r,
      title: '再次编辑但先不重排',
      updated_at: new Date().toISOString(),
    }));
    await db.close();
  }, sortIds[0]);
  await sorting
    .locator(`#records [data-record-id="${sortIds[0]}"]`)
    .filter({ hasText: '再次编辑但先不重排' })
    .waitFor();
  assert.deepEqual(await recordIds(), ['nexus-list', sortIds[0], sortIds[2]]);
  await sorting.getByRole('button', { name: '重新排序', exact: true }).click();
  await poll(
    async () => (await recordIds()).join() === ['nexus-list', sortIds[2], sortIds[0]].join(),
  );
  await sorting.locator('#load-more').click();
  await poll(async () => (await sorting.locator('#records > article').count()) > 3);
  assert.deepEqual((await recordIds()).slice(0, 3), ['nexus-list', sortIds[2], sortIds[0]]);
  for (const mode of ['created_at', 'tag', 'project', 'title']) {
    await sorting.getByLabel('记录排序方式', { exact: true }).selectOption(mode);
    await poll(() =>
      sorting.evaluate(
        async (mode) =>
          (await chrome.storage.local.get('recordSort')).recordSort?.mode === mode &&
          (await chrome.storage.session.get('ui:dashboard'))['ui:dashboard']?.sortMode === mode,
        mode,
      ),
    );
  }
  await sorting.reload();
  await poll(
    async () =>
      (await sorting.getByLabel('记录排序方式', { exact: true }).inputValue()) === 'title',
  );
  await sorting.screenshot({ path: path.join(output, 'guga-record-sorting.png') });
  pass(
    '真实编辑后分页中的卡片保持位置；重进页面及主动重新排序才应用修改时间，加载更多保留已有顺序，五种排序偏好可恢复',
  );

  const fresh = await device('fresh');
  await fresh.welcome.getByRole('link', { name: '打开整理页 ↗', exact: true }).click();
  await fresh.welcome.waitForURL(fresh.base + 'dashboard.html');
  pass('首次欢迎页也可直接进入整理页，无需选择新标签页偏好');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'start-page-browser-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  for (const [i, ctx] of contexts.entries())
    for (const [j, p] of ctx.pages().entries())
      await p
        .screenshot({ path: path.join(output, `start-failure-${i}-${j}.png`) })
        .catch(() => {});
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await new Promise((resolve) => server.close(resolve));
  if (!root.startsWith(output + path.sep) || !path.basename(root).startsWith('start-page-'))
    throw new Error('Unexpected profile path');
  await rm(root, { recursive: true, force: true });
}

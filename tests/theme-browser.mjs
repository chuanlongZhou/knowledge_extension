import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'theme-profile-'));
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
  const page = await context.newPage(),
    side = await context.newPage();
  for (const p of [page, side]) p.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + 'dashboard.html');
  await page.locator('#heading').waitFor();
  const ids = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const parent = newRecord({
      schema_version: 5,
      type: 'project',
      title: '主题测试项目',
      summary: '顶层项目描述',
      graph: { edges: [] },
    });
    const child = newRecord({
      schema_version: 5,
      type: 'project',
      title: '子项目',
      summary: '旧子项目描述',
      appearance: { color: '#2764b7', icon: '📚' },
      parent_project_id: parent.id,
      graph: { edges: [] },
    });
    const note = newRecord({
      title: '图中记录',
      content: '保留的正文',
      summary: '旧人工总结',
      tags: ['旧标签', '保留'],
      project_ids: [parent.id],
    });
    const group = newRecord({
      type: 'website_group',
      title: '网页记录',
      summary: '',
      project_ids: [parent.id],
      url_list: [
        {
          id: crypto.randomUUID(),
          url: 'https://example.com',
          title: '网站',
          added_at: new Date().toISOString(),
          read_at: null,
        },
      ],
    });
    const childNote = newRecord({
      title: '子项目内记录',
      content: '子项目原内容',
      project_ids: [child.id],
    });
    await db.saveMany([parent, child, note, group, childNote].map((record) => ({ record })));
    await db.setState('draft:test', { record: { ...note, id: crypto.randomUUID() }, ui: {} });
    await db.close();
    return {
      parent: parent.id,
      child: child.id,
      note: note.id,
      group: group.id,
      childNote: childNote.id,
    };
  });
  await page.locator('#tags-nav [data-tag="旧标签"]').waitFor();
  assert.equal(await page.locator('.sidebar-note').count(), 0);
  await page.mouse.move(800, 20);
  await page.waitForFunction(
    () => !document.querySelector('.brand-penguin').classList.contains('animate-penguin'),
  );
  const penguin = page.locator('.sidebar .brand-penguin');
  await page.bringToFront();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(
    () =>
      !document.querySelector('.sidebar .brand-penguin').classList.contains('animate-penguin') &&
      getComputedStyle(document.querySelector('.sidebar .brand-penguin')).transform === 'none',
  );
  await page.locator('#nav [data-view=pending]').hover();
  const scales = await penguin.evaluate(async (node) => {
    const samples = [];
    for (let i = 0; i < 28; i++) {
      await new Promise(requestAnimationFrame);
      const transform = getComputedStyle(node).transform;
      samples.push(transform === 'none' ? 1 : Number(transform.split('(')[1].split(',')[0]));
    }
    return samples;
  });
  assert.ok(
    scales.some((scale) => scale > 1 && scale < 1.3),
    '企鹅进入导航时应有平滑过渡的中间帧',
  );
  await page.waitForFunction(
    () =>
      Number(
        getComputedStyle(document.querySelector('.sidebar .brand-penguin'))
          .transform.split('(')[1]
          ?.split(',')[0],
      ) > 1.2,
  );
  await page.mouse.move(800, 20);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.sidebar .brand-penguin')).transform === 'none',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await penguin.hover();
  assert.match(await penguin.evaluate((n) => getComputedStyle(n).transform), /matrix/);
  await page.mouse.move(800, 20);
  pass('鼠标进入导航任意位置时企鹅平滑放大，具有过渡中间帧；离开恢复，减少动态效果仍可放大');
  const guideStyle = await page
    .locator('#projects-nav .project-children:not(:empty)')
    .evaluate((n) => ({
      border: getComputedStyle(n).borderLeftWidth,
      branch: getComputedStyle(n.firstElementChild, '::before').borderTopWidth,
    }));
  assert.equal(guideStyle.border, '1px');
  assert.equal(guideStyle.branch, '1px');
  assert.ok((await page.locator('#nav .nav-item').first().boundingBox()).height <= 36);
  const normalIcon = await page
    .locator('[data-view=duplicates] .nav-symbol .ui-icon')
    .boundingBox();
  const trashIcon = await page.locator('[data-view=trash] .nav-symbol .ui-icon').boundingBox();
  assert.equal(normalIcon.width, 20);
  assert.equal(trashIcon.width, 22);
  const alignment = await page.locator('#utility-nav .nav-item').evaluateAll((nodes) =>
    nodes.map((node) => {
      const icon = node.querySelector('.nav-symbol').getBoundingClientRect(),
        text = node.querySelector('.nav-label').getBoundingClientRect();
      return Math.abs(icon.y + icon.height / 2 - text.y - text.height / 2);
    }),
  );
  assert.ok(alignment.every((offset) => offset < 1));
  pass('导航行距紧凑，子项目显示纵向和横向树形关系线');
  await page.locator('#tags-nav [data-tag="旧标签"]').click({ button: 'right' });
  let dialog = page.getByRole('dialog', { name: '标签外观', exact: true });
  assert.equal(await dialog.locator('select').count(), 0);
  assert.equal(await dialog.getByLabel('标签图标', { exact: true }).count(), 0);
  const color = dialog.getByLabel('标签颜色', { exact: true });
  assert.ok((await color.boundingBox()).height >= 38);
  await dialog.getByLabel('标签名称', { exact: true }).fill('已改名');
  await dialog.getByRole('button', { name: '标签颜色 #a3466b', exact: true }).click();
  assert.equal(await color.inputValue(), '#a3466b');
  assert.equal(
    await dialog.getByLabel('标签颜色十六进制', { exact: true }).inputValue(),
    '#a3466b',
  );
  await page.screenshot({ path: path.join(output, 'tag-editor-0.6.1.png') });
  await dialog.getByRole('button', { name: '保存外观', exact: true }).click();
  const tag = page.locator('#tags-nav [data-tag="已改名"]');
  await tag.waitFor();
  assert.ok((await tag.boundingBox()).height <= 26, '标签不应继承普通按钮的 36px 最小高度');
  assert.equal(await page.locator('#tags-nav [data-tag="旧标签"]').count(), 0);
  assert.equal(await tag.evaluate((n) => getComputedStyle(n).color), 'rgb(163, 70, 107)');
  assert.ok(parseFloat(await tag.evaluate((n) => getComputedStyle(n).borderRadius)) <= 6);
  const renamed = await page.evaluate(async (id) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const record = (await db.get(id)).record;
    const draft = await db.getState('draft:test');
    await db.close();
    return { record, draft };
  }, ids.note);
  assert.deepEqual(renamed.record.tags, ['已改名', '保留']);
  assert.deepEqual(renamed.draft.record.tags, ['已改名', '保留']);
  assert.equal(renamed.record.content, '保留的正文');
  assert.deepEqual(renamed.record.project_ids, [ids.parent]);
  pass(
    '标签直接点选、改名并保留正文与项目；草稿一起改名；颜色预设和原生色块可见，标签为小圆角且无图标',
  );
  await side.bringToFront();
  await side.setViewportSize({ width: 360, height: 1000 });
  await side.goto(base + 'sidepanel.html');
  await side.locator('#capture-form').waitFor();
  const tabBoxes = await side.locator('#capture-form > .type-tabs .type-tab').evaluateAll((nodes) =>
    nodes.map((n) => ({
      y: n.getBoundingClientRect().y,
      width: n.getBoundingClientRect().width,
    })),
  );
  assert.equal(tabBoxes.length, 4);
  assert.equal(new Set(tabBoxes.map((b) => b.y)).size, 1);
  assert.ok(tabBoxes.every((b) => b.width > 40));
  await side.mouse.move(-10, -10);
  await side.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.panel-brand .brand-penguin')).transform === 'none',
  );
  await side.mouse.move(200, 700);
  await side.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.panel-brand .brand-penguin')).transform !== 'none',
  );
  pass(
    '标签高度紧凑，导航图标 20px、回收站 22px 且文字对齐；360px 四入口保持一排，进入插件侧栏任意位置即放大企鹅',
  );
  await side.locator('#capture-form [data-type=list]').click();
  const entry = side.getByLabel('添加清单项', { exact: true });
  await entry.fill('task1');
  await entry.press('Enter');
  await side.getByLabel('完成 task1', { exact: true }).check();
  await entry.fill('---');
  await entry.press('Enter');
  assert.equal(await side.locator('.list-composer-row hr').count(), 1);
  await side.getByRole('tab', { name: 'Idea', exact: true }).click();
  await entry.fill('想法1');
  await entry.press('Enter');
  await entry.fill('稍后继续输入');
  await side.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const draft = await db.getState('draft:panel');
    await db.close();
    return draft?.ui.listEntryIdea === '稍后继续输入';
  });
  await side.reload();
  await side.getByLabel('添加清单项').waitFor();
  assert.equal(await side.getByLabel('添加清单项').inputValue(), '稍后继续输入');
  await side.getByRole('button', { name: '保存清单', exact: true }).click();
  await side.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const list = (await db.get('nexus-list'))?.record;
    await db.close();
    return list?.list.length === 4;
  });
  const list = await side.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { toMarkdown } = await import('./lib/model.js');
    const db = new Database();
    const record = (await db.get('nexus-list')).record;
    await db.close();
    return { record, markdown: toMarkdown(record) };
  });
  assert.match(list.record.content, /- \[x\] task1\n---/);
  assert.match(list.record.content, /## Idea\n\n- 想法1\n- 稍后继续输入/);
  assert.equal((list.markdown.match(/## Todo/g) || []).length, 1);
  assert.equal(
    await side.locator('#capture-form [data-type=list]').getAttribute('aria-selected'),
    'true',
  );
  pass(
    'Todo/Idea 回车直接生成条目与分隔线，待输入内容跨刷新恢复，保存仍保留清单类型；底层 Markdown 与导出不重复',
  );
  await page.bringToFront();
  await page.locator('#settings').click();
  await page.locator('#theme').click();
  dialog = page.getByRole('dialog', { name: '主题与字体', exact: true });
  await dialog.getByLabel('主题', { exact: true }).selectOption('dark');
  await dialog.getByLabel('编辑器字号', { exact: true }).fill('16');
  await dialog.getByLabel('编辑器字体', { exact: true }).fill('Consolas, monospace');
  await dialog.getByLabel('主题色十六进制', { exact: true }).fill('#b080df');
  await page.screenshot({ path: path.join(output, 'theme-settings-0.6.1.png') });
  await dialog.getByRole('button', { name: '保存主题', exact: true }).click();
  await side.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(
    await side.locator('#capture-form').evaluate((n) => getComputedStyle(n).fontSize),
    '16px',
  );
  assert.match(
    await side.locator('#capture-form').evaluate((n) => getComputedStyle(n).fontFamily),
    /Consolas/,
  );
  assert.equal(
    await side.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--green').trim(),
    ),
    '#b080df',
  );
  await side.reload();
  await side.locator('#capture-form').waitFor();
  assert.equal(await side.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await side.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const guide = await context.newPage();
  await guide.goto(base + 'manual.html');
  await guide.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await guide.close();
  pass('主题、颜色、分区字号和字体即时预览并保存，跨整理页/侧栏/帮助页应用，刷新后保留');
  await page.locator('#theme').click();
  dialog = page.getByRole('dialog', { name: '主题与字体', exact: true });
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'paper');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.locator('#theme').click();
  dialog = page.getByRole('dialog', { name: '主题与字体', exact: true });
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
  await dialog.getByRole('button', { name: '保存主题', exact: true }).click();
  pass('取消主题预览恢复已保存设置，恢复默认可独立保存');
  await page
    .getByRole('dialog', { name: '设置与数据管理', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  const projectNav = page.locator(`#projects-nav [data-project-id="${ids.parent}"]`);
  await projectNav.getByRole('button').last().click();
  dialog = page.getByRole('dialog', { name: '编辑项目', exact: true });
  assert.ok((await dialog.getByLabel('项目颜色', { exact: true }).boundingBox()).height >= 38);
  await dialog.getByRole('button', { name: '图标 🔬', exact: true }).click();
  await dialog.getByRole('button', { name: '项目颜色 #2764b7', exact: true }).click();
  await dialog.getByRole('button', { name: '保存项目', exact: true }).click();
  await projectNav.locator(':scope > .link-button').click();
  await page.getByRole('button', { name: '关系图', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '项目关系图 · 主题测试项目', exact: true });
  await dialog.getByRole('button', { name: '全屏', exact: true }).click();
  const svg = dialog.locator('.graph-canvas svg'),
    view = await svg.getAttribute('viewBox');
  assert.equal(
    await dialog
      .locator(`[data-node-id="${ids.child}"] rect`)
      .evaluate((n) => getComputedStyle(n).stroke),
    'rgb(39, 100, 183)',
  );
  await svg.hover({ position: { x: 20, y: 20 } });
  await page.mouse.wheel(0, -140);
  await page.waitForFunction(
    (old) => document.querySelector('.graph-canvas svg').getAttribute('viewBox') !== old,
    view,
  );
  const after = (await svg.getAttribute('viewBox')).split(' ').map(Number);
  assert.ok(after[2] < Number(view.split(' ')[2]));
  await page.mouse.wheel(0, 140);
  await dialog.getByLabel('人工总结 图中记录', { exact: true }).fill('直接在关系图修改总结');
  await dialog.getByLabel('子项目描述 子项目', { exact: true }).fill('直接修改子项目描述');
  await dialog.getByLabel('人工总结 网页记录', { exact: true }).fill('网页组也有人工总结');
  await dialog.locator(`[data-node-id="${ids.note}"] > text`).click();
  await dialog.locator('.graph-status').filter({ hasText: '总结已保存' }).waitFor();
  await page.waitForFunction(async (ids) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const result = [
      (await db.get(ids.note)).record.summary,
      (await db.get(ids.child)).record.summary,
      (await db.get(ids.group)).record.summary,
    ];
    await db.close();
    return result.join('|') === '直接在关系图修改总结|直接修改子项目描述|网页组也有人工总结';
  }, ids);
  await page.screenshot({ path: path.join(output, 'graph-summary-0.6.1.png') });
  const beforeEditView = await svg.getAttribute('viewBox');
  await dialog.locator('.graph-controls summary').click();
  await dialog.getByLabel('关系起点', { exact: true }).selectOption(ids.note);
  await dialog.getByLabel('关系终点', { exact: true }).selectOption(ids.child);
  await dialog.getByLabel('关系说明', { exact: true }).fill('尚未添加的说明');
  await dialog
    .locator('.graph-detail')
    .getByRole('button', { name: '编辑记录', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: '编辑记录', exact: true });
  assert.equal(await dialog.locator('[name=summary]').inputValue(), '直接在关系图修改总结');
  assert.equal(await dialog.locator('[name=content]').inputValue(), '保留的正文');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '项目关系图 · 主题测试项目', exact: true });
  await dialog.locator('.graph-detail [data-preview-id]').waitFor();
  assert.ok(await dialog.evaluate((node) => node.classList.contains('graph-fullscreen')));
  assert.equal(await dialog.locator('.graph-canvas svg').getAttribute('viewBox'), beforeEditView);
  assert.equal(await dialog.getByLabel('关系说明', { exact: true }).inputValue(), '尚未添加的说明');
  assert.equal(await dialog.getByLabel('关系起点', { exact: true }).inputValue(), ids.note);
  await dialog
    .locator('.graph-detail')
    .getByRole('button', { name: '编辑记录', exact: true })
    .click();
  let recordEditor = page.getByRole('dialog', { name: '编辑记录', exact: true });
  await recordEditor.locator('[name=content]').fill('关系图编辑后保存的新正文');
  await recordEditor.locator('[name=summary]').fill('关系图编辑后保存的新总结');
  await recordEditor.getByRole('button', { name: '保存修改', exact: true }).click();
  await dialog
    .locator('.graph-detail')
    .getByText('关系图编辑后保存的新正文', { exact: true })
    .waitFor();
  assert.equal(
    await dialog.getByLabel('人工总结 图中记录', { exact: true }).inputValue(),
    '关系图编辑后保存的新总结',
  );
  assert.equal(await dialog.locator('.graph-canvas svg').getAttribute('viewBox'), beforeEditView);
  await dialog
    .locator('.graph-detail')
    .getByRole('button', { name: '编辑记录', exact: true })
    .click();
  recordEditor = page.getByRole('dialog', { name: '编辑记录', exact: true });
  await recordEditor.locator('[name=content]').fill('取消时保留为草稿的内容');
  await recordEditor.press('Escape');
  await dialog
    .locator('.graph-detail')
    .getByText('关系图编辑后保存的新正文', { exact: true })
    .waitFor();
  assert.equal(await page.getByRole('dialog', { name: '编辑记录', exact: true }).count(), 0);
  pass(
    '关系图预览进入完整编辑，保存、取消和 Escape 均返回原关系图，保留全屏、缩放、选中预览与未提交的关系说明',
  );
  await dialog.locator(`[data-node-id="${ids.child}"] > text`).click();
  await dialog.getByRole('button', { name: '编辑子项目', exact: true }).click();
  const projectEditor = page.getByRole('dialog', { name: '编辑项目', exact: true });
  await projectEditor.getByLabel('项目名称', { exact: true }).fill('修改后的子项目');
  await projectEditor.getByRole('button', { name: '保存项目', exact: true }).click();
  await dialog
    .locator('.graph-detail')
    .getByRole('heading', { name: '📚 修改后的子项目', exact: true })
    .waitFor();
  await dialog.getByRole('button', { name: '进入子项目', exact: true }).click();
  await dialog.locator(`[data-node-id="${ids.childNote}"] > text`).click();
  await dialog.getByRole('button', { name: '编辑记录', exact: true }).click();
  recordEditor = page.getByRole('dialog', { name: '编辑记录', exact: true });
  await recordEditor.locator('[name=content]').fill('子项目内修改后的正文');
  await recordEditor.getByRole('button', { name: '保存修改', exact: true }).click();
  await dialog
    .locator('.graph-detail')
    .getByText('子项目内修改后的正文', { exact: true })
    .waitFor();
  assert.equal(await dialog.locator(`[data-node-id="${ids.note}"]`).count(), 0);
  assert.equal(await dialog.locator('.graph-toolbar strong').textContent(), '修改后的子项目');
  await page.screenshot({ path: path.join(output, 'graph-edit-return-0.6.2.png') });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'compact-navbar-0.6.2.png') });
  pass('编辑子项目后返回图中更新预览；进入子项目编辑成员后，返回当前子项目层级');
  pass(
    '项目颜色与基础图标可选；画布滚轮缩放，记录卡片直接编辑人工总结，子项目编辑描述，预览可进入完整编辑',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'theme-browser-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  await writeFile(path.join(output, 'theme-browser-failure.txt'), String(error.stack));
  throw error;
} finally {
  await context?.close();
  if (
    !path.resolve(profile).startsWith(path.resolve(output) + path.sep) ||
    !path.basename(profile).startsWith('theme-profile-')
  )
    throw new Error('Unexpected theme profile cleanup path');
  await rm(profile, { recursive: true, force: true });
}

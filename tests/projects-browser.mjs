import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'project-profile-'));
let context;
const checks = [],
  errors = [];
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
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
  await page.locator('#heading').waitFor();
  await page.getByRole('button', { name: '新增项目', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('研究总项目');
  await dialog
    .getByLabel('项目描述', { exact: true })
    .fill('研究学习方法，汇总实验资料和最终结论。');
  await dialog.getByRole('button', { name: '图标 🔬', exact: true }).click();
  await dialog.getByLabel('项目颜色', { exact: true }).fill('#2764b7');
  assert.equal(await dialog.getByText('关键词', { exact: false }).count(), 0);
  await dialog.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.locator('#projects-nav .project-nav').first().locator(':scope > .link-button').click();
  await page.getByRole('button', { name: '新建子项目', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('实验资料');
  await dialog.getByLabel('项目描述', { exact: true }).fill('仅存放子项目的实验原始材料。');
  await dialog.getByRole('button', { name: '保存项目', exact: true }).click();
  const ids = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const projects = await db.allCatalog();
    const parent = projects.find((r) => r.title === '研究总项目').id,
      child = projects.find((r) => r.title === '实验资料').id;
    const a = newRecord({
        title: '方法记录',
        content: '# 学习方法\n\n保留原有研究正文。',
        tags: ['研究'],
        project_ids: [parent],
      }),
      b = newRecord({
        title: '实验结果',
        content: '实验结果支持学习方法。',
        tags: ['待读'],
        project_ids: [parent],
      }),
      c = newRecord({ title: '子项目资料', content: '只属于子项目。', project_ids: [child] });
    const group = newRecord({
      type: 'website_group',
      title: '参考网页',
      url_list: [
        {
          id: crypto.randomUUID(),
          url: 'https://example.com/reference',
          title: '参考材料',
          added_at: new Date().toISOString(),
          read_at: null,
        },
      ],
    });
    const image = await db.storeAsset(
      new Blob([await (await fetch('icons/icon-128.png')).arrayBuffer()], { type: 'image/png' }),
      '测试快照.png',
    );
    const snapshot = newRecord({
      type: 'snapshot',
      title: '页面图片',
      attachments: [image],
      snapshot: {
        url: 'https://example.com/snapshot',
        title: '页面图片',
        captured_at: new Date().toISOString(),
        format: 'png',
        asset_id: image.id,
      },
    });
    await db.saveMany([a, b, c, group, snapshot].map((record) => ({ record })));
    await db.close();
    return { parent, child, a: a.id, b: b.id, c: c.id, group: group.id, snapshot: snapshot.id };
  });
  const card = (id) => page.locator(`#records [data-record-id="${id}"]`);
  const projectNav = (id) => page.locator(`#projects-nav [data-project-id="${id}"] > .link-button`);
  await projectNav(ids.parent).click();
  await card(ids.a).waitFor();
  assert.match(await page.locator('#description').innerText(), /汇总实验资料/);
  assert.equal(await card(ids.c).count(), 0);
  assert.equal(await page.locator('.page-eyebrow').isVisible(), false);
  pass('项目支持树形层级、描述、颜色和图标，父子成员列表独立且无关键词入口');
  await page.locator('[data-view=all]').click();
  await page.waitForFunction(() => document.querySelector('#heading')?.textContent === '全部记录');
  await card(ids.a).waitFor();
  const positions = await page.evaluate(() => ({
    projects: document.querySelector('.projects-section').getBoundingClientRect().top,
    tags: document.querySelector('.tag-groups').getBoundingClientRect().top,
    utility: document.querySelector('#utility-nav').getBoundingClientRect().top,
  }));
  assert.ok(positions.projects < positions.tags && positions.tags < positions.utility);
  const splitter = page.locator('#sidebar-splitter');
  await splitter.focus();
  await splitter.press('ArrowDown');
  assert.equal(await splitter.getAttribute('aria-valuenow'), '60');
  await page.reload();
  await page.locator('#heading').waitFor();
  assert.equal(await splitter.getAttribute('aria-valuenow'), '60');
  const toolToggle = page.locator('#toggle-utility');
  await toolToggle.click();
  assert.equal(await toolToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#utility-nav').isVisible(), false);
  assert.equal(await page.locator('#settings').isVisible(), true);
  await page.reload();
  await page.locator('#heading').waitFor();
  assert.equal(await toolToggle.getAttribute('aria-expanded'), 'false');
  await toolToggle.click();
  assert.equal(await page.locator('#utility-nav').isVisible(), true);
  assert.equal(
    await page.locator('#projects-nav').evaluate((node) => getComputedStyle(node).overflowY),
    'auto',
  );
  const parentBranch = page.locator(`#projects-nav [data-project-id="${ids.parent}"]`);
  assert.equal(
    await parentBranch.locator(':scope > :first-child').getAttribute('class'),
    'project-toggle',
  );
  await parentBranch.locator('.project-toggle').click();
  assert.equal(
    await page.locator(`#projects-nav [data-project-id="${ids.child}"]`).isVisible(),
    false,
  );
  await parentBranch.locator('.project-toggle').click();
  assert.equal(
    await page.locator(`#projects-nav [data-project-id="${ids.child}"]`).isVisible(),
    true,
  );
  pass('项目折叠按钮位于名称前，项目与标签分区可调整高度并保留设置');
  assert.equal(
    await page.locator('#nav').getByRole('button', { name: '☷　清单', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.locator('#tags-nav').evaluate((n) => getComputedStyle(n).display),
    'flex',
  );
  await page.locator('#tags-nav [data-tag="待读"]').dragTo(card(ids.a));
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-record-id="${id}"] .record-meta`)?.textContent.includes('待读'),
    ids.a,
  );
  await page.getByRole('button', { name: '设置标签外观', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '标签外观', exact: true });
  await dialog.getByRole('button', { name: '待读', exact: true }).click();
  await dialog.getByLabel('标签颜色', { exact: true }).fill('#a3466b');
  assert.equal(await dialog.getByLabel('标签图标', { exact: true }).count(), 0);
  await dialog.getByRole('button', { name: '保存外观', exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('#tags-nav [data-tag="待读"]')
        ?.style.getPropertyValue('--tag-color') === '#a3466b',
  );
  pass('项目排在标签上方，重复检查与回收站在底部；标签为可自定义外观的多选分类块，拖到记录上追加');
  await card(ids.a).locator('.record-main').click();
  dialog = page.getByRole('dialog', { name: '预览记录', exact: true });
  assert.equal(await dialog.locator('form').count(), 0);
  await dialog.getByRole('heading', { name: '学习方法', exact: true }).waitFor();
  await dialog.getByRole('button', { name: '简单修改 · Markdown', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑记录', exact: true });
  assert.equal(await dialog.locator('.type-tabs').isVisible(), false);
  assert.equal(await dialog.locator('[name=title]').isVisible(), false);
  await dialog.locator('[name=content]').fill('# 学习方法\n\n直接修改 Markdown 后的正文。');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await card(ids.a).waitFor();
  await card(ids.a).locator('.record-main').click();
  dialog = page.getByRole('dialog', { name: '预览记录', exact: true });
  await dialog.getByText('直接修改 Markdown 后的正文。', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '完整修改', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑记录', exact: true });
  await dialog.getByLabel('选择标签或输入新标签', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.type-tabs').isVisible(), false);
  assert.equal(await dialog.getByLabel('选择标签或输入新标签', { exact: true }).isVisible(), true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await card(ids.a).getByRole('button', { name: '☆ 喜爱', exact: true }).click();
  await page.locator('[data-view=favorites]').click();
  await card(ids.a).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('#heading')?.textContent === '喜爱' &&
      document.querySelectorAll('#records article').length === 1,
  );
  pass('记录默认只读预览，普通记录提供 Markdown 简单修改和完整修改；喜爱状态形成独立分类');
  await page.locator('[data-view=all]').click();
  await page.waitForFunction(() => document.querySelector('#heading')?.textContent === '全部记录');
  await card(ids.group).waitFor();
  await card(ids.group).getByRole('button', { name: '删除网页 参考材料', exact: true }).click();
  await card(ids.group).locator('.website-preview-line.removed').waitFor();
  await card(ids.group).getByRole('button', { name: '恢复网页 参考材料', exact: true }).click();
  await card(ids.group).locator('.website-preview-line:not(.removed)').waitFor();
  await card(ids.snapshot).locator('.asset-image-only img').waitFor();
  const snapshotLayout = await card(ids.snapshot).evaluate((node) => ({
    imageWidth: node.querySelector('.asset-image-only img').getBoundingClientRect().width,
    contentWidth: node.querySelector('.record-main').getBoundingClientRect().width,
    caption: node.querySelector('.asset-image-only small').textContent.trim(),
    controlsHidden:
      getComputedStyle(node.querySelector('.asset-image-only .row')).display === 'none',
    hasImageCount: [...node.querySelectorAll('.record-top .badge')].some((badge) =>
      /图片 ·/.test(badge.textContent),
    ),
  }));
  assert.ok(snapshotLayout.imageWidth >= snapshotLayout.contentWidth * 0.9);
  assert.equal(snapshotLayout.caption, '');
  assert.equal(snapshotLayout.controlsHidden, true);
  assert.equal(snapshotLayout.hasImageCount, false);
  await page.locator('[data-view=duplicates]').click();
  await page.waitForFunction(() => document.querySelector('#heading')?.textContent === '重复检查');
  assert.equal(await page.locator('#new').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: '＋ 新建记录', exact: true }).count(), 0); // top button exists but is hidden
  pass('网页组支持划线删除与恢复单个网页，记录保留；快照卡片显示实际图片；重复检查无新增入口');
  await projectNav(ids.parent).click();
  await page.getByRole('button', { name: '关系图', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '项目关系图 · 研究总项目', exact: true });
  await dialog.locator(`[data-node-id="${ids.child}"]`).waitFor();
  assert.equal(await dialog.locator(`[data-node-id="${ids.c}"]`).count(), 0);
  await dialog.getByRole('button', { name: '全屏', exact: true }).click();
  assert.ok((await dialog.boundingBox()).width >= 1430);
  await dialog.locator(`[data-node-id="${ids.a}"] > text`).click();
  await dialog
    .locator('.graph-detail')
    .getByText('直接修改 Markdown 后的正文。', { exact: true })
    .waitFor();
  const node = dialog.locator(`[data-node-id="${ids.a}"] rect`);
  const box = await node.boundingBox();
  await page.mouse.move(box.x + 50, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 85, { steps: 10 });
  await page.mouse.up();
  await dialog.locator('.graph-status').filter({ hasText: '布局已保存' }).waitFor();
  await dialog.getByRole('button', { name: '连线', exact: true }).click();
  await dialog.locator(`[data-node-id="${ids.a}"] > text`).click();
  await dialog.locator(`[data-node-id="${ids.child}"] > text`).click();
  await dialog.locator('svg .graph-edge:not(.graph-ghost)').waitFor();
  await dialog.getByRole('button', { name: '结束连线', exact: true }).click();
  const port = await dialog.locator(`[data-node-id="${ids.b}"] .graph-port`).boundingBox(),
    dest = await dialog.locator(`[data-node-id="${ids.child}"] rect`).boundingBox();
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelectorAll('.graph-canvas .graph-edge:not(.graph-ghost)').length === 2,
  );
  await dialog.locator('.graph-controls summary').click();
  await dialog.getByRole('button', { name: '编辑关系', exact: true }).first().click();
  await dialog.getByLabel('关系说明', { exact: true }).fill('参考资料');
  await dialog.getByRole('button', { name: '保存关系', exact: true }).click();
  await dialog.locator('svg .graph-edge-label').filter({ hasText: '参考资料' }).waitFor();
  await page.screenshot({ path: path.join(output, 'project-graph-interactive.png') });
  await dialog.locator(`[data-node-id="${ids.child}"] > text`).click();
  await dialog.getByRole('button', { name: '进入子项目', exact: true }).click();
  await dialog.locator(`[data-node-id="${ids.c}"]`).waitFor();
  assert.equal(await dialog.locator(`[data-node-id="${ids.a}"]`).count(), 0);
  await dialog.getByRole('button', { name: '← 返回父项目', exact: true }).click();
  await dialog.locator(`[data-node-id="${ids.a}"]`).waitFor();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  pass(
    '项目图支持全屏、实际鼠标拖动布局、点击节点预览、点击连线与端点拖动连线；子项目作为节点且可进入',
  );
  const persisted = await page.evaluate(async (ids) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const p = (await db.get(ids.parent)).record,
      a = (await db.get(ids.a)).record;
    await db.close();
    return { p, a };
  }, ids);
  assert.equal(persisted.p.graph.edges.length, 2);
  assert.ok(persisted.p.graph.positions[ids.a]);
  assert.equal(persisted.a.favorite, true);
  assert.deepEqual(persisted.a.tags, ['研究', '待读']);
  await page.reload();
  await projectNav(ids.parent).click();
  await page.getByRole('button', { name: '关系图', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '项目关系图 · 研究总项目', exact: true });
  await dialog.locator('.graph-edge').nth(1).waitFor();
  assert.equal(await dialog.locator('.graph-edge').count(), 2);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const side = await context.newPage();
  side.on('pageerror', (e) => errors.push(e.message));
  await side.setViewportSize({ width: 390, height: 1100 });
  await side.goto(base + 'sidepanel.html');
  await side.locator('#capture-form').waitFor();
  await side.locator('#capture-form [data-type=list]').click();
  await side.locator('.list-source summary').click();
  await side.locator('[name=list_markdown]').fill('- [ ] 做一次整理\n- [x] 阅读资料\n---');
  await side.getByRole('button', { name: '保存清单', exact: true }).click();
  await side.locator('.record-list').waitFor();
  const list = await side.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const row = await db.get('nexus-list');
    await db.close();
    return row.record;
  });
  assert.equal(list.list.length, 3);
  assert.equal(list.list[1].checked, true);
  await side.locator('.panel-brand .brand-penguin').hover();
  assert.ok(
    await side
      .locator('.panel-brand .brand-penguin')
      .evaluate((n) => getComputedStyle(n).transform !== 'none'),
  );
  assert.ok(
    await page
      .locator('.record h2')
      .first()
      .evaluate((n) => parseFloat(getComputedStyle(n).fontSize) === 14),
  );
  assert.equal(await side.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await side.locator('#toast').evaluate((n) => n.classList.remove('visible'));
  await side.screenshot({ path: path.join(output, 'sidebar-readable.png') });
  pass(
    '关系和节点布局跨刷新保存；清单直接输入 Markdown；默认字体适中，侧栏企鹅持续悬停放大且窄屏无横向溢出',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'projects-browser-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  await writeFile(path.join(output, 'projects-browser-failure.txt'), String(error.stack));
  throw error;
} finally {
  await context?.close();
  if (
    !path.resolve(profile).startsWith(path.resolve(output) + path.sep) ||
    !path.basename(profile).startsWith('project-profile-')
  )
    throw new Error('Unexpected project profile cleanup path');
  await rm(profile, { recursive: true, force: true });
}

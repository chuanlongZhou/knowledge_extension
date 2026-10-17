import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'ui-profile-'));
const errors = [],
  checks = [];
let context;
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  const page = await context.newPage();
  await page.goto(base + 'dashboard.html');
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  const ids = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const { EXAMPLES_VISIBLE } = await import('./lib/examples.js');
    const db = new Database('pkm-nexus-v1');
    await db.setState(EXAMPLES_VISIBLE, false);
    const list = newRecord({
      type: 'list',
      updated_at: '2020-01-01T00:00:00.000Z',
      list: [
        { id: 'todo-one', kind: 'item', text: '固定待办', is_checkbox: true, checked: false },
        { id: 'idea-one', kind: 'item', text: '持续想法', is_checkbox: false, checked: false },
      ],
    });
    await db.save(list);
    const notes = [];
    for (let i = 0; i < 65; i++) {
      const record = newRecord({
        title: `交互记录 ${i}`,
        content: `交互验证正文 ${i}`,
        tags: i < 2 ? ['原有', '保留'] : [],
        updated_at: `2025-01-${String((i % 28) + 1).padStart(2, '0')}T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
      });
      await db.save(record);
      notes.push(record.id);
    }
    await db.close();
    return { list: list.id, notes };
  });
  const card = (id, target = page) => target.locator(`#records [data-record-id="${id}"]`);
  const row = (id) =>
    page.evaluate(async (id) => {
      const { Database } = await import('./lib/db.js');
      const db = new Database('pkm-nexus-v1', { broadcast: false });
      try {
        return (await db.get(id)).record;
      } finally {
        await db.close();
      }
    }, id);
  const all = async () => {
    await page.locator('#search').fill('');
    await page.locator('#nav [data-view=all]').click();
    await page.locator('#heading').filter({ hasText: '全部记录' }).waitFor();
  };
  const group = (tag) =>
    page
      .locator('#tags-nav .tag-group')
      .filter({ has: page.locator('.tag-group-name', { hasText: tag }) });
  const addGroup = async (name) => {
    await page.getByRole('button', { name: '新建标签', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建标签', exact: true });
    await dialog.locator('input').fill(name);
    await dialog.getByRole('button', { name: '新建标签', exact: true }).click();
    await group(name).waitFor();
  };
  await all();
  await card(ids.list).waitFor();
  assert.equal(
    await page.locator('#records article').first().getAttribute('data-record-id'),
    ids.list,
  );
  assert.equal(await page.locator('#records article').count(), 60);
  await page.locator('#search').fill('交互验证正文 0');
  await card(ids.notes[0]).getByRole('button', { name: '置顶', exact: true }).click();
  await card(ids.notes[0]).getByRole('button', { name: '取消置顶', exact: true }).waitFor();
  await all();
  await page.waitForFunction(
    (id) => document.querySelectorAll('#records article')[1]?.dataset.recordId === id,
    ids.notes[0],
  );
  await page.reload();
  await card(ids.notes[0]).getByRole('button', { name: '取消置顶', exact: true }).waitFor();
  assert.equal(
    await page.locator('#records article').first().getAttribute('data-record-id'),
    ids.list,
  );
  pass('超过一页时 Todo 固定第一，普通记录置顶与当前视图跨刷新保留');

  await addGroup('学习');
  await page.reload();
  await group('学习').waitFor();
  assert.equal(await group('学习').innerText(), '学习');
  await all();
  await group('学习').dragTo(card(ids.notes[0]));
  await card(ids.notes[0]).locator('.tag').filter({ hasText: '学习' }).waitFor();
  assert.equal((await row(ids.notes[0])).organization_state, 'organized');
  assert.deepEqual((await row(ids.notes[0])).tags, ['原有', '保留', '学习']);
  pass('侧栏可新建空标签，真实拖放保留其他标签并标记已整理');

  await addGroup('归档');
  await group('学习').click();
  await group('归档').dragTo(card(ids.notes[0]));
  await card(ids.notes[0]).locator('.tag').filter({ hasText: '归档' }).waitFor();
  assert.deepEqual((await row(ids.notes[0])).tags, ['原有', '保留', '学习', '归档']);
  await group('归档').click();
  await card(ids.notes[0]).getByRole('button', { name: '移回收件箱', exact: true }).click();
  await card(ids.notes[0]).getByRole('button', { name: '标记已整理', exact: true }).waitFor();
  assert.equal((await row(ids.notes[0])).organization_state, 'inbox');
  await card(ids.notes[0]).getByRole('button', { name: '标记已整理', exact: true }).click();
  await card(ids.notes[0]).getByRole('button', { name: '移回收件箱', exact: true }).waitFor();
  await card(ids.notes[0]).getByRole('button', { name: '移动到…', exact: true }).click();
  const move = page.getByRole('dialog', { name: '移动记录' });
  await move.getByLabel('移动目标').selectOption('new');
  await move.getByLabel('新标签名称', { exact: true }).fill('新项目');
  await move.getByRole('button', { name: '移动', exact: true }).click();
  await group('新项目').waitFor();
  assert.deepEqual((await row(ids.notes[0])).tags, ['原有', '保留', '学习', '归档', '新项目']);
  pass('跨标签追加并保留已有标签；卡片可直接标记整理、退回收件箱并移动到新组');

  await group('原有').click();
  await card(ids.notes[0]).getByRole('checkbox', { name: '选择 交互记录 0', exact: true }).check();
  await card(ids.notes[1]).getByRole('checkbox', { name: '选择 交互记录 1', exact: true }).check();
  await page
    .locator('#selection-bar')
    .getByRole('button', { name: '移动到…', exact: true })
    .click();
  await move.getByLabel('移动目标').selectOption('tag:学习');
  await move.getByRole('button', { name: '移动', exact: true }).click();
  await card(ids.notes[1]).locator('.tag').filter({ hasText: '学习' }).waitFor();
  assert.ok((await row(ids.notes[0])).tags.includes('原有'));
  assert.ok((await row(ids.notes[1])).tags.includes('原有'));
  assert.equal((await row(ids.notes[1])).organization_state, 'organized');
  pass('批量添加标签仅更新所选记录，并保留已有标签');
  await all();
  await card(ids.list).getByRole('button', { name: 'Idea', exact: true }).click();
  await card(ids.notes[0]).getByRole('button', { name: '取消置顶', exact: true }).click();
  await card(ids.list).getByText('持续想法', { exact: true }).waitFor();
  assert.equal(await card(ids.list).getByText('固定待办', { exact: true }).count(), 0);
  pass('其他记录触发刷新后，Todo / Idea 卡片模式保持');
  await page.screenshot({ path: path.join(output, 'ui-organize-dashboard.png'), fullPage: false });

  const side = await context.newPage();
  await side.setViewportSize({ width: 360, height: 1000 });
  await side.goto(base + 'sidepanel.html');
  await side.locator('#capture-form').waitFor();
  assert.equal(await side.locator('.panel-start').count(), 0);
  const footer = await side.locator('#extension-version').boundingBox();
  assert.ok(footer.y > 750);
  await side.locator('[name=title]').fill('跨网页连续编辑');
  await side.locator('[name=content]').fill('在第二个网页继续输入的草稿');
  await side.getByRole('button', { name: '预览', exact: true }).click();
  await context.route('https://interaction.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html;charset=utf-8',
      body: '<title>不同网页</title><p>网页内容</p>',
    }),
  );
  const web = await context.newPage();
  await web.goto('https://interaction.example/first');
  await web.goto('https://interaction.example/second');
  await web.bringToFront();
  assert.equal(await side.locator('[name=title]').inputValue(), '跨网页连续编辑');
  await side.reload();
  await side.getByRole('button', { name: '编辑', exact: true }).waitFor();
  assert.equal(await side.locator('[name=title]').inputValue(), '跨网页连续编辑');
  assert.equal(await side.locator('[name=content]').inputValue(), '在第二个网页继续输入的草稿');
  assert.equal(await side.locator('[name=content]').isVisible(), false);
  pass('网页导航不重置侧栏，重建侧栏后正文、标题与预览状态恢复');

  await side.locator('#capture-form .type-tab[data-type=website_group]').click();
  await side.locator('[name=close_tabs]').uncheck();
  await side.locator('[name=website_url]').fill('https://interaction.example/unfinished');
  await side.locator('[name=website_title]').fill('尚未加入的链接');
  await side.reload();
  await side.locator('[data-pane=website_group]:visible').waitFor();
  assert.equal(await side.locator('[name=close_tabs]').isChecked(), false);
  assert.equal(
    await side.locator('[name=website_url]').inputValue(),
    'https://interaction.example/unfinished',
  );
  assert.equal(await side.locator('[name=website_title]').inputValue(), '尚未加入的链接');
  pass('侧栏恢复网页组模式、关闭标签页选项与尚未提交的链接输入');
  await side.getByRole('button', { name: '选择已打开网页', exact: true }).click();
  await side.getByRole('checkbox', { name: '选择标签页 不同网页', exact: true }).check();
  await side.reload();
  await side.getByRole('checkbox', { name: '选择标签页 不同网页', exact: true }).waitFor();
  assert.equal(
    await side.getByRole('checkbox', { name: '选择标签页 不同网页', exact: true }).isChecked(),
    true,
  );
  await side.getByRole('button', { name: '加入所选网页', exact: true }).click();
  await side.reload();
  await side.locator('.url-editor .url-row').waitFor();
  assert.equal(await side.locator('.url-editor .url-row').count(), 1);
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await side.locator('#toast').filter({ hasText: '已保存' }).waitFor();
  assert.equal(web.isClosed(), false);
  pass('网页选择列表与勾选状态可恢复；加入后重建侧栏仍保留待保存链接和关闭选项');
  await side.locator('#capture-form .type-tab[data-type=list]').click();
  await side.locator('#capture-form [data-mode=false]').click();
  if (!(await side.locator('[name=list_markdown]').isVisible()))
    await side.locator('.list-source summary').click();
  await side.locator('[name=list_markdown]').fill('- 继续编辑同一清单');
  await side.reload();
  await side.locator('#capture-form [data-mode=false][aria-selected=true]').waitFor();
  assert.equal(await side.locator('[name=list_markdown]').inputValue(), '- 继续编辑同一清单');
  await side.getByRole('button', { name: '保存修改', exact: true }).click();
  await side.locator('#toast').filter({ hasText: '已保存' }).waitFor();
  assert.equal((await row(ids.list)).list.find((i) => !i.is_checkbox).text, '继续编辑同一清单');
  pass('侧栏恢复正在编辑的原记录和 Idea 模式，保存仍更新原 ID');
  assert.equal(await side.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await side.screenshot({ path: path.join(output, 'ui-sidepanel-footer.png') });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'ui-interactions-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(`PASS ${checks.length} UI interaction checks`);
} catch (error) {
  for (const [index, target] of (context?.pages() || []).entries()) {
    if (!target.url().includes('chrome-extension://')) continue;
    await target.screenshot({ path: path.join(output, `ui-failure-${index}.png`) }).catch(() => {});
    console.error(
      await target
        .evaluate(async () => {
          const { Database } = await import('./lib/db.js');
          const db = new Database('pkm-nexus-v1', { broadcast: false });
          try {
            return {
              url: location.href,
              toast: document.querySelector('#toast')?.textContent,
              storage: await chrome.storage.session.get(null),
              draft: await db.getState('draft:panel'),
              content: document.querySelector('#capture-box')?.textContent,
            };
          } finally {
            await db.close();
          }
        })
        .catch(() => null),
    );
  }
  console.error(errors);
  throw error;
} finally {
  await context?.close();
  if (path.dirname(profile) !== output) throw new Error('Unexpected profile cleanup path');
  await rm(profile, { recursive: true, force: true });
}

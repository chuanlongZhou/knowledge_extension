import { browserOptions, authorizedExtension } from './browser-options.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSyncHarness, enableLocal } from './browser-sync.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension'),
  output = path.join(root, 'test-results');
await mkdir(output, { recursive: true });
const profileRoot = await mkdtemp(path.join(output, 'browser-profiles-'));
const repo = new BrowserSyncHarness(),
  contexts = [],
  errors = [],
  diagnostics = [],
  report = { checks: [], performance: null };
function checked(name) {
  report.checks.push(name);
  console.log(`PASS ${name}`);
}
async function launch(name, width = 1440) {
  const testExtension = await authorizedExtension(extension, profileRoot);
  const context = await chromium.launchPersistentContext(path.join(profileRoot, name), {
    ...browserOptions(),
    headless: true,
    viewport: { width, height: 1000 },
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`],
  });
  contexts.push(context);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  await repo.connect(context, worker);
  const id = worker.url().split('/')[2];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') diagnostics.push(msg.text());
  });
  page.on('requestfailed', (req) =>
    diagnostics.push(`${req.method()} ${req.url()} ${req.failure()?.errorText}`),
  );
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  return { context, page, id };
}
const waitText = (page, selector, text) =>
  page.waitForFunction(
    ({ selector, text }) => document.querySelector(selector)?.textContent.includes(text),
    { selector, text },
  );
async function recordCount(page) {
  return page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const rows = await db.allCatalog();
    await db.close();
    return rows.filter((r) => r.type !== 'project' && r.kind !== 'tombstone').length;
  });
}
async function compose(page, title, content, url = '', tags = '') {
  await page.locator('#new').click();
  const modal = page.locator('dialog[open]');
  await modal.locator('[name=title]').fill(title);
  await modal.locator('[name=content]').fill(content);
  await modal.locator('[name=urls]').fill(url);
  await modal.locator('[name=tags]').fill(tags);
  await modal.getByRole('button', { name: '保存到本机', exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('dialog[open]') ||
      document.querySelector('dialog[open] .error-text')?.textContent.trim(),
  );
  if (await modal.count())
    throw new Error('Compose failed: ' + (await modal.locator('.error-text').innerText()));
}
const configure = enableLocal;
async function sync(page) {
  await page.locator('#sync').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#toast').textContent.includes('同步完成') ||
      document.querySelector('#toast').classList.contains('error'),
  );
  const message = await page.locator('#toast').innerText();
  if (!message.includes('同步完成')) throw new Error(`Browser synchronization failed: ${message}`);
  await page.waitForFunction(() => !document.querySelector('#sync').disabled);
}
async function edit(page, title, content) {
  await page
    .locator('.record-main')
    .filter({ has: page.locator('h2', { hasText: title }) })
    .first()
    .click();
  await page.getByRole('button', { name: '完整修改', exact: true }).click();
  const modal = page.locator('dialog[open]');
  await modal.locator('[name=content]').waitFor({ state: 'attached' });
  if (!(await modal.locator('[name=content]').isVisible()))
    await modal.getByRole('button', { name: '编辑', exact: true }).click();
  await modal.locator('[name=content]').fill(content);
  await modal.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('dialog[open]') ||
      document.querySelector('dialog[open] .error-text')?.textContent.trim(),
  );
  if (await modal.count())
    throw new Error(`Editor save failed: ${await modal.locator('.error-text').innerText()}`);
}

try {
  const a = await launch('a'),
    b = await launch('b');
  assert.equal(repo.remote.calls.length, 0);
  checked('真实扩展启动不请求云端同步');
  await a.context.setOffline(true);
  await compose(
    a.page,
    '浏览器插件的设计原则',
    '# 设计原则\n\n本地可靠保存，手动同步，开放格式。\n\n```js\nconst owner = "you";\n```',
    'https://example.com/design',
    '开发, 参考',
  );
  await a.context.setOffline(false);
  await waitText(a.page, '#records', '浏览器插件的设计原则');
  checked('离线新建和收件箱显示');
  await compose(
    a.page,
    '同页的另一段摘录',
    '新的段落，需要独立判断。',
    'https://example.com/design',
  );
  await a.page.getByRole('button', { name: '查看重复提示' }).click();
  await a.page.getByRole('button', { name: '追加到所选记录' }).click();
  await waitText(a.page, '#toast', '这条收集已处理');
  assert.equal(await recordCount(a.page), 1);
  checked('同页不同摘录提示后明确追加');
  await compose(a.page, '每周整理一次', '给未分类收件箱留十分钟。', '', '习惯');
  await compose(
    a.page,
    '代码片段与安全预览',
    '<img src="https://example.com/tracker" onerror="window.UNSAFE=true">\n<script>window.UNSAFE=true</script>',
  );
  await a.page.locator('#search').fill('安全预览');
  await waitText(a.page, '#records', '代码片段与安全预览');
  await a.page.locator('.record-main').first().click();

  assert.equal(await a.page.locator('.markdown img').count(), 0);
  assert.equal(await a.page.evaluate(() => window.UNSAFE), undefined);
  await a.page.locator('dialog[open]').getByRole('button', { name: '关闭', exact: true }).click();
  await a.page.locator('#search').fill('');
  await waitText(a.page, '#records', '代码片段与安全预览');
  await edit(
    a.page,
    '代码片段与安全预览',
    '# 代码片段\n\n```js\nawait saveLocally(note);\n// 点击同步后才上传\n```',
  );
  checked('Markdown 预览不执行 HTML 或脚本');
  await a.page.reload();
  await waitText(a.page, '#records', '浏览器插件的设计原则');
  assert.equal(await recordCount(a.page), 3);
  checked('刷新后 IndexedDB 内容保留');
  await a.page.locator('#add-project').click();
  const projectModal = a.page.locator('dialog[open]');
  await projectModal.getByLabel('项目名称', { exact: true }).fill('知识插件');
  await projectModal.getByLabel('项目描述', { exact: true }).fill('插件研究资料');
  await projectModal.getByRole('button', { name: '保存项目', exact: true }).click();
  await a.page
    .locator('.record')
    .filter({ has: a.page.locator('h2', { hasText: '浏览器插件的设计原则' }) })
    .getByRole('button', { name: '加入项目…', exact: true })
    .click();
  await a.page.getByRole('checkbox', { name: '知识插件', exact: true }).check();
  await a.page.getByRole('button', { name: '加入项目', exact: true }).click();
  await a.page.locator('#projects-nav').getByRole('button', { name: '📁  知识插件' }).click();
  await waitText(a.page, '#heading', '知识插件');
  await a.page.locator('[data-view=inbox]').click();
  await waitText(a.page, '#heading', '收件箱');
  assert.ok(await a.page.locator('#records .badge').filter({ hasText: '知识插件' }).count());
  checked('手动加入项目保留未分类状态');
  await compose(
    b.page,
    '另一台电脑的独立摘录',
    '这段文字由电脑 B 独立收集。',
    'https://example.com/design',
  );
  await configure(a.page);
  await configure(b.page);
  assert.equal(
    [...repo.remote.files.values()].filter((f) => f.appProperties?.pkm_role === 'batch').length,
    0,
  );
  checked('连接本地资料库完成交接，云端上传由同步触发');
  await sync(a.page);
  await sync(b.page);
  await waitText(b.page, '#records', '浏览器插件的设计原则');
  assert.equal(await recordCount(b.page), 4);
  checked('两个真实扩展通过本地程序与 Drive 适配器完成双向同步');
  await sync(a.page);
  await a.page.locator('[data-view=all]').click();
  await waitText(a.page, '#heading', '全部记录');
  await a.page.getByRole('checkbox', { name: '选择 另一台电脑的独立摘录', exact: true }).check();
  await a.page.getByRole('checkbox', { name: '选择 浏览器插件的设计原则', exact: true }).check();
  await a.page.getByRole('button', { name: '合并两条', exact: true }).click();
  await a.page.getByRole('button', { name: '合并并保留来源到回收站', exact: true }).click();
  await a.page.locator('[data-view=inbox]').click();
  await sync(a.page);
  await sync(b.page);
  checked('跨电脑相关摘录可明确选择后手动合并');
  await edit(b.page, '浏览器插件的设计原则', '电脑 B 的修改');
  await edit(a.page, '浏览器插件的设计原则', '电脑 A 的修改');
  await sync(a.page);
  await sync(b.page);
  await b.page.getByText('1 条同步冲突', { exact: true }).waitFor();
  await repo.chooseVersion(b.context, '电脑 B 的修改');
  await sync(b.page);
  await sync(a.page);
  await waitText(a.page, '#records', '电脑 B 的修改');
  checked('同步冲突显示处理入口，本地程序保留双方并传播选择');
  const beforeTrashCalls = repo.remote.calls.length;
  const target = a.page
    .locator('.record')
    .filter({ has: a.page.locator('h2', { hasText: '每周整理一次' }) });
  await target.getByRole('button', { name: '移入回收站', exact: true }).click();
  await a.page.locator('[data-view=trash]').click();
  await waitText(a.page, '#records', '每周整理一次');
  assert.equal(repo.remote.calls.length, beforeTrashCalls);
  await a.page
    .locator('.record')
    .filter({ has: a.page.locator('h2', { hasText: '每周整理一次' }) })
    .getByRole('button', { name: '还原', exact: true })
    .click();
  await a.page.locator('[data-view=inbox]').click();
  await waitText(a.page, '#records', '每周整理一次');
  checked('删除和还原均只保存本地，不自动同步');
  const side = await a.context.newPage();
  side.on('pageerror', (e) => errors.push(e.message));
  await side.setViewportSize({ width: 360, height: 900 });
  await side.goto(`chrome-extension://${a.id}/sidepanel.html`);
  await side.locator('#capture-form').waitFor();
  await side.locator('#capture-form [name=title]').fill('侧边栏速记');
  await side.locator('#capture-form [name=content]').fill('不用先分类，随手保存。');
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await waitText(side, '#records', '侧边栏速记');
  assert.equal(await side.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await side.screenshot({ path: path.join(output, 'sidepanel.png'), fullPage: true });
  await side.close();
  checked('360px 侧边栏保存与布局无横向溢出');
  await waitText(a.page, '#records', '侧边栏速记');
  await a.page.screenshot({ path: path.join(output, 'dashboard.png'), fullPage: true });
  await a.page.locator('#new').click();
  const draftModal = a.page.locator('dialog[open]');
  await draftModal.locator('[name=title]').fill('稍后继续的草稿');
  await draftModal.locator('[name=content]').fill('关闭窗口也要保留这些输入。');
  await draftModal.locator('[name=urls]').fill('https://example.com/draft-in-progress');
  await draftModal.getByRole('button', { name: '取消', exact: true }).click();
  await a.page.locator('#settings').click();
  const downloading = a.page.waitForEvent('download');
  await a.page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const downloaded = await downloading;
  const backupPath = path.join(output, 'browser-backup.json');
  await downloaded.saveAs(backupPath);
  const backupText = await readFile(backupPath, 'utf8');
  assert.ok(!backupText.includes('fake-token-only-for-tests'));
  const backup = JSON.parse(backupText);
  checked('JSON 导出保留数据且不含凭证');
  const c = await launch('c');
  await c.page.locator('#settings').click();
  await c.page.locator('input[type=file]').setInputFiles(backupPath);
  await c.page.getByRole('button', { name: '导入到本机', exact: true }).click();
  await waitText(c.page, '#records', '侧边栏速记');
  const count = await recordCount(c.page);
  assert.equal(count, backup.records.filter((i) => i.record.type !== 'project').length);
  await c.page.locator('#settings').click();
  await c.page.locator('input[type=file]').setInputFiles(backupPath);
  await c.page.getByRole('button', { name: '导入到本机', exact: true }).click();
  assert.equal(await recordCount(c.page), count);
  checked('新浏览器配置导入与重复导入不复制数据库');
  assert.equal(backup.drafts.length, 1);
  await c.page.locator('#settings').click();
  await c.page.getByRole('button', { name: '恢复为新记录', exact: true }).click();
  assert.equal(await c.page.locator('dialog[open] [name=title]').inputValue(), '稍后继续的草稿');
  assert.equal(
    await c.page.locator('dialog[open] [name=urls]').inputValue(),
    'https://example.com/draft-in-progress',
  );
  await c.page.getByRole('button', { name: '保存到本机', exact: true }).click();
  await waitText(c.page, '#records', '稍后继续的草稿');
  checked('未保存草稿备份恢复为新记录');
  report.performance = await c.page.evaluate(async () => {
    const { Database } = await import('./lib/db.js'),
      { newRecord } = await import('./lib/model.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const entries = Array.from({ length: 10_000 }, (_, i) => ({
      record: newRecord({
        title: `性能样本 ${i}`,
        content: `记录正文 ${i} / needle-${i} / ` + '本地知识与参考资料。'.repeat(80),
        tags: ['性能样本'],
      }),
      scope: 'local',
      status: 'new',
      existingRev: 0,
    }));
    let start = performance.now();
    await db.applyImport({ entries, captures: [] });
    const importMs = performance.now() - start;
    start = performance.now();
    const list = await db.list({ view: 'all', limit: 60 });
    const listMs = performance.now() - start;
    start = performance.now();
    const search = await db.list({ view: 'all', query: 'needle-9999', limit: 60 });
    const searchMs = performance.now() - start;
    const total = (await db.allCatalog()).length;
    await db.close();
    return {
      total,
      importMs: Math.round(importMs),
      listMs: Math.round(listMs),
      searchMs: Math.round(searchMs),
      pageSize: list.items.length,
      matchCount: search.items.length,
      containsBody: Object.hasOwn(list.items[0], 'content'),
    };
  });
  assert.equal(report.performance.pageSize, 60);
  assert.equal(report.performance.matchCount, 1);
  assert.equal(report.performance.containsBody, false);
  checked('一万条记录分页只返回元数据，正文搜索结果正确');
  await a.context.close();
  const restarted = await launch('a');
  await waitText(restarted.page, '#records', '侧边栏速记');
  checked('完整退出并重新启动浏览器后记录仍保留');
  await restarted.context.route('https://example.com/capture-smoke', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>快捷键捕获的网页</title></head><body><p id="excerpt">只保存用户选中的这一段。</p><p>没有选择的段落不应被抓取。</p></body></html>',
    }),
  );
  const website = await restarted.context.newPage();
  await website.goto('https://example.com/capture-smoke');
  await website.locator('#excerpt').evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await website.keyboard.press('Alt+Shift+S');
  await restarted.page.waitForFunction(
    async () => {
      const { Database } = await import('./lib/db.js');
      const db = new Database('pkm-nexus-v1', { broadcast: false });
      const drafts = await db.drafts();
      await db.close();
      return drafts.some((d) => d.value.record?.content === '只保存用户选中的这一段。');
    },
    undefined,
    { timeout: 8000 },
  );
  const capturedRows = await restarted.page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const result = await db.list({ view: 'inbox', query: '快捷键捕获的网页' });
    await db.close();
    return result.items.length;
  });
  assert.equal(capturedRows, 0);
  await website.close();
  checked('真实网页快捷键先捕获为编辑草稿，不自动进入收件箱');
  assert.equal(errors.length, 0, errors.join('\n'));
  checked('浏览器页面无未处理异常');
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.performance));
} catch (error) {
  for (let i = 0; i < contexts.length; i++)
    for (const page of contexts[i].pages()) {
      try {
        await page.screenshot({ path: path.join(output, `failure-${i}.png`), fullPage: true });
      } catch {}
    }
  await writeFile(
    path.join(output, 'browser-failure.json'),
    JSON.stringify(
      {
        message: error.message,
        stack: error.stack,
        errors,
        diagnostics,
        calls: repo.remote.calls.map((c) => ({ path: c.path, method: c.method })),
        report,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await repo.close();
  await Promise.allSettled(contexts.map((context) => context.close()));
  const resolved = path.resolve(profileRoot),
    safeParent = path.resolve(output) + path.sep;
  if (!resolved.startsWith(safeParent) || !path.basename(resolved).startsWith('browser-profiles-'))
    throw new Error('Refusing to remove an unexpected browser profile path');
  await rm(resolved, { recursive: true, force: true });
}

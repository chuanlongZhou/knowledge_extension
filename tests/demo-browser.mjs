import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { browserOptions, authorizedExtension } from './browser-options.mjs';
import { readZip } from '../extension/lib/zip.js';
import { Service } from '../companion/service.mjs';
import { Settings } from '../companion/settings.mjs';
import { DriveClient } from '../companion/drive.mjs';
import { managementServer } from '../companion/server.mjs';
import { MockDrive } from './mock-drive.js';

const live = process.argv.includes('--live'),
  mode = live ? 'live' : 'offline';
const root = path.resolve('.'),
  output = path.join(root, 'test-results', 'demo-runs');
const spec = JSON.parse(await readFile('tests/fixtures/demo-cases.json', 'utf8'));
await mkdir(output, { recursive: true });
const run = await mkdtemp(
  path.join(output, `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}-`),
);
const images = path.join(root, 'extension', 'guide', 'images');
await mkdir(images, { recursive: true });
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const report = {
  schemaVersion: 1,
  mode,
  startedAt: new Date().toISOString(),
  extensionVersion: manifest.version,
  environment: {
    platform: process.platform,
    websiteAccess: '测试扩展副本预授网站权限；首次授权弹窗由权限回归单独验证',
    microphone: '虚拟麦克风；不是人的声音',
    sync: 'MockDrive；不连接 Google；交接传输为测试桥',
  },
  cases: [],
  errors: [],
};
const contexts = [],
  services = [],
  servers = [];
let activeCase, a, side, source, localA, localB, lastPage;
const records = new Map();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const webIds = new Set(['N01', 'N04', 'P01', 'P02', 'P03']);
class Blocked extends Error {}
async function launch(name) {
  const extension = await authorizedExtension(path.resolve('extension'), run);
  const context = await chromium.launchPersistentContext(path.join(run, name), {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1320, height: 950 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
  contexts.push(context);
  context.setDefaultTimeout(12000);
  if (!live)
    for (const [key, url] of Object.entries(spec.sites)) {
      const title = {
        wiki: 'Personal knowledge management — Wiki 离线样例',
        wiki2: 'Knowledge management — Wiki 离线样例',
        bilibili: 'Bilibili 视频页 — 离线样例',
        bilibili2: 'Bilibili 视频页二 — 离线样例',
        chetna: 'CHETNA 城市排放地图 — 离线样例',
      }[key];
      await context.route(url, (route) =>
        route.fulfill({
          contentType: 'text/html;charset=utf-8',
          body: `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:18px system-ui;margin:0;background:#f3f6f1;color:#244336}header{padding:16px 32px;background:#f6dfaa}main{max-width:1000px;margin:40px auto;padding:32px;background:white;border-radius:14px}section{padding:40px;background:#e3eddf;border:1px solid #bfd5bb;border-radius:12px}h1{font-size:36px}</style><header>离线固定样例 · 不是外部网站实测 · PKM Nexus 可重复验收</header><main><h1>${title}</h1><p id="excerpt">本地优先保存资料，由用户决定整理和同步。</p><section>${key.startsWith('bilibili') ? '▶ 视频页面占位区域（无真实视频）' : key === 'chetna' ? 'CHETNA 地图占位区域（无真实地图）' : 'Wiki 文章区域（项目自编测试内容）'}</section><p>URL: ${url}</p></main>`,
        }),
      );
    }
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2],
    page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  report.browserVersion = context.browser().version();
  return { context, page, id, extension };
}
async function allRows(page = side) {
  return page.evaluate(async () => {
    const { Database } = await import('./lib/db.js'),
      db = new Database('pkm-nexus-v1', { broadcast: false });
    try {
      return await db.allRows();
    } finally {
      await db.close();
    }
  });
}
async function step(
  action,
  expected,
  page,
  { selector, actual = expected, status = 'passed' } = {},
) {
  lastPage = page;
  const filename = `${mode}-${activeCase.id.toLowerCase()}-${String(activeCase.steps.length + 1).padStart(2, '0')}.png`;
  const target = selector ? page.locator(selector) : page;
  const bytes = await target.screenshot({
    path: path.join(images, filename),
    animations: 'disabled',
  });
  activeCase.steps.push({
    action,
    expected,
    actual,
    status,
    image: `images/${filename}`,
    sha256: hash(bytes),
  });
}
async function scenario(id, fn) {
  if (live && !webIds.has(id)) return;
  const item = spec.cases.find((c) => c.id === id);
  activeCase = {
    id,
    group: item.group,
    title: item.title,
    expected: item.expected,
    status: 'running',
    steps: [],
  };
  lastPage = side;
  report.cases.push(activeCase);
  try {
    await fn();
    activeCase.status ||= 'passed';
    if (activeCase.status === 'running') activeCase.status = 'passed';
  } catch (error) {
    activeCase.status = error instanceof Blocked ? 'blocked' : 'failed';
    activeCase.reason = error.message;
    try {
      await step(
        '记录本轮阻塞或失败状态',
        item.expected,
        error instanceof Blocked && source && !source.isClosed() ? source : lastPage,
        { status: activeCase.status, actual: error.message },
      );
    } catch {}
  }
  console.log(
    `${activeCase.status.toUpperCase()} ${id} ${item.title}${activeCase.reason ? ': ' + activeCase.reason : ''}`,
  );
  await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  if (activeCase.status === 'failed' && process.argv.includes('--fail-fast'))
    throw new Error(`${id}: ${activeCase.reason}`);
}
async function clear() {
  await side.bringToFront();
  if (await side.locator('dialog[open]').count())
    await side.locator('dialog[open]').getByRole('button', { name: '×', exact: true }).click();
  const old = await side.locator('#capture-form').elementHandle();
  await side.getByRole('button', { name: /^(清空|取消编辑)$/ }).click();
  await old.waitForElementState('hidden');
  await side.locator('#capture-form [name=content]').waitFor();
}
async function openSite(key) {
  source = await a.context.newPage();
  try {
    const response = await source.goto(spec.sites[key], {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    if (!response?.ok())
      throw new Blocked(
        `真实站点返回 HTTP ${response?.status() || '无响应'}；不以错误页冒充成功。`,
      );
    if (live) {
      const forbidden = /captcha|验证一下|安全验证|访问受限|出错啦|412|403|access denied/i;
      if (forbidden.test((await source.locator('body').innerText()).slice(0, 2000)))
        throw new Blocked('页面出现访问限制或验证，未绕过。');
      if (key === 'wiki')
        await source
          .getByRole('heading', { name: 'Personal knowledge management', exact: true })
          .waitFor();
      if (key === 'chetna') {
        await source.waitForFunction(
          () =>
            document.querySelector(
              'canvas, svg, .leaflet-container, .mapboxgl-map, .maplibregl-map',
            ) && document.body.innerText.length > 100,
          { timeout: 25000 },
        );
      }
      if (key === 'bilibili')
        await source.locator('h1, .video-info-title, #bilibili-player').first().waitFor();
    }
    await source.bringToFront();
    await step(`打开${key}页面并确认可见内容`, '页面主体可见，未将错误页当作业务页面', source);
  } catch (error) {
    if (live && !(error instanceof Blocked))
      throw new Blocked(`真实页面未能就绪：${error.message.slice(0, 250)}`);
    throw error;
  }
}
async function capture(snapshot = false) {
  lastPage = side;
  await source.bringToFront();
  await side.evaluate(
    (type) => document.querySelector(`.type-tab[data-type="${type}"]`).click(),
    snapshot ? 'snapshot' : 'note',
  );
  await side.locator(`[data-pane=${snapshot ? 'snapshot' : 'note'}]:visible`).waitFor();
  await side.evaluate(
    (label) =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === label).click(),
    snapshot ? '捕获网页快照' : '捕获当前网页',
  );
  if (snapshot)
    await side.waitForFunction(
      () => document.querySelector('dialog .record-preview img')?.naturalWidth > 0,
    );
  else
    await side.waitForFunction(() => !!document.querySelector('#capture-form [name=url]')?.value);
}
async function save(id, title) {
  if (title) await side.locator('#capture-form [name=title]').fill(title);
  const prior = new Set((await allRows()).map((row) => row.id));
  const old = await side.locator('#capture-form').elementHandle();
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await old.waitForElementState('hidden');
  await side.waitForFunction(
    async (oldIds) => {
      const { Database } = await import('./lib/db.js'),
        db = new Database('pkm-nexus-v1', { broadcast: false });
      try {
        return (
          (await db.allRows()).some((r) => !oldIds.includes(r.id)) || (await db.captures()).length
        );
      } finally {
        await db.close();
      }
    },
    [...prior],
  );
  const pending = await side.evaluate(async () => {
    const { Database } = await import('./lib/db.js'),
      db = new Database('pkm-nexus-v1', { broadcast: false });
    try {
      return (await db.captures()).length;
    } finally {
      await db.close();
    }
  });
  if (pending) {
    await side.getByRole('button', { name: '查看重复提示', exact: true }).click();
    await side.getByRole('button', { name: '仍然另存一条', exact: true }).click();
  }
  const row = (await allRows()).find((r) => !prior.has(r.id));
  assert.ok(row, `保存 ${id} 后没有新增记录`);
  records.set(id, row);
  await side.locator('#records').filter({ hasText: row.record.title }).waitFor();
  await step('保存到收件箱并核对持久化结果', '保存一条记录；ID、类型与来源/附件正确', side, {
    actual: `${row.record.type}；来源 ${row.record.sources.length}；附件 ${row.record.attachments.length}`,
  });
  return row;
}
async function recording() {
  const opened = a.context.waitForEvent('page', { timeout: 2000 }).catch(() => null);
  await side.getByRole('button', { name: '开始录音', exact: true }).click();
  const auth = await Promise.race([
    opened,
    side
      .getByRole('button', { name: '停止录音', exact: true })
      .waitFor()
      .then(() => null),
  ]);
  if (auth && /microphone/.test(auth.url()))
    await auth.getByRole('button', { name: '允许麦克风', exact: true }).click();
  await side.getByRole('button', { name: '停止录音', exact: true }).waitFor();
  await side.waitForFunction(async () => {
    const { Database } = await import('./lib/db.js'),
      db = new Database('pkm-nexus-v1', { broadcast: false });
    try {
      return (await db.recordings()).some((r) => r.chunks >= 2 && r.duration_ms >= 2000);
    } finally {
      await db.close();
    }
  });
  await step(
    '开始录音，等待至少两个持久化音频片段',
    '界面处于录音状态；虚拟麦克风产生真实 MediaRecorder 数据',
    side,
    { selector: '#capture-form' },
  );
  await side.getByRole('button', { name: '停止录音', exact: true }).click();
  await side.locator('.media-gallery audio').waitFor();
  await side.locator('.media-gallery audio').evaluate(async (audio) => {
    await audio.play();
  });
  await side.waitForFunction(() => document.querySelector('.media-gallery audio')?.currentTime > 0);
  await side.locator('.media-gallery audio').evaluate((audio) => audio.pause());
}
async function companion(name, remote) {
  const settings = new Settings(path.join(run, name));
  await settings.update({ autoSync: false });
  const drive = new DriveClient(
    { token: async () => 'fake-drive-token' },
    { fetchImpl: remote.fetch.bind(remote), sleep: async () => {} },
  );
  const service = await new Service({ settings, drive }).open();
  services.push(service);
  const server = await managementServer(service);
  servers.push(server);
  const ui = await a.context.newPage();
  await ui.goto(server.url);
  await ui.locator('#count').filter({ hasText: '条资料' }).waitFor();
  await ui.evaluate((label) => {
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.textContent = label;
    banner.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#fff0c7;color:#62430b;padding:9px;text-align:center;font:14px system-ui;border-top:1px solid #c99';
    document.body.append(banner);
  }, `验收环境 · ${name} · 模拟 Drive / 测试传输桥 · 不连接 Google 账号`);
  return { service, ui };
}
async function refreshLocal(local) {
  await local.ui.getByRole('button', { name: '刷新', exact: true }).click();
}
async function syncLocal(local) {
  await local.ui.getByRole('button', { name: '立即同步', exact: true }).click();
  await local.ui.waitForFunction(() => !document.querySelector('#sync').disabled);
  await local.ui
    .locator('#notice')
    .filter({ hasText: /同步完成/ })
    .waitFor();
}
async function editLocal(local, id, text) {
  const record = local.service.vault.get(id).record;
  await local.ui.getByRole('button', { name: `打开 ${record.title}`, exact: true }).click();
  await local.ui.locator('#content').fill(text);
  await step('在本地资料库修改同一条记录', '保留原记录 ID，保存正文改动', local.ui, {
    selector: '#editor',
  });
  await local.ui.getByRole('button', { name: '保存修改', exact: true }).click();
  await local.ui.locator('#editor').waitFor({ state: 'hidden' });
}

try {
  a = await launch('office-browser');
  side = await a.context.newPage();
  side.on('pageerror', (error) => report.errors.push(error.message));
  await side.setViewportSize({ width: 480, height: 1050 });
  await side.goto(`chrome-extension://${a.id}/sidepanel.html`);
  await side.locator('#capture-form').waitFor();
  await scenario('N01', async () => {
    await clear();
    await openSite('wiki');
    await capture();
    await step('点击捕获当前网页，进入可编辑草稿', '来源为 Wiki；未选字时正文为空', side, {
      selector: '#capture-form',
    });
    const row = await save('N01', '[演示N01] Wiki 网页');
    assert.equal(row.record.sources[0].url, spec.sites.wiki);
    assert.equal(row.record.content, '');
  });
  await scenario('N02', async () => {
    await clear();
    await side.locator('[name=title]').fill('[演示N02] 本周学习计划');
    await side.locator('[name=content]').fill('先收集，再整理。周五回顾本周资料。');
    await step('输入普通文字笔记', '正文和标题可编辑，草稿留在本机', side, {
      selector: '#capture-form',
    });
    const row = await save('N02');
    await side.getByRole('button', { name: `打开 ${row.record.title}`, exact: true }).click();
    await side.waitForFunction(
      () =>
        document.querySelector('#capture-form [name=content]')?.value ===
        '先收集，再整理。周五回顾本周资料。',
    );
    assert.equal(
      await side.locator('[name=content]').inputValue(),
      '先收集，再整理。周五回顾本周资料。',
    );
    await step('重新打开已保存笔记', '正文逐字一致，编辑原记录', side, {
      selector: '#capture-form',
    });
  });
  await scenario('N03', async () => {
    await clear();
    await side.locator('[name=title]').fill('[演示N03] 口述灵感');
    await side.locator('[name=content]').fill('用声音补充文字。');
    await recording();
    await step('停止录音并实际播放', '音频播放器时间前进，文字和音频属于同一条草稿', side, {
      selector: '#capture-form',
    });
    const row = await save('N03');
    assert.ok(row.record.attachments.some((d) => d.kind === 'audio' && d.size_bytes > 0));
  });
  await scenario('N04', async () => {
    await clear();
    await openSite('chetna');
    await capture();
    await side.locator('[name=title]').fill('[演示N04] CHETNA 阅读记录');
    await side.locator('[name=content]').fill('记录城市排放地图的阅读思路。');
    await side
      .locator('input[type=file]')
      .setInputFiles(path.resolve('extension/icons/penguin.png'));
    await side.waitForFunction(
      () => document.querySelector('.media-gallery img')?.naturalWidth > 0,
    );
    await recording();
    await side.getByRole('button', { name: '预览', exact: true }).click();
    await side.waitForFunction(
      () =>
        document.querySelector('.markdown img')?.naturalWidth > 0 &&
        !!document.querySelector('.markdown audio'),
    );
    assert.equal(await side.locator('.markdown img').count(), 1);
    assert.equal(await side.locator('.markdown audio').count(), 1);
    await step('预览网页来源、文字、图片和音频', '一条草稿同时具有四类内容', side, {
      selector: '#capture-form',
    });
    const row = await save('N04');
    assert.deepEqual(row.record.attachments.map((d) => d.kind).sort(), ['audio', 'image']);
    assert.equal(row.record.sources[0].url, spec.sites.chetna);
  });
  for (const [id, key] of [
    ['P01', 'wiki'],
    ['P02', 'bilibili'],
    ['P03', 'chetna'],
  ])
    await scenario(id, async () => {
      await clear();
      await openSite(key);
      await capture(true);
      await step('捕获当前可见网页区域', '可解码的 PNG 预览与实际页面相符', side, {
        selector: '#capture-form',
      });
      const row = await save(id, `[演示${id}] ${key} 页面快照`);
      assert.equal(row.record.snapshot.url, spec.sites[key]);
      const png = await side.evaluate(async (descriptor) => {
        const { Database } = await import('./lib/db.js'),
          db = new Database('pkm-nexus-v1', { broadcast: false });
        try {
          const blob = (await db.getAsset(descriptor.id)).blob;
          return [...new Uint8Array(await blob.arrayBuffer()).slice(0, 8)];
        } finally {
          await db.close();
        }
      }, row.record.attachments[0]);
      assert.deepEqual(png, [137, 80, 78, 71, 13, 10, 26, 10]);
      await side.getByRole('button', { name: `打开 ${row.record.title}`, exact: true }).click();
      await side.waitForFunction(
        () => document.querySelector('.snapshot-display img')?.naturalWidth > 0,
      );
      await step('重新打开快照', '已保存的图片仍可离线预览', side, { selector: '#capture-form' });
    });
  const themes = [
    ['T01', 'Todo', ['[工作] 整理会议笔记', '[工作] 完成周报']],
    ['T02', 'Todo', ['[生活] 购买咖啡', '[生活] 预约运动']],
    ['T03', 'Idea', ['[学习] 用图谱整理阅读', '[学习] 每周输出一篇总结']],
    ['T04', 'Idea', ['[产品] 快捷语音收集', '[产品] 离线阅读队列']],
  ];
  for (const [id, tab, items] of themes)
    await scenario(id, async () => {
      await clear();
      await side.getByRole('tab', { name: '清单', exact: true }).click();
      await side.locator('[data-pane=list]:visible').waitFor();
      await side.getByRole('tab', { name: tab, exact: true }).click();
      const markdown = side.locator('[name=list_markdown]');
      if (!(await markdown.isVisible())) await side.locator('.list-source summary').click();
      const oldText = await markdown.inputValue();
      await markdown.fill(
        [
          oldText,
          ...(id === 'T02' || id === 'T04' ? ['---'] : []),
          ...items.map((item, index) =>
            tab === 'Todo'
              ? '- [' + (id === 'T01' && index === 0 ? 'x' : ' ') + '] ' + item
              : '- ' + item,
          ),
        ]
          .filter(Boolean)
          .join('\n'),
      );
      await step(`添加${tab}主题组`, '主题项目与分割线按输入顺序显示', side, {
        selector: '#capture-form',
      });
      const old = await side.locator('#capture-form').elementHandle();
      await side
        .getByRole('button', { name: /保存到收件箱|保存修改|保存清单/, exact: true })
        .click();
      await old.waitForElementState('hidden');
      const lists = (await allRows()).filter((r) => r.record.type === 'list');
      assert.equal(lists.length, 1);
      assert.ok(lists[0].record.list.some((i) => i.text === items[1]));
      records.set(id, lists[0]);
      await side.locator('#capture-form').getByRole('tab', { name: '清单', exact: true }).click();
      await side.locator('[data-pane=list]:visible').waitFor();
      await side.locator('#capture-form').getByRole('tab', { name: tab, exact: true }).click();
      assert.ok((await side.locator('[name=list_markdown]').inputValue()).includes(items[1]));
      await step(
        '重新打开同一清单并切换正确模式核对',
        '已有主题、完成状态和同一 ID 都保留；卡片默认 Todo 不等于 Idea 丢失',
        side,
        { selector: '#capture-form' },
      );
    });
  for (const [id, title, keys] of [
    ['G01', 'Bilibili 视频', ['bilibili', 'bilibili2']],
    ['G02', 'Wiki 知识管理', ['wiki', 'wiki2']],
  ])
    await scenario(id, async () => {
      await clear();
      await side.getByRole('tab', { name: '网页组', exact: true }).click();
      await side.locator('[name=title]').fill(`[演示${id}] ${title}`);
      await side.locator('[name=close_tabs]').uncheck();
      for (const [index, key] of keys.entries()) {
        await side.locator('[name=website_url]').fill(spec.sites[key]);
        await side.locator('[name=website_title]').fill(`${title} · ${index + 1}`);
        await side.getByRole('button', { name: '加入链接', exact: true }).click();
        await side.locator('.url-row').nth(index).waitFor();
      }
      if (id === 'G01') await side.locator('.url-row input[type=checkbox]').first().check();
      await step('添加两个来源链接并核对标题', '链接已加入草稿，保存前不关闭任何标签页', side, {
        selector: '#capture-form',
      });
      const row = await save(id);
      assert.equal(row.record.url_list.length, 2);
      if (id === 'G01') assert.ok(row.record.url_list[0].read_at);
    });
  await scenario('O01', async () => {
    const page = a.page;
    await page.bringToFront();
    await page.locator('[data-view=all]').click();
    await page.locator('#search').fill('演示N');
    for (const id of ['N02', 'N03'])
      await page
        .locator('#records article')
        .filter({ hasText: records.get(id).record.title })
        .locator('input[type=checkbox]')
        .first()
        .check();
    await page.getByRole('button', { name: '添加标签', exact: true }).click();
    await page.getByPlaceholder('用逗号分隔，如：学习, 待阅读').fill('演示, 学习');
    await step('批量为两条笔记添加标签', '明确显示选中两条，不改变其他记录', page, {
      selector: 'dialog[open]',
    });
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: '添加标签', exact: true })
      .click();
    for (const id of ['N02', 'N03'])
      await page
        .locator('#records article')
        .filter({ hasText: records.get(id).record.title })
        .locator('input[type=checkbox]')
        .first()
        .check();
    await page.getByRole('button', { name: '标记已整理', exact: true }).click();
    await page.locator('#search').fill('');
    await page.locator('[data-view=organized]').click();
    await page.locator('#records').filter({ hasText: '演示N02' }).waitFor();
    const rows = await allRows();
    assert.equal(rows.filter((r) => r.record.tags.includes('学习')).length, 2);
    assert.equal(
      rows.find((r) => r.id === records.get('N01').id).record.organization_state,
      'inbox',
    );
    await step('在已整理视图核对标签和结果', '仅选中两条被整理；其他记录仍在收件箱', page);
  });
  await scenario('O02', async () => {
    const page = a.page;
    await page.locator('#add-project').click();
    await page.getByLabel('项目名称', { exact: true }).fill('演示知识库');
    await page.getByLabel('项目描述', { exact: true }).fill('整理演示与学习材料');
    await step('设置项目描述', '项目具有独立描述，记录归属由用户选择', page, {
      selector: 'dialog[open]',
    });
    await page.getByRole('button', { name: '保存项目', exact: true }).click();
    await page.locator('[data-view=all]').click();
    for (const id of ['N02', 'N03'])
      await page
        .locator('#records article')
        .filter({ hasText: records.get(id).record.title })
        .locator('input[type=checkbox]')
        .first()
        .check();
    await page
      .locator('#selection-bar')
      .getByRole('button', { name: '加入项目…', exact: true })
      .click();
    await page.getByRole('checkbox', { name: '演示知识库', exact: true }).check();
    await page.getByRole('button', { name: '加入项目', exact: true }).click();
    await page
      .locator('.project-nav')
      .getByRole('button', { name: /演示知识库/ })
      .click();
    await page.getByRole('button', { name: '关系图', exact: true }).click();
    await page.locator('.graph-controls summary').click();
    await page.getByLabel('关系起点', { exact: true }).selectOption(records.get('N02').id);
    await page.getByLabel('关系终点', { exact: true }).selectOption(records.get('N03').id);
    await page.getByLabel('关系说明', { exact: true }).fill('参考');
    await page.getByRole('button', { name: '添加关系', exact: true }).click();
    await page.locator('.graph-edge').waitFor();
    await step('建立项目内关系', '图中显示当前层级记录和连线', page, { selector: 'dialog[open]' });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await scenario('O03', async () => {
    const page = a.page;
    await page.locator('[data-view=all]').click();
    await page.locator('#search').fill('周五');
    await page.locator('#records article').filter({ hasText: '演示N02' }).waitFor();
    assert.equal(await page.locator('#records article').count(), 1);
    await step('按正文关键词搜索', '周五命中本周学习计划一条笔记', page);
    await page.locator('#search').fill('');
    await page.locator('#type-filter [data-type=note]').click();
    await page.locator('#tag-filter').selectOption('学习');
    await page.waitForFunction(() => document.querySelectorAll('#records article').length === 2);
    await step('组合类型和标签筛选', '仅显示两条带学习标签的普通记录', page);
    await page.locator('#tag-filter').selectOption('');
    await page.locator('#type-filter [data-type=""]').click();
  });
  await scenario('O04', async () => {
    const download = a.page.waitForEvent('download');
    await a.page.locator('#save-local').click();
    const file = path.join(run, 'demo-backup.zip');
    await (await download).saveAs(file);
    const entries = await readZip(new Blob([await readFile(file)]));
    const before = await allRows();
    for (const row of before)
      for (const d of row.record.attachments) assert.equal(hash(entries.get(d.path)), d.id);
    await step('下载并校验完整 ZIP', '备份含全部记录及通过 SHA-256 校验的媒体', a.page, {
      actual: `${entries.size} 个 ZIP 条目，含图片和录音`,
    });
    const b = await launch('restore-browser');
    await b.context.setOffline(true);
    await b.page.locator('#settings').click();
    await b.page.locator('input[type=file]').setInputFiles(file);
    await b.page.getByRole('button', { name: '导入到本机', exact: true }).click();
    await b.page.locator('#records article').first().waitFor();
    const after = await allRows(b.page);
    assert.deepEqual(after.map((r) => r.id).sort(), before.map((r) => r.id).sort());
    if (await b.page.locator('dialog[open]').count())
      await b.page
        .locator('dialog[open]')
        .getByRole('button', { name: '关闭', exact: true })
        .click();
    await step('在第二个独立浏览器离线恢复', '相同记录 ID 与媒体完整恢复', b.page, {
      actual: `恢复 ${after.length} 条记录，ID 一致`,
    });
  });
  let remote;
  await scenario('D01', async () => {
    remote = new MockDrive();
    localA = await companion('办公室本地资料库', remote);
    localB = await companion('家庭本地资料库', remote);
    await side.exposeFunction('demoCompanionCall', (command, payload) =>
      localA.service.handle(command, payload),
    );
    await side.evaluate(async () => {
      const { Database } = await import('./lib/db.js'),
        { handoffCompanion } = await import('./lib/companion.js');
      const db = new Database('pkm-nexus-v1', { broadcast: false });
      try {
        await handoffCompanion(db, {
          client: { call: (c, p) => window.demoCompanionCall(c, p), close() {} },
        });
      } finally {
        await db.close();
      }
    });
    await refreshLocal(localA);
    assert.equal(localA.service.vault.get(records.get('N04').id).record.attachments.length, 2);
    await step(
      '通过同一交接实现把浏览器记录交给本地程序',
      '本地界面显示记录，ID 与附件一致；传输桥为测试替代项',
      localA.ui,
    );
  });
  await scenario('D02', async () => {
    assert.ok(localA && localB, '本地资料库尚未就绪');
    const folder = await localA.service.client.createFolder('PKM Nexus 模拟演示库');
    await localA.service.sync.bind(folder.id);
    await localB.service.sync.bind(folder.id);
    await syncLocal(localA);
    await syncLocal(localB);
    assert.ok(localB.service.vault.get(records.get('N02').id));
    await step('办公室上传，家庭端拉取', '同一条记录出现在家庭端；仍为模拟 Drive', localB.ui);
    await editLocal(localB, records.get('N02').id, '家庭端补充：周五回顾后整理下周计划。');
    await syncLocal(localB);
    await syncLocal(localA);
    assert.match(localA.service.vault.get(records.get('N02').id).record.content, /家庭端补充/);
    await localA.ui
      .getByRole('button', { name: `打开 ${records.get('N02').record.title}`, exact: true })
      .click();
    await step('办公室再次同步并打开同一 ID', '可见家庭端修改，未新增重复记录', localA.ui, {
      selector: '#editor',
    });
    await localA.ui.locator('#editor [data-close]').click();
  });
  await scenario('D03', async () => {
    const id = records.get('N02').id;
    await editLocal(localA, id, '办公室离线修改：补充研究资料。');
    await editLocal(localB, id, '家庭离线修改：补充阅读总结。');
    await syncLocal(localA);
    await syncLocal(localB);
    await syncLocal(localA);
    assert.equal(localB.service.vault.get(id).heads.length, 2);
    await localB.ui.locator('[data-view=conflicts]').click();
    await localB.ui
      .getByRole('button', { name: `打开 ${records.get('N02').record.title}`, exact: true })
      .click();
    assert.match(await localB.ui.locator('#conflict-versions').innerText(), /办公室离线修改/);
    assert.match(await localB.ui.locator('#conflict-versions').innerText(), /家庭离线修改/);
    await step('查看过期副本产生的双方版本', '两个版本同时保留，没有自动覆盖', localB.ui, {
      selector: '#editor',
    });
    await localB.ui.getByRole('button', { name: '采用此版本', exact: true }).first().click();
    await syncLocal(localB);
    await syncLocal(localA);
    assert.equal(localA.service.vault.get(id).heads.length, 1);
    assert.equal(localA.service.vault.get(id).hash, localB.service.vault.get(id).hash);
    await step('人工采用一个版本并再次同步', '两端收敛，冲突清除', localA.ui);
    await localB.ui.locator('[data-view=all]').click();
  });
  await scenario('D04', async () => {
    const row = localB.service.vault.get(records.get('N04').id),
      image = row.record.attachments.find((d) => d.kind === 'image');
    assert.equal(await localB.service.vault.assetBytes(image), null);
    await localB.ui.getByRole('button', { name: `打开 ${row.record.title}`, exact: true }).click();
    await step('打开仅有媒体描述的远程记录', '未提前缓存图片，显示主动加载入口', localB.ui, {
      selector: '#editor',
    });
    await localB.ui.getByRole('button', { name: `加载 ${image.name}`, exact: true }).click();
    await localB.ui.waitForFunction(
      () =>
        document.querySelector('#media img')?.naturalWidth > 0 ||
        document.querySelector('#editor img')?.naturalWidth > 0,
    );
    assert.equal(hash(await localB.service.vault.assetBytes(image)), image.id);
    await step('点击加载图片并校验', '按需下载且 SHA-256 一致', localB.ui, { selector: '#editor' });
    await localB.ui.locator('#editor [data-close]').click();
  });
  await scenario('D05', async () => {
    await editLocal(localA, records.get('N03').id, '断网时修改仍保留。');
    remote.failNext = { status: 429, headers: { 'Retry-After': '60' } };
    await localA.ui.getByRole('button', { name: '立即同步', exact: true }).click();
    await localA.ui.locator('#notice.error').waitFor();
    assert.ok((await localA.service.status()).pendingUploads > 0);
    assert.equal(
      localA.service.vault.get(records.get('N03').id).record.content,
      '断网时修改仍保留。',
    );
    await step('模拟上传网络失败', '显示错误，正文与待上传标记保留', localA.ui);
    await syncLocal(localA);
    await syncLocal(localB);
    assert.equal(
      localB.service.vault.get(records.get('N03').id).record.content,
      '断网时修改仍保留。',
    );
    await step('恢复连接后重试同步', '待上传改动成功传到另一端', localB.ui);
  });
  await scenario('D06', async () => {
    await localA.ui.locator('#settings').click();
    await localA.ui.locator('#settings-dialog[open]').waitFor();
    await step('检查真实 Google OAuth 配置入口', '尚未配置真实账号，保持待验收', localA.ui, {
      selector: '#settings-dialog',
      status: 'blocked',
      actual: '没有桌面 OAuth 客户端及真实账号授权；不发起 Google 登录。',
    });
    activeCase.status = 'blocked';
    activeCase.reason = '缺少真实桌面 OAuth 配置与用户授权；模拟结果不替代真实云验收。';
    await localA.ui.locator('#settings-dialog [data-close]').click();
  });
  await scenario('D07', async () => {
    await localA.ui.locator('#settings').click();
    assert.equal(await localA.ui.locator('#auto-sync').isChecked(), false);
    await step('核对每小时同步默认关闭', '未配置真实 Google，不注册 Windows 任务', localA.ui, {
      selector: '#settings-dialog',
      status: 'blocked',
      actual: '本轮未注册任务、未等待一小时；需要完成 D06 后在两台 Windows 验收。',
    });
    activeCase.status = 'blocked';
    activeCase.reason = '依赖真实 OAuth 和双 Windows 环境；本轮不运行计划任务。';
    await localA.ui.locator('#settings-dialog [data-close]').click();
  });
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = Object.fromEntries(
    ['passed', 'failed', 'blocked'].map((status) => [
      status,
      report.cases.filter((c) => c.status === status).length,
    ]),
  );
  report.summary.notRun = spec.cases
    .filter((c) => !report.cases.some((r) => r.id === c.id))
    .map((c) => c.id);
  await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await mkdir('docs/demo-results', { recursive: true });
  await writeFile(`docs/demo-results/${mode}.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(
    'test-results/demo-latest.json',
    JSON.stringify({ run, mode, extension: a?.extension, id: a?.id }, null, 2),
  );
  for (const context of contexts) await context.close();
  for (const server of servers) await new Promise((resolve) => server.server.close(resolve));
  for (const service of services) await service.close();
  console.log('REPORT ' + path.relative(root, path.join(run, 'report.json')));
  console.log(JSON.stringify(report.summary));
  if (report.summary.failed || report.errors.length) process.exitCode = 1;
}

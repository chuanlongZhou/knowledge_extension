import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
import { readZip } from '../extension/lib/zip.js';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'export-layout-'));
const checks = [],
  errors = [];
const pass = (text) => {
  checks.push(text);
  console.log('PASS ' + text);
};
const decode = (bytes) => new TextDecoder().decode(bytes);
let context, page;
try {
  const extension = path.resolve('dist/pkm-nexus');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1060 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${worker.url().split('/')[2]}/dashboard.html`);
  await page.locator('#heading').waitFor();
  const fixture = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js'),
      { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const parent = newRecord({
      schema_version: 5,
      type: 'project',
      title: '研究计划',
      summary: '项目描述可读',
    });
    const child = newRecord({
      schema_version: 5,
      type: 'project',
      title: '阅读',
      parent_project_id: parent.id,
    });
    const other = newRecord({ schema_version: 5, type: 'project', title: '资料库' });
    const image = await db.storeAsset(
      await (await fetch('./icons/icon-128.png')).blob(),
      '图片.png',
    );
    const note = newRecord({
      title: '收集图片',
      content: `![图片](${image.path})`,
      tags: ['阅读', '资料'],
      project_ids: [child.id, other.id],
      attachments: [image],
    });
    await db.saveMany(
      [
        parent,
        child,
        other,
        note,
        newRecord({ title: '临时想法' }),
        newRecord({ title: '收集图片', project_ids: [child.id] }),
      ].map((record) => ({ record })),
    );
    await db.renameTag('阅读', '阅读', '#3e6868', '用于整理阅读笔记');
    await db.close();
    return { noteId: note.id, asset: image.path };
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.locator('#settings').click();
  const settings = page.getByRole('dialog', { name: '设置与数据管理', exact: true });
  await settings.getByRole('button', { name: '导出备份（完整 ZIP）', exact: true }).click();
  let chooser = page.getByRole('dialog', { name: '选择导出整理方式', exact: true });
  assert.equal(await chooser.getByLabel('文件夹整理方式', { exact: true }).inputValue(), 'project');
  await chooser.getByRole('button', { name: '取消', exact: true }).click();
  await settings.waitFor();
  assert.equal(downloads, 0);
  pass('完整 ZIP 导出前选择项目 / 标签 / 不分类；取消不生成下载且保留设置页');

  await settings.getByRole('button', { name: '导出备份（完整 ZIP）', exact: true }).click();
  chooser = page.getByRole('dialog', { name: '选择导出整理方式', exact: true });
  const fullEvent = page.waitForEvent('download');
  await chooser.getByRole('button', { name: '开始导出', exact: true }).click();
  const full = await fullEvent,
    fullPath = path.join(output, 'project-organized-backup.zip');
  await full.saveAs(fullPath);
  const files = await readZip(new Blob([await readFile(fullPath)]));
  const index = JSON.parse(decode(files.get('export-index.json')));
  const paths = index.records.find((record) => record.id === fixture.noteId).paths;
  assert.equal(paths.length, 2);
  assert.ok(paths.some((name) => name.startsWith('notes/项目/研究计划/阅读/收集图片')));
  assert.ok(paths.includes('notes/项目/资料库/收集图片.md'));
  assert.match(decode(files.get('notes/项目/研究计划/研究计划.md')), /项目描述可读/);
  assert.equal([...files.keys()].filter((name) => name.startsWith('assets/')).length, 1);
  assert.ok(files.has(fixture.asset));
  assert.equal(JSON.parse(decode(files.get('backup.json'))).records.length, 6);
  for (const name of paths) {
    const relative = decode(files.get(name)).match(/!\[图片\]\(([^)]+)\)/)[1];
    assert.ok(files.has(path.posix.normalize(path.posix.join(path.posix.dirname(name), relative))));
  }
  pass(
    '按项目导出保留项目层级、原名、描述和多项目阅读副本；重名不覆盖，共享图片路径完整，恢复数据唯一',
  );

  await settings.getByRole('button', { name: '导出 Markdown（含图片 ZIP）', exact: true }).click();
  chooser = page.getByRole('dialog', { name: '选择导出整理方式', exact: true });
  await chooser.getByLabel('文件夹整理方式', { exact: true }).selectOption('tag');
  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await chooser.evaluate((node) => node.scrollWidth > node.clientWidth), false);
  await chooser.getByRole('button', { name: '开始导出', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'export-layout-narrow.png') });
  const tagEvent = page.waitForEvent('download');
  await chooser.getByRole('button', { name: '开始导出', exact: true }).click();
  const tagDownload = await tagEvent,
    tagPath = path.join(output, 'tag-organized-markdown.zip');
  await tagDownload.saveAs(tagPath);
  const tagFiles = await readZip(new Blob([await readFile(tagPath)]));
  assert.ok(tagFiles.has('notes/标签/阅读/收集图片.md'));
  assert.ok(tagFiles.has('notes/标签/资料/收集图片.md'));
  assert.ok(tagFiles.has('notes/未打标签/临时想法.md'));
  assert.match(decode(tagFiles.get('notes/标签/阅读/阅读.md')), /用于整理阅读笔记/);
  assert.equal(tagFiles.has('backup.json'), false);
  assert.deepEqual(errors, []);
  pass('360px 可操作分类选择与导出；标签目录含原名、未打标签记录、标签描述和图片原文件');
  await writeFile(
    path.join(output, 'export-layout-browser-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'export-layout-failure.png') }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  if (
    !profile.startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('export-layout-')
  )
    throw new Error('Unexpected profile path');
  await rm(profile, { recursive: true, force: true });
}

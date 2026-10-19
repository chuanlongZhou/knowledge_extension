import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'stability-profile-')),
  checks = [];
let context;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const url = `chrome-extension://${worker.url().split('/')[2]}/dashboard.html`;
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    await db.save(
      newRecord({
        schema_version: 2,
        type: 'todo',
        title: '旧版回收站记录',
        deleted_at: new Date().toISOString(),
      }),
    );
    await db.close();
  });
  await page.locator('[data-view=trash]').click();
  await page.locator('#records article').filter({ hasText: '旧版回收站记录' }).waitFor();
  assert.doesNotMatch(await page.locator('#toast').innerText(), /TASK_STATUSES|undefined/);
  checks.push('旧版回收站待办正常渲染');
  await page.locator('[data-view=pending]').click();
  await page.locator('#records article').filter({ hasText: '旧版回收站记录' }).waitFor();
  checks.push('待同步列表包含回收站修改');
  await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1');
    const row = (await db.allRows())[0];
    await db.purge(row.id);
    await db.close();
  });
  await page.locator('#records article').filter({ hasText: '删除标记' }).waitFor();
  checks.push('移除正文后的删除标记可查看待同步状态');
  await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    await db.save(newRecord({ schema_version: 2, type: 'todo', title: '多窗口迁移' }));
    await db.close();
  });
  await page.close();
  const a = await context.newPage(),
    b = await context.newPage();
  await Promise.all([a.goto(url), b.goto(url)]);
  await Promise.all([
    a.locator('#heading').filter({ hasText: '待同步' }).waitFor(),
    b.locator('#heading').filter({ hasText: '待同步' }).waitFor(),
  ]);
  assert.equal(
    await a
      .locator('#records')
      .innerText()
      .then((t) => t.includes('无法打开本地数据库')),
    false,
  );
  const list = await a.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database('pkm-nexus-v1', { broadcast: false });
    const rows = await db.allRows();
    await db.close();
    return rows.filter((r) => r.record.type === 'list').map((r) => r.record.list);
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].length, 1);
  assert.deepEqual(errors, []);
  checks.push('两个真实页面同时迁移旧待办成功');
  await writeFile(
    path.join(output, 'stability-browser-report.json'),
    JSON.stringify({ checks }, null, 2),
  );
  for (const check of checks) console.log('PASS ' + check);
} finally {
  await context?.close();
  if (
    !profile.startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('stability-profile-')
  )
    throw new Error('Unexpected test profile');
  await rm(profile, { recursive: true, force: true });
}

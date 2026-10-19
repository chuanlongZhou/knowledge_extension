import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'settings-websites-'));
const checks = [],
  errors = [];
const pass = (text) => {
  checks.push(text);
  console.log('PASS ' + text);
};
let context, page;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1440, height: 1200 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const waitAsync = async (predicate, argument) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await page.evaluate(predicate, argument)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Asynchronous browser condition did not become true');
  };
  await page.clock.install();
  await page.goto(base + 'dashboard.html');
  await page.locator('#heading').filter({ hasText: '收件箱' }).waitFor();
  const ids = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const item = (i) => ({
      id: crypto.randomUUID(),
      url: `https://example.test/${i}`,
      title: `网页 ${i}`,
      added_at: new Date().toISOString(),
      read_at: i === 0 ? new Date().toISOString() : null,
    });
    const websites = Array.from({ length: 9 }, (_, i) => item(i));
    const source = newRecord({
      type: 'website_group',
      title: '来源网页组',
      content: '来源组说明保留',
      tags: ['保留标签'],
      url_list: websites,
    });
    const target = newRecord({
      type: 'website_group',
      title: '目标网页组',
      url_list: [{ ...item(0), title: '目标已有网页' }],
    });
    const other = newRecord({ type: 'website_group', title: '另一个网页组' });
    const project = newRecord({ type: 'project', title: '整组拖放项目' });
    await db.saveMany([source, target, other, project].map((record) => ({ record })));
    await db.setState('onboarding:examples-visible', false);
    await db.close();
    document.addEventListener(
      'drop',
      (event) => {
        globalThis.lastDropTypes = [...event.dataTransfer.types];
      },
      true,
    );
    return { source: source.id, target: target.id, other: other.id, project: project.id, websites };
  });
  const card = (id) => page.locator(`#records article[data-record-id="${id}"]`);
  const row = (id) =>
    page.evaluate(async (id) => {
      const { Database } = await import('./lib/db.js');
      const db = new Database();
      const row = await db.get(id);
      await db.close();
      return row.record;
    }, id);
  await card(ids.source).waitFor();
  await card(ids.source)
    .getByRole('button', { name: '移动单个网页 网页 0', exact: true })
    .dragTo(card(ids.target));
  await waitAsync(async (id) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const record = (await db.get(id)).record;
    await db.close();
    return record.url_list.length === 8;
  }, ids.source);
  assert.equal((await row(ids.target)).url_list.length, 1);
  assert.ok((await row(ids.target)).url_list[0].read_at);
  assert.deepEqual(await page.evaluate(() => globalThis.lastDropTypes), [
    'application/x-pkm-website-item',
  ]);
  await card(ids.source)
    .getByRole('button', { name: '移动单个网页 网页 0', exact: true })
    .waitFor({ state: 'detached' });
  pass('真实拖动单网页柄只移动一个网页；相同网址合并并保留已读状态');
  await card(ids.source).getByRole('link').filter({ hasText: '网页 1' }).dragTo(card(ids.other));
  await waitAsync(async (id) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const record = (await db.get(id)).record;
    await db.close();
    return record.url_list.length === 1;
  }, ids.other);
  assert.equal((await row(ids.source)).url_list.length, 7);
  assert.equal((await row(ids.other)).url_list[0].id, ids.websites[1].id);
  await card(ids.source)
    .getByRole('button', { name: '移动单个网页 网页 1', exact: true })
    .waitFor({ state: 'detached' });
  pass('直接拖动网页标题同样使用单网页数据，不经过标签页匹配或关闭逻辑');
  await card(ids.source)
    .getByRole('button', { name: '拖动整个网页组 来源网页组', exact: true })
    .dragTo(page.locator(`.project-nav[data-project-id="${ids.project}"]`));
  await waitAsync(async (id) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const record = (await db.get(id)).record;
    await db.close();
    return record.project_ids.length === 1;
  }, ids.source);
  assert.deepEqual(await page.evaluate(() => globalThis.lastDropTypes), [
    'application/x-pkm-records',
  ]);
  assert.equal((await row(ids.source)).url_list.length, 7);
  pass('整组拖动柄仅携带记录数据，加入项目时整组网页保持完整');
  await card(ids.source).locator('.record-top h2').click();
  const preview = page.getByRole('dialog', { name: '预览记录', exact: true });
  await preview.getByRole('button', { name: '移动单个网页 网页 8', exact: true }).click();
  const move = page.getByRole('dialog', { name: '移动单个网页', exact: true });
  await move.getByLabel('目标网页组').selectOption(ids.other);
  await move.getByRole('button', { name: '移动网页', exact: true }).click();
  await card(ids.source)
    .getByRole('button', { name: '移动单个网页 网页 8', exact: true })
    .waitFor({ state: 'detached' });
  assert.equal((await row(ids.other)).url_list.length, 2);
  await page.screenshot({ path: path.join(output, 'website-item-drag.png') });
  pass('完整预览里的网页可点击选择目标组，覆盖五条缩略列表之外的项目与键盘操作');
  await card(ids.source).locator('.record-top h2').dragTo(card(ids.target));
  await waitAsync(async (id) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const record = (await db.get(id)).record;
    await db.close();
    return record.url_list.length === 0;
  }, ids.source);
  assert.equal((await row(ids.target)).url_list.length, 7);
  assert.equal((await row(ids.source)).content, '来源组说明保留');
  assert.deepEqual((await row(ids.source)).tags, ['保留标签']);
  await card(ids.source).getByText('0 个网页 · 0 个未读', { exact: true }).waitFor();
  await card(ids.target).dragTo(page.locator(`.project-nav[data-project-id="${ids.project}"]`), {
    sourcePosition: { x: 5, y: 5 },
  });
  await waitAsync(async (id) => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const record = (await db.get(id)).record;
    await db.close();
    return record.project_ids.length === 1;
  }, ids.target);
  assert.equal((await row(ids.target)).url_list.length, 7);
  pass('拖动标题可整组并入另一网页组，卡片空白也可整组加入项目；来源文字与标签保留');

  await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    await db.setState('drive:binding', {
      accountId: 'fixture',
      folderId: 'fixture_folder',
      name: '个人知识资料库',
    });
    await chrome.storage.local.set({
      driveAccount: { id: 'fixture', email: 'fixture@example.test' },
    });
    await db.close();
  });
  await page.locator('#settings').click();
  const settings = page.getByRole('dialog', { name: '设置与数据管理', exact: true });
  const folder = settings.getByRole('link', { name: '打开 Google Drive 目录', exact: true });
  assert.equal(
    await folder.getAttribute('href'),
    'https://drive.google.com/drive/folders/fixture_folder',
  );
  assert.equal(await folder.getAttribute('target'), '_blank');
  await context.route('https://drive.google.com/drive/folders/fixture_folder', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Folder fixture</title>' }),
  );
  const [openedFolder] = await Promise.all([context.waitForEvent('page'), folder.click()]);
  await openedFolder.waitForURL('https://drive.google.com/drive/folders/fixture_folder');
  await openedFolder.close();
  await page.bringToFront();
  const desktopLayout = await settings.evaluate((dialog) => {
    const body = dialog.querySelector('.dialog-body'),
      cards = [...body.querySelectorAll(':scope > .settings-section')];
    return {
      scrolls: body.scrollHeight > body.clientHeight,
      outerOverflow: dialog.scrollHeight > dialog.clientHeight + 1,
      padding: cards.map((card) => getComputedStyle(card).padding),
      bodyOverflow: body.scrollWidth > body.clientWidth,
    };
  });
  assert.ok(desktopLayout.scrolls);
  assert.equal(desktopLayout.outerOverflow, false);
  assert.equal(desktopLayout.bodyOverflow, false);
  assert.ok(desktopLayout.padding.every((value) => value === '22px'));
  await page.screenshot({ path: path.join(output, 'settings-redesign-desktop.png') });
  pass('设置卡片使用统一留白，桌面只有内容区滚动；目录按钮指向当前绑定文件夹的新标签页');

  const mascot = settings.getByRole('region', { name: '页面企鹅与伙伴', exact: true });
  await mascot.getByRole('button', { name: '固定显示发呆黑猫', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.sidebar .brand-penguin').dataset.mascot === 'black-cat',
  );
  const alpha = await mascot.locator('.mascot-choice img').evaluateAll(async (images) => {
    const output = [];
    for (const image of images.slice(1)) {
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0,
        opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) transparent++;
        if (pixels[i] >= 240) opaque++;
      }
      output.push({
        transparent,
        opaque,
        corners: [pixels[3], pixels[(canvas.width - 1) * 4 + 3], pixels[pixels.length - 1]],
      });
    }
    return output;
  });
  assert.equal(alpha.length, 5);
  for (const item of alpha) {
    assert.ok(item.transparent > 1000);
    assert.ok(item.opaque > 1000);
    assert.deepEqual(item.corners, [0, 0, 0]);
  }
  const panel = await context.newPage();
  panel.on('pageerror', (error) => errors.push(error.message));
  await panel.setViewportSize({ width: 360, height: 960 });
  await panel.goto(base + 'sidepanel.html');
  await panel.locator('.panel-brand img[data-mascot="black-cat"]').waitFor();
  await page.bringToFront();
  await page.clock.fastForward('01:00');
  assert.equal(
    await page.locator('.sidebar .brand-penguin').getAttribute('data-mascot'),
    'black-cat',
  );
  await mascot
    .getByLabel('伙伴更换间隔')
    .isDisabled()
    .then((disabled) => assert.ok(disabled));
  await mascot.getByLabel('伙伴显示方式').selectOption('cycle');
  await mascot.getByLabel('伙伴更换间隔').selectOption('10');
  await waitAsync(
    async () => (await chrome.storage.local.get('uiMascot')).uiMascot.interval === 10,
  );
  await page.clock.fastForward('00:11');
  assert.equal(
    await page.locator('.sidebar .brand-penguin').getAttribute('data-mascot'),
    'original',
  );
  await mascot.getByLabel('伙伴显示方式').selectOption('random');
  const before = await page.locator('.sidebar .brand-penguin').getAttribute('data-mascot');
  await page.clock.fastForward('00:11');
  assert.notEqual(
    await page.locator('.sidebar .brand-penguin').getAttribute('data-mascot'),
    before,
  );
  await mascot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'mascot-modes-desktop.png') });
  await mascot.getByRole('button', { name: '固定显示手绘企鹅', exact: true }).click();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await page.locator('.sidebar img[data-mascot="sketched-penguin"]').waitFor();
  await panel.locator('.panel-brand img[data-mascot="sketched-penguin"]').waitFor();
  pass('五张 PNG 确有透明通道；固定模式、按间隔循环、不连续重复的随机模式、跨页更新与刷新保存通过');

  await panel.bringToFront();
  const [narrowPage] = await Promise.all([
    context.waitForEvent('page'),
    panel.locator('#panel-settings').click(),
  ]);
  narrowPage.on('pageerror', (error) => errors.push(error.message));
  await narrowPage.setViewportSize({ width: 360, height: 960 });
  const narrow = narrowPage.getByRole('dialog', { name: '设置与数据管理', exact: true });
  await narrow.waitFor();
  assert.equal(await narrow.evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth), false);
  assert.equal(
    await narrow.locator('.dialog-body').evaluate((body) => body.scrollWidth > body.clientWidth),
    false,
  );
  const footer = await narrow.locator('.dialog-footer').boundingBox();
  assert.ok(footer.y >= 0 && footer.y + footer.height <= 960);
  await narrowPage.screenshot({ path: path.join(output, 'settings-redesign-narrow.png') });
  await narrow.locator('.mascot-settings').scrollIntoViewIfNeeded();
  await narrowPage.screenshot({ path: path.join(output, 'mascot-modes-narrow.png') });
  pass('360px 设置页无横向溢出，关闭按钮可见，图片选项自动变为三列');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'settings-and-websites-report.json'),
    JSON.stringify({ checks, errors, alpha }, null, 2),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, 'settings-and-websites-failure.png') })
    .catch(() => {});
  await writeFile(path.join(output, 'settings-and-websites-failure.txt'), String(error.stack));
  throw error;
} finally {
  await context?.close();
  if (
    !path.resolve(profile).startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('settings-websites-')
  )
    throw new Error('Unexpected test profile path');
  await rm(profile, { recursive: true, force: true });
}

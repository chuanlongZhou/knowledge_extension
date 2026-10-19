import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'language-'));
let context;
const checks = [],
  errors = [];
const pass = (text) => {
  checks.push(text);
  console.log('PASS ' + text);
};
try {
  const extension = path.resolve('dist/pkm-nexus');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1440, height: 1100 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  let [worker] = context.serviceWorkers();
  worker ||= await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  const page = await context.newPage();
  await page.goto(base + 'dashboard.html#settings');
  await page.locator('#interface-language').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  const before = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js'),
      { newRecord } = await import('./lib/model.js');
    const db = new Database();
    const project = {
      ...newRecord({ title: '项目' }),
      type: 'project',
      schema_version: 5,
      summary: '用户项目描述：保存',
      parent_project_id: null,
      graph: { edges: [] },
    };
    const record = {
      ...newRecord({
        title: '取消',
        content: '保存，不要翻译我的正文。',
        tags: ['标签'],
        sources: [
          {
            url: 'https://example.test/read',
            title: '网页标题',
            kind: 'web_page',
            captured_at: new Date().toISOString(),
          },
        ],
      }),
      schema_version: 5,
      project_ids: [project.id],
      favorite: true,
    };
    await db.saveMany([{ record: project }, { record }]);
    await chrome.storage.local.set({
      startPage: {
        enabled: false,
        decided: true,
        favoritesLimit: 8,
        shortcuts: [{ id: 'user-site', name: '设置与数据管理', url: 'https://example.test/' }],
      },
    });
    const rows = await Promise.all((await db.allCatalog()).map((row) => db.get(row.id)));
    await db.close();
    return rows.map((row) => ({ id: row.id, hash: row.hash, rev: row.rev, record: row.record }));
  });
  for (const [language, inbox, settings, hero, guide] of [
    ['en', 'Inbox', 'Settings & data', 'What’s on your mind today?', '1. Capture and organize'],
    [
      'fr',
      'Boîte de réception',
      'Paramètres et données',
      'Qu’avez-vous en tête aujourd’hui ?',
      '1. Capturer et classer',
    ],
    ['ja', '受信箱', '設定とデータ管理', '今日は、何をしましょう？', '1. 収集と整理'],
    ['zh-CN', '收件箱', '设置与数据管理', '今天，想做点什么？', '1. 收集与离线保存'],
  ]) {
    await page.locator('#interface-language').selectOption(language);
    await page.locator('#apply-language').click();
    await page.waitForFunction(
      (language) =>
        document.documentElement.lang === language &&
        document.querySelector('#interface-language')?.value === language,
      language,
    );
    await page.getByRole('dialog', { name: settings, exact: true }).waitFor();
    assert.match(await page.locator('#nav').innerText(), new RegExp(inbox));
    assert.equal(
      await page.locator('#sort-mode option[value=updated_at]').innerText(),
      { en: 'Last modified', fr: 'Dernière modification', ja: '更新日時', 'zh-CN': '最近修改时间' }[
        language
      ],
    );
    const home = await context.newPage();
    await home.goto(base + 'start.html');
    await home.getByRole('heading', { name: hero, exact: true }).waitFor();
    await home
      .locator('#favorite-cards')
      .getByRole('heading', { name: '取消', exact: true })
      .waitFor();
    assert.match(await home.locator('#project-cards').innerText(), /用户项目描述：保存/);
    assert.equal(await home.locator('#site-dock .dock-link').innerText(), '设置与数据管理');
    await home.locator('#project-cards .project-card').click();
    const projectDialog = home.getByRole('dialog', { name: '项目', exact: true });
    await projectDialog.waitFor();
    assert.match(await projectDialog.innerText(), /取消/);
    await projectDialog.locator('.dialog-header button').click();
    if (language === 'en')
      await home.screenshot({ path: path.join(output, 'start-page-english.png'), fullPage: true });
    await home.setViewportSize({ width: 360, height: 950 });
    assert.equal(
      await home.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      language + ' home overflow',
    );
    if (language === 'ja')
      await home.screenshot({ path: path.join(output, 'start-page-japanese.png'), fullPage: true });
    await home.close();
    const manual = await context.newPage();
    await manual.goto(base + 'manual.html');
    await manual
      .locator('#guide-content')
      .getByRole('heading', { name: guide, exact: true })
      .waitFor();
    await manual.close();
    if (language === 'ja') {
      const japanesePanel = await context.newPage();
      await japanesePanel.setViewportSize({ width: 360, height: 950 });
      await japanesePanel.goto(base + 'sidepanel.html');
      await japanesePanel.locator('#capture-form').waitFor();
      assert.equal(
        await japanesePanel.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'Japanese sidebar overflow',
      );
      await japanesePanel.screenshot({ path: path.join(output, 'sidebar-japanese.png') });
      await japanesePanel.close();
    }
    await page.setViewportSize({ width: 360, height: 950 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      language + ' settings overflow',
    );
    if (language === 'fr')
      await page.screenshot({ path: path.join(output, 'settings-french.png') });
    await page.setViewportSize({ width: 1440, height: 1100 });
    pass(
      language +
        '：设置、导航、排序、启动页、项目详情和说明书生效，用户标题 / 标签 / Dock 原文保留，360px 无横向溢出',
    );
  }
  const panel = await context.newPage();
  await panel.goto(base + 'sidepanel.html');
  await panel.locator('#capture-form [name=title]').fill('标签');
  await panel.locator('#capture-form [name=content]').fill('保存，不要翻译我的草稿。');
  const openedSettings = context.waitForEvent('page');
  await panel.locator('#panel-settings').click();
  const panelSettingsPage = await openedSettings;
  await panelSettingsPage.locator('#interface-language').selectOption('fr');
  await panelSettingsPage.locator('#apply-language').click();
  await panelSettingsPage.waitForFunction(
    () =>
      document.documentElement.lang === 'fr' &&
      document.querySelector('#interface-language')?.value === 'fr',
  );
  await panel.reload();
  await panel.locator('#capture-form').waitFor();
  assert.equal(await panel.locator('html').getAttribute('lang'), 'fr');
  assert.equal(await panel.locator('#capture-form [name=title]').inputValue(), '标签');
  assert.equal(
    await panel.locator('#capture-form [name=content]').inputValue(),
    '保存，不要翻译我的草稿。',
  );
  assert.equal(await worker.evaluate(() => chrome.action.getTitle({})), 'Ouvrir GUGA Knowledge');
  await panel.setViewportSize({ width: 360, height: 950 });
  assert.equal(
    await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'French sidebar overflow',
  );
  await panel.screenshot({ path: path.join(output, 'sidebar-french.png') });
  pass('侧栏应用语言前保存未提交草稿，重载后原文和编辑状态恢复；后台工具栏标题随设置更新');
  const after = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const rows = await Promise.all((await db.allCatalog()).map((row) => db.get(row.id)));
    await db.close();
    return rows.map((row) => ({ id: row.id, hash: row.hash, rev: row.rev, record: row.record }));
  });
  assert.deepEqual(after, before);
  assert.deepEqual(errors, []);
  pass('四种语言切换不改变记录 JSON、哈希或修订，不创建内容副本');
  await writeFile(
    path.join(output, 'language-browser-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  if (context)
    for (const [i, p] of context.pages().entries())
      await p.screenshot({ path: path.join(output, `language-failure-${i}.png`) }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  if (!profile.startsWith(output + path.sep) || !path.basename(profile).startsWith('language-'))
    throw Error('Unexpected profile path');
  await rm(profile, { recursive: true, force: true });
}

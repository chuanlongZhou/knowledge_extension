import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'guide-profile-'));
let context;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1320, height: 950 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2],
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.locator('#manual').waitFor();
  await context.setOffline(true);
  const opened = context.waitForEvent('page');
  await page.locator('#manual').click();
  const manual = await opened;
  await manual.waitForURL('**/manual.html');
  const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  await manual
    .getByRole('heading', { name: `GUGA Knowledge ${version} 使用说明书`, exact: true })
    .waitFor();
  assert.match(await manual.locator('#guide-content').innerText(), /登录自己的 Google Drive/);
  assert.doesNotMatch(
    await manual.locator('#guide-content').innerText(),
    /安装本地应用|本地资料库|每小时任务|Native Messaging/,
  );
  await manual.evaluate(async () => {
    for (const img of document.querySelectorAll('#guide-content img')) {
      const response = await fetch(img.src);
      if (!response.ok) throw new Error('Missing image: ' + img.getAttribute('src'));
      const bitmap = await createImageBitmap(await response.blob());
      if (!bitmap.width || !bitmap.height) throw new Error('Empty guide image');
      bitmap.close();
    }
  });
  await manual.locator('#guide-search').fill('同步下载');
  assert.equal(await manual.locator('#guide-toc a').count(), 1);
  await manual.locator('#guide-search').fill('');
  assert.match(await manual.locator('#guide-source').getAttribute('href'), /使用说明书\.md/);
  await manual.screenshot({ path: path.join(output, 'direct-guide.png') });
  await manual.locator('#read-tests').click();
  await manual.getByRole('heading', { name: '简化版验证流程', exact: true }).waitFor();
  assert.match(await manual.locator('#guide-content').innerText(), /真实 Chrome/);
  await manual.screenshot({ path: path.join(output, 'direct-guide-tests.png') });
  await manual.setViewportSize({ width: 360, height: 950 });
  assert.equal(
    await manual.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  const side = await context.newPage();
  await side.goto(`chrome-extension://${id}/sidepanel.html`);
  const openedPanel = context.waitForEvent('page');
  await side.getByRole('button', { name: '使用说明书', exact: true }).click();
  await (await openedPanel).waitForURL('**/manual.html');
  const unsafe = await manual.evaluate(async () => {
    const { renderGuide } = await import('./lib/guide.js');
    const { root } = renderGuide(
      '<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))\n![remote](https://evil.example/x.png)\n![escape](images/../../private.png)\n![local](images/guide-h01-01.png)',
    );
    return {
      scripts: root.querySelectorAll('script').length,
      images: root.querySelectorAll('img').length,
      links: [...root.querySelectorAll('a')].map((a) => a.href),
      text: root.textContent,
    };
  });
  assert.equal(unsafe.scripts, 0);
  assert.equal(unsafe.images, 1);
  assert.ok(
    unsafe.links.every((href) => href.startsWith(`chrome-extension://${id}/guide/images/`)),
  );
  assert.match(unsafe.text, /<img src=x/);
  assert.deepEqual(errors, []);
  const result = {
    mode: 'guide',
    extensionVersion: await manual.evaluate(() => chrome.runtime.getManifest().version),
    startedAt: new Date().toISOString(),
    cases: [
      {
        id: 'H01',
        status: 'passed',
        steps: [
          {
            action: '从整理页打开内置使用说明书',
            expected: '新版说明书断网可读，目录完整',
            actual: '直接同步说明、目录检索、Markdown 来源和两个帮助入口均通过',
            status: 'passed',
            image: 'direct-guide.png',
          },
          {
            action: '查看可重复测试流程',
            expected: '简化版验证步骤与命令随包提供',
            actual: '验证步骤可读，360px 无横向溢出；不执行 Markdown HTML 或脚本链接',
            status: 'passed',
            image: 'direct-guide-tests.png',
          },
        ],
      },
    ],
  };
  await writeFile(
    path.join(output, 'guide-browser-report.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log('PASS H01 两个入口、新版断网文档、目录、窄屏和安全渲染');
} finally {
  await context?.close();
  if (
    !profile.startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('guide-profile-')
  )
    throw new Error('Unexpected guide test profile');
  await rm(profile, { recursive: true, force: true });
}

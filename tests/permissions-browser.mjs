import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'permissions-profile-')),
  checks = [],
  errors = [];
let context;
const pass = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1100, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  await context.route('https://capture.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Capture permission fixture</title><p id="selection">Selected text survives permission retry.</p>',
    }),
  );
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2],
    side = await context.newPage();
  side.on('pageerror', (e) => errors.push(e.message));
  await side.goto(`chrome-extension://${id}/sidepanel.html`);
  await side.locator('#capture-form').waitFor();
  await side.locator('#capture-form [name=content]').fill('Unsaved draft stays intact.');
  assert.equal(
    await side.evaluate(() =>
      chrome.permissions.contains({ origins: ['https://capture.example/*'] }),
    ),
    false,
  );
  const site = await context.newPage();
  await site.goto('https://capture.example/first');
  await site.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#selection'));
    getSelection().addRange(range);
  });
  const capture = async () => {
    // Dispatch in the extension document without activating it as the target web tab.
    await side.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === '捕获当前网页')
        .click(),
    );
    await side.locator('.capture-access:visible').waitFor();
  };
  await capture();
  assert.match(await side.locator('.capture-access').innerText(), /capture\.example/);
  assert.doesNotMatch(await side.locator('.error-text').innerText(), /网站访问设置/);
  assert.equal(
    await side.locator('#capture-form [name=content]').inputValue(),
    'Unsaved draft stays intact.',
  );
  pass('生产 manifest 默认无网站授权，捕获失败展示可操作的单站授权入口');
  await side.setViewportSize({ width: 360, height: 1000 });
  await side.screenshot({ path: path.join(output, 'capture-permission-prompt.png') });

  // The native Chrome permission confirmation is not a web DOM dialog. Exercise
  // denial deterministically, then use Chrome's extension-management API to grant
  // real permissions in this disposable profile and call the real request API.
  await side.evaluate(() => {
    const request = chrome.permissions.request.bind(chrome.permissions);
    globalThis.permissionRequests = [];
    globalThis.denyPermission = true;
    document.addEventListener(
      'click',
      (event) => {
        globalThis.permissionClickTrusted = event.isTrusted;
      },
      true,
    );
    chrome.permissions.request = (permissions) => {
      globalThis.permissionRequests.push({
        permissions,
        trustedClick: globalThis.permissionClickTrusted,
      });
      return globalThis.denyPermission ? Promise.resolve(false) : request(permissions);
    };
  });
  const allowSite = () => side.getByRole('button', { name: '允许访问此网站并重试', exact: true });
  await allowSite().click();
  await side.locator('.error-text').filter({ hasText: '未获得网站授权' }).waitFor();
  assert.equal(await allowSite().isEnabled(), true);
  assert.equal(
    await side.locator('#capture-form [name=content]').inputValue(),
    'Unsaved draft stays intact.',
  );
  pass('拒绝授权保留草稿及重试入口');

  const management = await context.newPage();
  await management.goto('chrome://extensions/');
  const grant = (host) =>
    management.evaluate(
      async ({ extensionId, host }) => {
        await chrome.developerPrivate.addHostPermission(extensionId, host);
      },
      { extensionId: id, host },
    );
  await grant('https://capture.example/*');
  await side.evaluate(() => {
    globalThis.denyPermission = false;
  });
  // Activate the fixture after focusing the extension's button. A DOM click here
  // would be untrusted, so use a real input click and restore the web tab in the
  // test's request wrapper before the capture retry starts.
  await side.exposeFunction('activateCaptureFixture', () => site.bringToFront());
  await side.evaluate(() => {
    const request = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request = async (permissions) => {
      const granted = await request(permissions);
      if (granted) await globalThis.activateCaptureFixture();
      return granted;
    };
  });
  await allowSite().click();
  await side.waitForFunction(() =>
    document.querySelector('#capture-form [name=content]').value.includes('Selected text survives'),
  );
  assert.equal(await side.locator('.capture-access').isVisible(), false);
  const requests = await side.evaluate(() => globalThis.permissionRequests);
  assert.deepEqual(
    requests.map((r) => r.permissions.origins),
    [['https://capture.example/*'], ['https://capture.example/*']],
  );
  assert.ok(requests.every((r) => r.trustedClick));
  assert.equal(
    await side.evaluate(() => chrome.permissions.contains({ origins: ['<all_urls>'] })),
    false,
  );
  pass('真实点击调用单站 request API，授权后自动重试且保留选中文字，不扩大到所有网站');

  const contentBeforeNavigation = await side.locator('#capture-form [name=content]').inputValue();
  await side.evaluate(() => chrome.permissions.remove({ origins: ['https://capture.example/*'] }));
  await site.bringToFront();
  await capture();
  await site.goto('https://capture.example/second');
  await grant('https://capture.example/*');
  await allowSite().click();
  await side.locator('.error-text').filter({ hasText: '网页已切换' }).waitFor();
  assert.equal(
    await side.locator('#capture-form [name=content]').inputValue(),
    contentBeforeNavigation,
  );
  pass('授权期间发生导航时停止重试，不把另一个网页当作原目标捕获');

  await site.bringToFront();
  await side.evaluate(() => document.querySelector('.type-tab[data-type=snapshot]').click());
  await side.locator('[data-pane=snapshot]:visible').waitFor();
  await side.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '捕获网页快照').click(),
  );
  await side.locator('.capture-access:visible').waitFor();
  assert.match(await side.locator('.capture-access').innerText(), /所有网站访问权限/);
  await grant('<all_urls>');
  await side.getByRole('button', { name: '允许所有网站访问并重试截图', exact: true }).click();
  await side.waitForFunction(
    () => document.querySelector('.snapshot-display img')?.naturalWidth > 0,
  );
  const allRequests = await side.evaluate(() => globalThis.permissionRequests);
  assert.deepEqual(allRequests.at(-1).permissions.origins, ['<all_urls>']);
  assert.equal(await side.locator('.capture-access').isVisible(), false);
  pass('仅有单站授权时截图给出范围说明，真实 all_urls 授权后重试并生成 PNG');

  await management.bringToFront();
  await side.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '捕获网页快照').click(),
  );
  await side.locator('.error-text').filter({ hasText: '这个页面不允许读取' }).waitFor();
  assert.equal(await side.locator('.capture-access').isVisible(), false);
  pass('Chrome 内部页面显示不支持捕获，不展示无效的网站授权入口');

  const settings = await context.newPage();
  settings.on('pageerror', (e) => errors.push(e.message));
  await settings.goto(`chrome-extension://${id}/dashboard.html#settings`);
  const websiteSettings = settings
    .locator('.settings-section')
    .filter({ has: settings.getByRole('heading', { name: '网页访问权限', exact: true }) });
  await websiteSettings.getByRole('button', { name: '撤销额外网站访问', exact: true }).click();
  await websiteSettings.getByText('已撤销额外网站访问。', { exact: true }).waitFor();
  assert.equal(
    await settings.evaluate(() =>
      chrome.permissions.contains({ origins: ['https://capture.example/*'] }),
    ),
    false,
  );
  await settings.evaluate(() => {
    const request = chrome.permissions.request.bind(chrome.permissions);
    globalThis.settingsRequests = [];
    document.addEventListener(
      'click',
      (event) => {
        globalThis.settingsClickTrusted = event.isTrusted;
      },
      true,
    );
    chrome.permissions.request = (permissions) => {
      globalThis.settingsRequests.push({
        permissions,
        trustedClick: globalThis.settingsClickTrusted,
      });
      return request(permissions);
    };
  });
  await grant('<all_urls>');
  await websiteSettings.getByRole('button', { name: '允许所有网站访问', exact: true }).click();
  await websiteSettings.getByText('已允许所有网站访问。', { exact: true }).waitFor();
  assert.deepEqual(await settings.evaluate(() => globalThis.settingsRequests), [
    { permissions: { origins: ['<all_urls>'] }, trustedClick: true },
  ]);
  pass('设置页可撤销可选权限，并从直接点击重新申请');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'permissions-browser-report.json'),
    JSON.stringify({ checks, nativeConfirmationAutomated: false }, null, 2),
  );
} finally {
  await context?.close();
  if (
    !profile.startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('permissions-profile-')
  )
    throw new Error('Unexpected test profile');
  await rm(profile, { recursive: true, force: true });
}

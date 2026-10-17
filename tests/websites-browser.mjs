import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'websites-profile-')),
  checks = [],
  errors = [],
  corsErrors = [],
  siteRequests = [],
  serverRequests = [];
const bili =
  'https://www.bilibili.com/video/BV1g7Me6MEmo/?spm_id_from=333.788.recommend_more_video.0&trackid=web_related_0.router-related-2589621-4d422.1792049476312.900';
let context,
  retryOK = false;
const server = createServer((request, response) => {
  serverRequests.push({ host: request.headers.host, path: request.url });
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/target` });
    return response.end();
  }
  response.writeHead(request.url === '/retry' && !retryOK ? 403 : 200, {
    'Content-Type': 'text/html; charset=utf-8',
    // Deliberately no Access-Control-Allow-Origin header.
  });
  response.end(
    '<html><head><meta property="og:title" content="已授权网页的真实标题"></head><body>Fixture</body></html>',
  );
});
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const local = `http://localhost:${server.address().port}`;
  const extension = path.resolve(process.argv.includes('--built') ? 'dist/pkm-nexus' : 'extension');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 360, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  context.on('request', (request) => {
    if (request.url().startsWith('https://www.bilibili.com/')) siteRequests.push(request.url());
  });
  // Any unexpected Bilibili request fails the assertions below; do not contact it.
  await context.route('https://www.bilibili.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<title>Must not request this</title>',
    }),
  );
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2],
    side = await context.newPage();
  side.on('pageerror', (error) => errors.push(error.message));
  side.on('console', (message) => {
    if (/CORS|Access to fetch/i.test(message.text())) corsErrors.push(message.text());
  });
  await side.goto(`chrome-extension://${id}/sidepanel.html`);
  await side.locator('#capture-form').waitFor();
  const title = (url, hint = '') =>
    side.evaluate(
      async ({ url, hint }) => {
        const { websiteTitle } = await import('./lib/websites.js');
        return websiteTitle(url, { hint });
      },
      { url, hint },
    );
  assert.equal(
    await side.evaluate(() =>
      chrome.permissions.contains({ origins: ['https://www.bilibili.com/*'] }),
    ),
    false,
  );
  assert.equal(await title(bili), 'bilibili.com');
  assert.equal(await title(bili, '拖拽时携带的视频标题'), '拖拽时携带的视频标题');
  assert.equal(await title(bili, '另一次拖拽的标题'), '另一次拖拽的标题');
  assert.deepEqual(siteRequests, []);
  assert.deepEqual(corsErrors, []);
  pass('正式 manifest 无 Bilibili 授权：使用域名或本次拖拽标题，零网页请求、零 CORS 错误');

  await side.locator('#capture-form .type-tab[data-type=website_group]').click();
  await side.locator('[data-pane=website_group]:visible').waitFor();
  await side.locator('#capture-form [name=title]').fill('Bilibili 链接权限回归');
  await side.locator('[name=website_url]').fill(bili);
  await side.getByRole('button', { name: '加入链接', exact: true }).click();
  await side.locator('.url-row').filter({ hasText: 'bilibili.com' }).waitFor();
  const dragged = 'https://www.bilibili.com/video/BV1g7Me6MEmo/?source=drag';
  await side.locator('.website-drop-zone').evaluate((node, url) => {
    const data = new DataTransfer();
    data.setData('text/uri-list', url);
    data.setData('text/html', `<a href="${url}">Bilibili 拖拽视频标题</a>`);
    node.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
  }, dragged);
  await side.getByRole('link', { name: 'Bilibili 拖拽视频标题', exact: true }).waitFor();
  await side.screenshot({ path: path.join(output, 'websites-without-permission.png') });
  await side.getByRole('button', { name: '保存到收件箱', exact: true }).click();
  await side.locator('#records article').filter({ hasText: 'Bilibili 链接权限回归' }).waitFor();
  const saved = await side.evaluate(async () => {
    const { Database } = await import('./lib/db.js'),
      db = new Database('pkm-nexus-v1', { broadcast: false });
    try {
      return (await db.allRows()).find((r) => r.record.title === 'Bilibili 链接权限回归')?.record;
    } finally {
      await db.close();
    }
  });
  assert.deepEqual(
    saved.url_list.map((item) => [item.url, item.title]),
    [
      [bili, 'bilibili.com'],
      [dragged, 'Bilibili 拖拽视频标题'],
    ],
  );
  assert.deepEqual(siteRequests, []);
  pass('侧栏手动加入和拖入 Bilibili 链接均可保存，原链接与拖拽标题保留，不要求额外权限');

  assert.equal(await title(`${local}/title`), 'localhost');
  assert.equal(serverRequests.length, 0);
  const management = await context.newPage();
  await management.goto('chrome://extensions/');
  const grantLocal = async () => {
    await management.evaluate(async (extensionId) => {
      await chrome.developerPrivate.addHostPermission(extensionId, 'http://localhost/*');
    }, id);
    // Chrome's native confirmation is not automated. Pre-approve this site in
    // the disposable profile, then exercise the actual request API on a click.
    await side.evaluate(() => {
      const control = document.createElement('button');
      control.id = 'test-grant-title';
      control.textContent = 'Grant test title origin';
      control.onclick = () => {
        globalThis.titlePermission = chrome.permissions.request({
          origins: ['http://localhost/*'],
        });
      };
      document.body.prepend(control);
    });
    await side.locator('#test-grant-title').click();
    assert.equal(await side.evaluate(() => globalThis.titlePermission), true);
    await side.locator('#test-grant-title').evaluate((node) => node.remove());
    assert.equal(
      await side.evaluate(() => chrome.permissions.contains({ origins: ['http://localhost/*'] })),
      true,
    );
  };
  await grantLocal();
  assert.equal(await title(`${local}/title`), '已授权网页的真实标题');
  assert.equal(serverRequests.length, 1);
  assert.equal(await title(`${local}/title`, '已有标签页标题'), '已有标签页标题');
  assert.equal(serverRequests.length, 1);
  pass('真实 HTTP 服务器不提供 CORS 响应头：无权限零请求，单站授权后读取真实标题，已有标题优先');

  assert.equal(await title(`${local}/retry`), 'localhost');
  retryOK = true;
  assert.equal(await title(`${local}/retry`), '已授权网页的真实标题');
  await side.evaluate(() => chrome.permissions.remove({ origins: ['http://localhost/*'] }));
  const requestCount = serverRequests.length;
  assert.equal(await title(`${local}/title`), 'localhost');
  assert.equal(serverRequests.length, requestCount);
  pass('读取失败不会永久缓存域名；撤销网站授权后不再读取，已有缓存也不会绕过权限检查');

  await grantLocal();
  assert.equal(await title(`${local}/redirect`), 'localhost');
  assert.equal(serverRequests.filter((request) => request.path === '/redirect').length, 1);
  assert.equal(serverRequests.filter((request) => request.path === '/target').length, 0);
  assert.deepEqual(corsErrors, []);
  assert.deepEqual(errors, []);
  pass('已授权站点跳转至未授权域名时不跟随跳转，保留可保存的链接');
  await writeFile(
    path.join(
      output,
      process.argv.includes('--built')
        ? 'websites-built-report.json'
        : 'websites-browser-report.json',
    ),
    JSON.stringify(
      {
        extensionVersion: await side.evaluate(() => chrome.runtime.getManifest().version),
        checks,
        siteRequests,
        corsErrors,
        errors,
        nativeConfirmationAutomated: false,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  if (
    !profile.startsWith(output + path.sep) ||
    !path.basename(profile).startsWith('websites-profile-')
  )
    throw new Error('Unexpected website test profile');
  await rm(profile, { recursive: true, force: true });
}

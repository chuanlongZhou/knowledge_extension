import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from './browser-options.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'editor-csp-'));
const extension = path.resolve(process.env.PKM_CSP_EXTENSION || 'dist/pkm-nexus');
const errors = [],
  consoleErrors = [],
  checks = [];
let context, page;
const pass = (message) => {
  checks.push(message);
  console.log('PASS ' + message);
};
try {
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    headless: true,
    viewport: { width: 1440, height: 1050 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', (target) => {
    target.on('pageerror', (error) => errors.push(error.message));
    target.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
  });
  await context.addInitScript(() => {
    globalThis.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.cspViolations.push({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
      });
    });
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${worker.url().split('/')[2]}/`;
  page = await context.newPage();
  await page.goto(base + 'dashboard.html');
  await page.locator('#new').click();
  const editor = page.locator('#editor-form');
  await editor.locator('[name=title]').fill('CSP Markdown 验证');
  await editor.locator('[name=content]').fill('# 原始 Markdown\n\n**粗体** 与源码。');
  await editor.getByRole('button', { name: '预览', exact: true }).click();
  const code = editor.locator('.cm-content');
  await code.waitFor({ state: 'visible' });
  assert.deepEqual(
    await page.evaluate(() => globalThis.cspViolations),
    [],
    'Opening CodeMirror must not violate the shipped extension CSP',
  );
  assert.equal(
    await editor.locator('.cm-scroller').evaluate((node) => getComputedStyle(node).display),
    'flex',
  );
  assert.ok(
    ['pre-wrap', 'break-spaces'].includes(
      await code.evaluate((node) => getComputedStyle(node).whiteSpace),
    ),
    'The editor must preserve spaces and wrap lines using its active theme',
  );
  await code.press('Control+a');
  await code.press('Backspace');
  await page.keyboard.insertText('# 更新后的 Markdown\n\n**编辑与预览** 正常同步。');
  await editor
    .locator('.markdown-live-preview h1')
    .filter({ hasText: '更新后的 Markdown' })
    .waitFor();
  await code.press('Control+f');
  await editor.locator('.cm-search').waitFor({ state: 'visible' });
  await code.press('Escape');
  await page.screenshot({ path: path.join(output, 'editor-csp-preview.png') });
  await editor.locator('button[type=submit]').click();
  await editor.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
  pass('发行包中新建记录、实时编辑、语法样式和搜索面板正常，未触发 CSP 违规');

  const id = await page.evaluate(async () => {
    const { Database } = await import('./lib/db.js');
    const db = new Database();
    const record = (await db.allCatalog()).find((row) => row.title === 'CSP Markdown 验证');
    await db.close();
    return record.id;
  });
  await page.locator(`#records [data-record-id="${id}"] .record-top h2`).click();
  await page.getByRole('button', { name: '简单修改 · Markdown', exact: true }).click();
  await editor.getByRole('button', { name: '预览', exact: true }).click();
  await editor.locator('.cm-content').press('Control+a');
  await editor.locator('.cm-content').press('Backspace');
  await page.keyboard.insertText('# 简单修改\n\n保留编辑能力。');
  await editor.locator('.markdown-live-preview h1').filter({ hasText: '简单修改' }).waitFor();
  await editor.locator('button[type=submit]').click();
  await editor.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
  pass('同一页面重复打开普通记录与简单 Markdown 编辑不产生样式违规');

  const side = await context.newPage();
  await side.goto(base + 'sidepanel.html');
  const panel = side.locator('#capture-form');
  await panel.locator('[name=content]').fill('# 侧栏编辑\n\nCSP 验证。');
  await panel.getByRole('button', { name: '预览', exact: true }).click();
  await panel.locator('.cm-content').waitFor({ state: 'visible' });
  assert.equal(
    await panel.locator('.cm-scroller').evaluate((node) => getComputedStyle(node).display),
    'flex',
  );
  assert.deepEqual(await side.evaluate(() => globalThis.cspViolations), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  const editorConsoleErrors = [...consoleErrors];
  pass('侧栏编辑器使用相同的发行版 CSP，动态样式生效');

  // Parsing intentionally hostile HTML can itself trigger browser CSP diagnostics,
  // even in DOMPurify's inert document. Keep these separate from editor errors.
  const sanitized = await page.evaluate(async () => {
    const { renderMarkdown } = await import('./lib/markdown-vendor.js');
    return renderMarkdown(
      '<style>body{display:none}</style><p style="color:red" onclick="alert(1)">测试</p><script>alert(1)</script><iframe src="https://example.com"></iframe>',
    );
  });
  assert.doesNotMatch(sanitized, /<style|\sstyle=|onclick|<script|<iframe/i);
  const policy = await worker.evaluate(
    () => chrome.runtime.getManifest().content_security_policy.extension_pages,
  );
  assert.match(policy, /(?:^|;\s*)script-src 'self';/);
  assert.match(policy, /(?:^|;\s*)style-src 'self';/);
  assert.deepEqual(errors, []);
  assert.ok(consoleErrors.every((message) => /Content Security Policy/i.test(message)));
  pass('用户 Markdown 的样式、脚本与事件仍被清理，脚本和样式属性策略保持限制');
  await writeFile(
    path.join(output, 'editor-csp-browser-report.json'),
    JSON.stringify(
      { checks, errors, editorConsoleErrors, sanitizerPolicyDiagnostics: consoleErrors },
      null,
      2,
    ),
  );
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'editor-csp-failure.png') }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  if (!profile.startsWith(output + path.sep) || !path.basename(profile).startsWith('editor-csp-'))
    throw new Error('Unexpected fixture path');
  await rm(profile, { recursive: true, force: true });
}

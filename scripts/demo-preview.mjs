import { chromium } from 'playwright';
import { readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { browserOptions } from '../tests/browser-options.mjs';
const latest = JSON.parse(await readFile('test-results/demo-latest.json', 'utf8'));
const allowed = path.resolve('test-results/demo-runs') + path.sep;
if (!path.resolve(latest.run).startsWith(allowed)) throw new Error('Unexpected demo profile path');
await cp('extension/guide', path.join(latest.extension, 'guide'), { recursive: true });
const context = await chromium.launchPersistentContext(path.join(latest.run, 'office-browser'), {
  ...browserOptions(),
  headless: false,
  viewport: { width: 1380, height: 900 },
  args: [
    `--disable-extensions-except=${latest.extension}`,
    `--load-extension=${latest.extension}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--window-size=1420,1000',
  ],
});
const page = await context.newPage();
await page.goto(`chrome-extension://${latest.id}/dashboard.html`);
await page.locator('#heading').waitFor();
await page.evaluate(() => {
  document.title = '[演示资料库] PKM Nexus';
});
console.log('演示资料库已打开；当前为独立测试配置，不是日常 Chrome 数据。');
let stop;
const stopped = new Promise((resolve) => (stop = resolve));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
context.on('close', stop);
await stopped;
await context.close();

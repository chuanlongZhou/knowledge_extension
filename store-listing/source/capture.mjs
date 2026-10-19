import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demo } from './demo-data.mjs';
import { browserOptions } from '../../tests/browser-options.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const listing = path.join(root, 'store-listing');
const profileRoot = await mkdtemp(path.join(root, 'test-results', 'store-listing-'));
const report = {
  version: JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8')).version,
  source:
    'Actual extension UI in isolated profiles; author-written localized demo records; no personal or Google data',
  screenshots: [],
  errors: [],
};
const esc = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function diagram(d) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="270"><rect width="1000" height="270" rx="26" fill="#f4f1e8"/><path d="M280 135H400M600 135H720" fill="none" stroke="#9daf9e" stroke-width="3"/><path d="M385 128l15 7-15 7M705 128l15 7-15 7" fill="none" stroke="#9daf9e" stroke-width="3"/>${d.diagram.map((label, i) => `<rect x="${50 + i * 320}" y="72" width="260" height="126" rx="20" fill="${['#285f49', '#e5ebe5', '#c1ab85'][i]}"/><text x="${180 + i * 320}" y="146" text-anchor="middle" font-family="Segoe UI,Microsoft YaHei,Yu Gothic,sans-serif" font-size="32" font-weight="600" fill="${i === 0 ? '#fffdf5' : '#25332f'}">${esc(label)}</text>`).join('')}</svg>`;
}
try {
  for (const [language, d] of Object.entries(demo)) {
    const dir = path.join(listing, 'assets/screenshots', language),
      raw = path.join(listing, 'source/raw', language);
    await mkdir(dir, { recursive: true });
    await mkdir(raw, { recursive: true });
    const extension = path.join(root, 'dist/pkm-nexus');
    const ctx = await chromium.launchPersistentContext(path.join(profileRoot, language), {
      ...browserOptions(),
      headless: true,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    ctx.on('page', (p) =>
      p.on('pageerror', (e) => report.errors.push(`${language}: ${e.message}`)),
    );
    try {
      let [worker] = ctx.serviceWorkers();
      worker ||= await ctx.waitForEvent('serviceworker');
      const base = `chrome-extension://${worker.url().split('/')[2]}/`;
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(base + 'start.html');
      await page.locator('#todo-items').waitFor();
      await worker.evaluate(async (language) => {
        await chrome.storage.local.set({
          uiLanguage: language,
          startPage: { enabled: false, decided: true, favoritesLimit: 5, shortcuts: [] },
        });
      }, language);
      const svg = diagram(d);
      await writeFile(path.join(raw, 'note-diagram.svg'), svg);
      const ids = await page.evaluate(
        async ({ d, svg }) => {
          const { Database } = await import('./lib/db.js'),
            { newRecord } = await import('./lib/model.js'),
            { listDocument } = await import('./lib/collections.js');
          const db = new Database();
          const img = new Image(),
            url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          img.src = url;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 1000;
          canvas.height = 270;
          canvas.getContext('2d').drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          const asset = await db.storeAsset(blob, 'knowledge-notes.png');
          const now = new Date().toISOString(),
            project = newRecord({
              schema_version: 5,
              type: 'project',
              title: d.project,
              summary: d.projectDescription,
              appearance: { icon: '📚', color: '#285f49' },
            }),
            child = newRecord({
              schema_version: 5,
              type: 'project',
              title: d.child,
              summary: d.childDescription,
              parent_project_id: project.id,
              appearance: { icon: '🌱', color: '#677d6a' },
            }),
            other = newRecord({
              schema_version: 5,
              type: 'project',
              title: d.other,
              summary: d.otherDescription,
              appearance: { icon: '✧', color: '#9a7920' },
            });
          const notes = d.titles.map((title, i) =>
            newRecord({
              schema_version: 5,
              title,
              summary: d.summaries[i],
              content:
                i === 0 ? `${d.noteText}\n![${d.detailHeading}](${asset.path})` : d.summaries[i],
              attachments: i === 0 ? [asset] : [],
              tags: [d.tags[i % 3]],
              favorite: true,
              project_ids: i < 3 ? [project.id] : [],
              organization_state: 'organized',
              created_at: new Date(Date.now() - (7 + i) * 86400000).toISOString(),
              updated_at: new Date(Date.now() - i * 3600000).toISOString(),
              sources: [
                {
                  url: `https://example.com/notes/${i + 1}`,
                  title,
                  captured_at: now,
                  kind: 'web_page',
                },
              ],
            }),
          );
          project.graph = {
            edges: [
              {
                id: crypto.randomUUID(),
                source: notes[0].id,
                target: notes[1].id,
                label: d.edgeLabels[0],
              },
              {
                id: crypto.randomUUID(),
                source: notes[1].id,
                target: notes[2].id,
                label: d.edgeLabels[1],
              },
              {
                id: crypto.randomUUID(),
                source: notes[0].id,
                target: child.id,
                label: d.edgeLabels[2],
              },
            ],
            positions: {
              [notes[0].id]: { x: 190, y: 145 },
              [notes[1].id]: { x: 600, y: 145 },
              [notes[2].id]: { x: 190, y: 405 },
              [child.id]: { x: 600, y: 405 },
            },
          };
          const group = newRecord({
            type: 'website_group',
            title: d.group,
            organization_state: 'organized',
            tags: [d.tags[0]],
            content: '',
            url_list: d.pages.map((title, i) => ({
              id: crypto.randomUUID(),
              url: `https://example.org/read/${i + 1}`,
              title,
              added_at: now,
              read_at: null,
            })),
          });
          const items = [
            ...d.todos.map((text) => ({
              id: crypto.randomUUID(),
              kind: 'item',
              text,
              is_checkbox: true,
              checked: false,
            })),
            ...d.ideas.map((text) => ({
              id: crypto.randomUUID(),
              kind: 'item',
              text,
              is_checkbox: false,
              checked: false,
            })),
          ];
          const list = newRecord({
            type: 'list',
            list: items,
            content: listDocument(items, '', []),
          });
          await db.saveMany(
            [project, child, other, group, list, ...notes].map((record) => ({ record })),
          );
          await db.setState('onboarding:examples-visible', false);
          await db.setState(
            'ui:tag-styles',
            Object.fromEntries(
              d.tags.map((name, i) => [name, { color: ['#285f49', '#9a7920', '#3e6868'][i] }]),
            ),
          );
          await chrome.storage.local.set({
            startPage: {
              enabled: false,
              decided: true,
              favoritesLimit: 5,
              shortcuts: d.dock.map((name, i) => ({
                id: `demo-${i}`,
                name,
                url: `https://example.com/${['workspace', 'docs', 'reading'][i]}`,
              })),
            },
          });
          await db.close();
          return { project: project.id, note: notes[0].id };
        },
        { d, svg },
      );
      const shot = async (name) => {
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: path.join(dir, name + '.png'),
          animations: 'disabled',
          caret: 'hide',
        });
        report.screenshots.push({
          language,
          file: `assets/screenshots/${language}/${name}.png`,
          width: 1280,
          height: 800,
        });
      };
      await page.reload();
      await page.locator('#favorite-cards .favorite-card').first().waitFor();
      await shot('01-start-page');
      await page.goto(base + 'dashboard.html?view=organized');
      await page.locator('#records > article').first().waitFor();
      // Hide only the built-in demo panel using its real preference; the listing has its own written demo records.
      await page.evaluate(async () => {
        const { Database } = await import('./lib/db.js');
        const db = new Database();
        await db.setState('onboarding:examples-visible', false);
        await db.close();
      });
      await page.waitForFunction(
        () =>
          document.querySelector('#records > article') &&
          document.querySelector('#result-count').textContent.includes('6'),
      );
      await shot('02-organize');
      await page.goto(base + `dashboard.html?project=${ids.project}`);
      await page.locator('#project-actions .button').first().waitFor();
      await page.locator('#project-actions .button').first().click();
      await page.locator('.graph-dialog .graph-node').first().waitFor();
      await page.locator(`.graph-dialog [data-node-id="${ids.note}"] > text`).click();
      await page.locator('.graph-dialog .graph-detail h2').waitFor();
      await shot('03-project-graph');
      await page.goto(base + `dashboard.html?record=${ids.note}`);
      await page.locator('dialog .asset-display img').waitFor();
      await page.waitForFunction(() =>
        [...document.querySelectorAll('dialog .asset-display img')].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      );
      await shot('04-record-preview');
      await page.goto(base + 'dashboard.html#settings');
      await page.locator('#interface-language').waitFor();
      const label = await page.evaluate(async () => {
        const { t } = await import('./lib/i18n.js');
        return t('导出备份（完整 ZIP）');
      });
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('dialog[open]').length > 0 &&
          [...document.querySelectorAll('dialog[open] option')].some(
            (option) => option.value === 'project',
          ),
      );
      await shot('05-export-backup');
      const side = await ctx.newPage();
      await side.setViewportSize({ width: 380, height: 900 });
      await side.goto(base + 'sidepanel.html');
      await side.locator('#capture-form [name=title]').fill(d.titles[0]);
      await side
        .locator('#capture-form [name=content]')
        .fill(d.noteText + '\n\n' + d.noteBullets.map((s) => '- ' + s).join('\n'));
      await side.screenshot({
        path: path.join(raw, 'sidebar-reference.png'),
        animations: 'disabled',
        caret: 'hide',
      });
      await side.close();
      console.log(`PASS ${language}: five actual 1280×800 screenshots + sidebar reference`);
    } catch (error) {
      for (const [i, p] of ctx.pages().entries())
        await p.screenshot({ path: path.join(raw, `capture-failure-${i}.png`) }).catch(() => {});
      throw error;
    } finally {
      await ctx.close();
    }
  }
  await writeFile(path.join(listing, 'capture-report.json'), JSON.stringify(report, null, 2));
  if (report.errors.length) throw new Error(report.errors.join('\n'));
} finally {
  if (
    profileRoot.startsWith(path.join(root, 'test-results') + path.sep) &&
    path.basename(profileRoot).startsWith('store-listing-')
  )
    await rm(profileRoot, { recursive: true, force: true });
}

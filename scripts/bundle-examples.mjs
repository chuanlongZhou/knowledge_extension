import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { browserOptions } from '../tests/browser-options.mjs';
import { normalizeRecord } from '../extension/lib/model.js';

const root = path.resolve('test-results/demo-runs');
const destination = path.resolve('extension/examples');
const definitions = [
  {
    id: 'web',
    mode: 'live',
    test: 'N01',
    title: '网页链接',
    recordTitle: '【示例】Wiki：个人知识管理',
    description: '捕获网页标题和来源链接。没有选择文字时，正文可以为空。',
  },
  {
    id: 'text',
    mode: 'offline',
    test: 'N02',
    title: '纯文字笔记',
    recordTitle: '【示例】本周学习计划',
    description: '直接写文字，保存后继续编辑；不需要打开网页。',
  },
  {
    id: 'audio',
    mode: 'live',
    test: 'N04',
    derive: 'audio-only',
    title: '文字 + 录音',
    recordTitle: '【示例】用录音补充灵感',
    description: '文字与可播放音频属于同一条记录。本段是测试用虚拟麦克风声音，不是真人语音。',
  },
  {
    id: 'mixed',
    mode: 'live',
    test: 'N04',
    title: '网页 + 文字 + 录音 + 图片',
    recordTitle: '【示例】CHETNA 城市排放页面阅读笔记',
    description:
      '已验证的 CHETNA 网页来源、文字、企鹅图片与测试录音放在同一条笔记里。录音来自虚拟麦克风。',
  },
  {
    id: 'wiki-snapshot',
    mode: 'live',
    test: 'P01',
    title: 'Wiki 页面快照',
    recordTitle: '【示例】Wiki 个人知识管理页面快照',
    description: '真实 Wiki 页面的可见区域 PNG；保留来源，离线可打开。',
  },
  {
    id: 'chetna-snapshot',
    mode: 'live',
    test: 'P03',
    title: 'CHETNA 页面快照',
    recordTitle: '【示例】CHETNA 首页快照',
    description: '真实 CHETNA 首页的可见区域 PNG；展示截图能力，不是交互地图归档。',
  },
];
await mkdir(path.join(destination, 'assets'), { recursive: true });
const examples = [],
  reports = {};
for (const mode of ['offline', 'live']) {
  const report = JSON.parse(await readFile(`docs/demo-results/${mode}.json`, 'utf8'));
  let run;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    let actual;
    try {
      actual = JSON.parse(await readFile(path.join(candidate, 'report.json'), 'utf8'));
    } catch {
      continue;
    }
    if (actual.mode === mode && actual.startedAt === report.startedAt) {
      run = candidate;
      break;
    }
  }
  if (!run) throw new Error(`找不到 ${mode} 报告对应的演示资料库，请先完成测试。`);
  reports[mode] = report;
  const extension = path.join(run, 'authorized-extension');
  // Only read the named workspace test profile, never the user's Chrome profile.
  const context = await chromium.launchPersistentContext(path.join(run, 'office-browser'), {
    ...browserOptions(),
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.route(/^https?:\/\//, (route) => route.abort());
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${worker.url().split('/')[2]}/manual.html`);
    for (const definition of definitions.filter((item) => item.mode === mode)) {
      assert.equal(report.cases.find((item) => item.id === definition.test)?.status, 'passed');
      const exported = await page.evaluate(async (test) => {
        const { Database } = await import('./lib/db.js'),
          db = new Database('pkm-nexus-v1', { broadcast: false });
        try {
          const row = (await db.allRows()).find((row) =>
            row.record.title.startsWith(`[演示${test}]`),
          );
          if (!row) throw new Error('Missing verified record ' + test);
          const assets = [];
          for (const descriptor of row.record.attachments) {
            const blob = (await db.getAsset(descriptor.id))?.blob;
            if (!blob) throw new Error('Missing recorded attachment');
            assets.push({ descriptor, bytes: [...new Uint8Array(await blob.arrayBuffer())] });
          }
          return { record: row.record, assets };
        } finally {
          await db.close();
        }
      }, definition.test);
      for (const asset of exported.assets) {
        const bytes = Buffer.from(asset.bytes);
        assert.equal(bytes.length, asset.descriptor.size_bytes);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.descriptor.id);
        await writeFile(path.join(destination, asset.descriptor.path), bytes);
      }
      let sourceRecord = exported.record;
      if (definition.derive === 'audio-only') {
        const audio = sourceRecord.attachments.find(
          (asset) => asset.kind === 'audio' && asset.duration_ms >= 2000,
        );
        assert.ok(audio, '示例必须使用至少两秒的已验证音频');
        sourceRecord = {
          ...sourceRecord,
          id: 'e8fa037e-c642-479a-9c42-357ceaf54264',
          sources: [],
          attachments: [audio],
          content: `用声音补充文字。\n\n[测试录音（虚拟麦克风）](${audio.path})`,
        };
      }
      const record = normalizeRecord({
        ...sourceRecord,
        title: definition.recordTitle,
        tags: ['内置示例'],
        project_ids: [],
        organization_state: 'inbox',
      });
      examples.push({
        ...definition,
        record,
        verification: {
          test: definition.test,
          mode,
          startedAt: report.startedAt,
          recordedVersion: report.extensionVersion,
        },
      });
    }
  } finally {
    await context.close();
  }
}
examples.sort(
  (a, b) =>
    definitions.findIndex((d) => d.id === a.id) - definitions.findIndex((d) => d.id === b.id),
);
await writeFile(
  path.join(destination, 'catalog.json'),
  JSON.stringify({ format: 'pkm-nexus-examples', version: 1, examples }, null, 2) + '\n',
);
console.log(
  `Bundled ${examples.length} verified examples and their original local media. No external website or Google request was made.`,
);

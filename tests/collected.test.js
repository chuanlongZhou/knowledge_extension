import test from 'node:test';
import assert from 'node:assert/strict';
import { newRecord } from '../extension/lib/model.js';
import { appendCollected } from '../extension/lib/collected.js';
const source = (url, kind = 'web_selection', title = '来源网页') => ({
  url,
  kind,
  title,
  captured_at: new Date().toISOString(),
});

test('consecutive collections keep existing prose and append one Markdown bullet with each source', () => {
  const base = newRecord({ title: '我的笔记', content: '保留原正文', tags: ['研究'] });
  const first = newRecord({
    title: '第一页',
    content: '第一段\n第二行',
    sources: [source('https://example.com/one')],
  });
  const second = newRecord({
    title: '第二页',
    content: '后续摘录',
    sources: [source('https://example.com/two')],
  });
  const record = appendCollected(appendCollected(base, first), second);
  assert.equal(record.id, base.id);
  assert.equal(record.title, base.title);
  assert.deepEqual(record.tags, base.tags);
  assert.match(record.content, /^保留原正文\n\n## collected:\n\n- 第一段\n {2}第二行/);
  assert.match(
    record.content,
    /\n- 后续摘录\n {2}来源：\[来源网页\]\(https:\/\/example.com\/two\)/,
  );
  assert.equal((record.content.match(/^## collected:/gm) || []).length, 1);
  assert.equal((record.content.match(/^- /gm) || []).length, 2);
  assert.equal(record.sources.length, 2);
  assert.equal(base.content, '保留原正文');
});

test('collected bullets are appended inside their section without moving a later section', () => {
  const base = newRecord({
    content: '前言\n\n## collected:\n\n- 原有条目\n\n## 我的结论\n\n保留结论',
  });
  const next = appendCollected(base, newRecord({ content: '新摘录' }));
  assert.match(next.content, /- 原有条目\n- 新摘录\n\n## 我的结论\n\n保留结论$/);
});

test('links and image fallbacks retain target addresses and page provenance', () => {
  const page = source('https://example.com/page', 'web_page');
  let record = appendCollected(
    newRecord(),
    newRecord({
      content: '链接文字',
      sources: [page, source('https://example.com/a(b)', 'web_link')],
    }),
  );
  assert.match(record.content, /- \[链接文字\]\(https:\/\/example.com\/a%28b%29\)/);
  record = appendCollected(
    record,
    newRecord({
      content: '图片说明',
      sources: [page, source('https://example.com/picture.png', 'web_image')],
    }),
  );
  assert.match(record.content, /!\[图片说明\]\(https:\/\/example.com\/picture.png\)/);
  assert.equal(record.sources.length, 3);
});

test('overlarge collections fail before modifying an existing record', () => {
  const base = newRecord({ content: 'x'.repeat(999980) });
  assert.throws(() => appendCollected(base, newRecord({ content: 'a'.repeat(100) })), /正文/);
  assert.equal(base.content.length, 999980);
});

test('a heading inside a fenced Markdown example is preserved, and the real section is separate', () => {
  const content = '```md\n## collected:\n- 示例\n```\n\n## 我的正文\n保留内容';
  const result = appendCollected(newRecord({ content }), newRecord({ content: '实际摘录' }));
  assert.ok(result.content.startsWith(content));
  assert.match(result.content, /保留内容\n\n## collected:\n\n- 实际摘录/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { textLinkParts } from '../extension/lib/text-links.js';
import {
  openWebsiteGroup,
  browserTabGroups,
  captureBrowserTabGroup,
} from '../extension/lib/tabs.js';

test('Todo links retain labels, Gmail fragments, queries and URL parentheses', () => {
  const gmail = 'https://mail.google.com/mail/u/0/#inbox/F123?x=1&y=2';
  const parts = textLinkParts(
    `邮件 ${gmail}\n[帮助](https://example.com/a_(b))，参考 https://example.org/docs。`,
  );
  assert.deepEqual(
    parts.filter((part) => part.href),
    [
      { text: gmail, href: gmail },
      { text: '帮助', href: 'https://example.com/a_(b)' },
      { text: 'https://example.org/docs', href: 'https://example.org/docs' },
    ],
  );
  assert.equal(
    textLinkParts('(https://example.com/a_(b)).').find((p) => p.href).href,
    'https://example.com/a_(b)',
  );
  assert.deepEqual(textLinkParts('普通文字'), [{ text: '普通文字' }]);
  assert.deepEqual(textLinkParts(''), []);
  assert.deepEqual(
    textLinkParts('[甲](https://example.com/a)[乙](https://example.org/b)')
      .filter((part) => part.href)
      .map((part) => part.text),
    ['甲', '乙'],
  );
});
test('link detection keeps HTML as text and rejects credentials and non-web protocols', () => {
  for (const text of [
    '[危险](javascript:alert(1))',
    'data:text/html,attack',
    'file:///C:/secret',
    'https://user:password@example.com/private',
    '<img src=x onerror=alert(1)>',
  ])
    assert.equal(
      textLinkParts(text).some((part) => part.href),
      false,
      text,
    );
  assert.equal(
    textLinkParts('参考 https://example.com/a?quote=%22#fragment').find((p) => p.href).href,
    'https://example.com/a?quote=%22#fragment',
  );
});
function browser() {
  const created = [],
    removed = [],
    grouped = [],
    named = [],
    activated = [];
  const tabs = {
    query: async () => [{ id: 1, windowId: 7, active: true }],
    create: async (options) => {
      const tab = { id: created.length + 20, ...options };
      created.push(tab);
      return tab;
    },
    group: async (options) => {
      grouped.push(options);
      return 99;
    },
    update: async (id, options) => {
      activated.push({ id, ...options });
    },
    remove: async (ids) => {
      removed.push(...ids);
    },
  };
  const groups = {
    update: async (id, options) => {
      named.push({ id, ...options });
    },
  };
  return { tabs, groups, created, removed, grouped, named, activated };
}
test('Open all creates a new named browser group with every active website in order', async () => {
  const api = browser();
  const record = {
    title: '研究资料',
    url_list: [
      { url: 'https://example.com/one', read_at: '2026-10-22T00:00:00Z' },
      { url: 'https://example.com/deleted', removed_at: '2026-10-22T00:00:00Z' },
      { url: 'javascript:alert(1)' },
      { url: 'https://example.com/two' },
    ],
  };
  const result = await openWebsiteGroup(record, api);
  assert.deepEqual(
    api.created.map((tab) => tab.url),
    ['https://example.com/one', 'https://example.com/two'],
  );
  assert.ok(api.created.every((tab) => tab.active === false && tab.windowId === 7));
  assert.deepEqual(api.grouped, [{ tabIds: [20, 21], createProperties: { windowId: 7 } }]);
  assert.deepEqual(api.named, [{ id: 99, title: '研究资料', collapsed: false }]);
  assert.deepEqual(api.activated, [{ id: 20, active: true }]);
  assert.deepEqual(result, { groupId: 99, tabIds: [20, 21] });
});
test('failed group creation removes only the tabs created by that Open all action', async () => {
  const api = browser();
  api.groups.update = async () => {
    throw new Error('Naming failed');
  };
  await assert.rejects(
    openWebsiteGroup({ title: 'Test', url_list: [{ url: 'https://example.com' }] }, api),
    /Naming failed/,
  );
  assert.deepEqual(api.removed, [20]);
  assert.deepEqual(api.activated, []);
  await assert.rejects(openWebsiteGroup({ url_list: [] }, api), /没有可打开/);
  await assert.rejects(
    openWebsiteGroup(
      { url_list: [{ url: 'https://example.com' }] },
      { tabs: api.tabs, groups: {} },
    ),
    /权限/,
  );
});
test('native browser groups expose only their own collectable webpages and active state', async () => {
  const all = [
    {
      id: 6,
      groupId: 8,
      windowId: 7,
      index: 2,
      url: '',
      pendingUrl: 'https://example.com/loading',
      title: 'Loading',
    },
    { id: 1, groupId: 8, windowId: 7, index: 4, url: 'https://example.com/two', title: 'Two' },
    {
      id: 2,
      groupId: 8,
      windowId: 7,
      index: 3,
      url: 'https://example.com/one',
      title: 'One',
      active: true,
    },
    { id: 3, groupId: 8, windowId: 7, index: 5, url: 'chrome://settings' },
    { id: 4, groupId: 9, windowId: 7, index: 6, url: 'https://example.org' },
    { id: 5, groupId: -1, windowId: 7, index: 0, url: 'https://unrelated.example' },
  ];
  const calls = [];
  const tabs = {
    query: async (query) => {
      calls.push(query);
      return query.groupId === undefined ? all : all.filter((tab) => tab.groupId === query.groupId);
    },
  };
  const groups = {
    query: async () => [
      { id: 8, windowId: 7, title: '工作' },
      { id: 9, windowId: 7, title: '其他' },
    ],
    get: async (id) => ({ id, windowId: 7, title: id === 8 ? '工作' : '其他' }),
  };
  const choices = await browserTabGroups({ tabs, groups });
  assert.equal(choices[0].active, true);
  assert.deepEqual(
    choices[0].tabs.map((tab) => tab.id),
    [6, 2, 1],
  );
  assert.equal(choices[1].active, false);
  const captured = await captureBrowserTabGroup(8, { tabs, groups });
  assert.equal(captured.title, '工作');
  assert.deepEqual(
    captured.items.map((item) => item.title),
    ['Loading', 'One', 'Two'],
  );
  assert.equal(new Set(captured.items.map((item) => item.id)).size, 3);
  assert.deepEqual(calls.at(-1), { groupId: 8, windowId: 7 });
  assert.ok(captured.items.every((item) => item.read_at === null));
});

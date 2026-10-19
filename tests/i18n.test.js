import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as espree from 'espree';
import { messages } from '../extension/lib/messages.js';
import { initI18n, t, msg, normalizeLanguage, saveLanguage } from '../extension/lib/i18n.js';
import { newRecord, canonical } from '../extension/lib/model.js';
import { createHash } from 'node:crypto';

test('all authored UI messages have complete English, French and Japanese placeholders', async () => {
  const slots = (text) => [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
  for (const [key, translations] of Object.entries(messages)) {
    assert.equal(translations.length, 3, key);
    for (const value of translations) {
      assert.ok(value.trim(), key);
      assert.deepEqual(slots(value), slots(key), key);
    }
  }
  let checked = 0;
  async function inspect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'guide') await inspect(name);
        continue;
      }
      if (!name.endsWith('.js') || /\/messages(?:-drive)?\.js$/.test(name)) continue;
      const ast = espree.parse(await readFile(name, 'utf8'), {
        ecmaVersion: 'latest',
        sourceType: 'module',
      });
      function walk(node) {
        if (!node || typeof node !== 'object') return;
        let key;
        if (
          node.type === 'CallExpression' &&
          node.callee.name === 't' &&
          node.arguments[0]?.type === 'Literal'
        )
          key = node.arguments[0].value;
        if (node.type === 'TaggedTemplateExpression' && node.tag.name === 'msg')
          key = node.quasi.quasis
            .map((q, i) => q.value.cooked + (i < node.quasi.expressions.length ? `{${i}}` : ''))
            .join('');
        if (typeof key === 'string' && /\p{Script=Han}/u.test(key)) {
          assert.ok(messages[key], `${name}: ${key}`);
          checked++;
        }
        for (const value of Object.values(node))
          if (Array.isArray(value)) value.forEach(walk);
          else if (value && typeof value === 'object') walk(value);
      }
      walk(ast);
    }
  }
  await inspect('extension');
  assert.ok(checked > 750);
  for (const file of [
    'app.js',
    'dashboard.html',
    'sidepanel.html',
    'start.html',
    'welcome.html',
    'manual.html',
    'microphone.html',
  ]) {
    const source = await readFile(`extension/${file}`, 'utf8');
    for (const match of source.matchAll(
      /data-i18n(?:-placeholder|-title|-aria-label|-alt)?="([^"]*)"/g,
    )) {
      const key = match[1]
        .replaceAll('&quot;', '"')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<');
      assert.ok(messages[key], `${file}: ${key}`);
    }
    assert.doesNotMatch(source, /<(?:option|title)[^>]*>\s*<span/);
  }
});

test('language aliases, fallback, formatting and literal user values preserve record hashes', async () => {
  assert.equal(normalizeLanguage('fr-CA'), 'fr');
  assert.equal(normalizeLanguage('ja_JP'), 'ja');
  assert.equal(normalizeLanguage('en-GB'), 'en');
  assert.equal(normalizeLanguage('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLanguage('invalid'), 'zh-CN');
  assert.equal(normalizeLanguage('constructor'), 'zh-CN');
  assert.equal(normalizeLanguage('__proto__'), 'zh-CN');
  let stored = {};
  const original = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: { get: async () => stored, set: async (value) => Object.assign(stored, value) },
    },
  };
  try {
    const record = newRecord({ title: '取消', content: '保存 {0} <b>本文</b>', tags: ['项目'] });
    const hash = () => createHash('sha256').update(canonical(record)).digest('hex');
    const before = hash();
    for (const [language, expected] of [
      ['en', 'Save'],
      ['fr', 'Enregistrer'],
      ['ja', '保存'],
      ['zh-CN', '保存'],
    ]) {
      await saveLanguage(language);
      await initI18n();
      assert.equal(t('保存'), expected);
      const user = '取消 {1} <img src=x onerror=alert(1)>';
      assert.ok(msg`查看 ${user}`.includes(user));
      assert.equal(t('Unmapped external error'), 'Unmapped external error');
      assert.equal(hash(), before);
    }
  } finally {
    globalThis.chrome = original;
  }
});

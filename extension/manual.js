import { t, msg, getLanguage } from './lib/i18n.js';
import { installTheme } from './lib/theme.js';
await installTheme();
import { el } from './lib/dom.js';
import { renderGuide } from './lib/guide.js';
const $ = (id) => document.getElementById(id);
let headings = [],
  generation = 0;
function toc() {
  const query = $('guide-search').value.trim().toLowerCase();
  $('guide-toc').replaceChildren(
    ...headings
      .filter((h) => h.level <= 2 && h.text.toLowerCase().includes(query))
      .map((h) => el('a', { href: `#${h.id}` }, h.text)),
  );
}
async function show(tests = false) {
  const current = ++generation,
    path = tests
      ? 'guide/测试流程.md'
      : getLanguage() === 'zh-CN'
        ? 'guide/使用说明书.md'
        : `guide/guide-${getLanguage()}.md`;
  $('read-manual').classList.toggle('active', !tests);
  $('read-tests').classList.toggle('active', tests);
  $('guide-source').href = path;
  try {
    const response = await fetch(path);
    if (!response.ok)
      throw new Error(t('文档尚未生成，请运行 npm run demo:manual 或重新构建扩展。'));
    const rendered = renderGuide(await response.text());
    if (current !== generation) return;
    headings = rendered.headings;
    $('guide-content').replaceChildren(rendered.root);
    toc();
  } catch (error) {
    $('guide-content').textContent = msg`无法打开说明书：${error.message}`;
  }
}
$('read-manual').addEventListener('click', () => show());
$('read-tests').addEventListener('click', () => show(true));
$('guide-search').addEventListener('input', toc);
$('print-guide').addEventListener('click', () => window.print());
show();

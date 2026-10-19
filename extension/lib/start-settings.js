import { t, msg } from './i18n.js';
import { el, button, field, option } from './dom.js';
import { readStartConfig, updateStartConfig } from './start-config.js';
export async function startSettings() {
  const config = await readStartConfig(),
    status = el('p', { class: 'description', role: 'status' });
  const count = el(
    'select',
    { 'aria-label': t('启动页喜爱网页数量') },
    ...[5, 8, 10].map((n) => option(String(n), msg`${n} 张卡片`, n === config.favoritesLimit)),
  );
  count.addEventListener('change', async () => {
    try {
      await updateStartConfig({ favoritesLimit: Number(count.value) });
    } catch (error) {
      status.textContent = error.message;
    }
  });
  return el(
    'section',
    { class: 'settings-section', 'aria-label': t('启动页') },
    el('h3', {}, t('启动页')),
    el(
      'p',
      { class: 'description', role: 'status' },
      t('GUGA 已设为浏览器的新标签页。点击“+”或按 Ctrl+T 即可打开。'),
    ),
    el(
      'p',
      { class: 'description' },
      t(
        '打开启动页查看 Todo、Idea、喜欢的网页、待浏览网页组与项目。Dock 常用网站保存在当前浏览器。',
      ),
    ),
    field(t('喜爱的网页'), count),
    button(t('打开新标签页'), () => chrome.tabs.create({})),
    status,
  );
}

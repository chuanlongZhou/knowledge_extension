import { el, button, field, option } from './dom.js';
import { LANGUAGES, getLanguage, saveLanguage, t } from './i18n.js';

export function languageSettings({ beforeApply = async () => {} } = {}) {
  const selected = el(
    'select',
    { id: 'interface-language', 'aria-label': t('界面语言') },
    ...Object.entries(LANGUAGES).map(([code, name]) => option(code, name, code === getLanguage())),
  );
  const status = el('p', { role: 'status', class: 'description' });
  const apply = button(
    t('应用语言'),
    async () => {
      apply.disabled = true;
      try {
        await beforeApply();
        await saveLanguage(selected.value);
        history.replaceState(null, '', location.pathname + location.search + '#settings');
        location.reload();
      } catch (error) {
        status.textContent = t(error.message);
        apply.disabled = false;
      }
    },
    'button primary',
  );
  apply.id = 'apply-language';
  return el(
    'section',
    { class: 'settings-section', 'aria-label': t('语言') },
    el('h3', {}, t('语言')),
    field(t('界面语言'), selected),
    el(
      'p',
      { class: 'description' },
      t(
        '应用后重新加载当前页面，草稿会保留。其他已打开页面刷新后生效。语言仅保存在当前浏览器，不修改记录内容。',
      ),
    ),
    apply,
    status,
  );
}

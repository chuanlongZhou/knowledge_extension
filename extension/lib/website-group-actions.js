import { t } from './i18n.js';
import { el, button } from './dom.js';
import { openWebsiteGroup } from './tabs.js';

export function websiteGroupOpener(getRecord) {
  const status = el('small', { class: 'muted', role: 'status' });
  const open = button(
    t('打开全部'),
    async (event) => {
      event.stopPropagation();
      open.disabled = true;
      status.textContent = '';
      try {
        const record = await getRecord();
        if (!record || record.deleted_at) throw new Error(t('网页组已不存在或已删除。'));
        await openWebsiteGroup(record);
      } catch (error) {
        status.className = 'error-text';
        status.textContent = error.message;
      } finally {
        open.disabled = false;
      }
    },
    'button small',
  );
  return el('div', { class: 'website-group-actions row' }, open, status);
}

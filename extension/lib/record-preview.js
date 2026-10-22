import { t, msg } from './i18n.js';
import { el, button, markdownPreview, assetView, linkedText } from './dom.js';
import { loadAsset } from './assets.js';
import { websiteLink } from './websites.js';
import { icon } from './icons.js';
import { tagBadge } from './appearance.js';
import { enableWebsiteDrag, websiteDragHandle } from './website-drag.js';
import { websiteGroupOpener } from './website-group-actions.js';

export async function recordPreview(db, record, { onChanged = () => {}, onMoveWebsite } = {}) {
  const root = el('article', { class: 'record-preview', 'data-preview-id': record.id });
  const assets = {
    attachments: record.attachments || [],
    local: async (d) => (await db.getAsset(d.id))?.blob,
    load: (d) => loadAsset(db, d),
  };
  root.append(
    el('h2', {}, record.type === 'list' ? 'Todo / Idea' : record.title || t('未命名记录')),
  );
  if (record.summary) root.append(el('p', { class: 'record-summary' }, record.summary));
  if (record.type === 'snapshot' && record.snapshot) {
    const descriptor = record.attachments.find((a) => a.id === record.snapshot.asset_id);
    if (descriptor) root.append(assetView(descriptor, assets));
  } else if (record.type === 'website_group') {
    if (!record.deleted_at)
      root.append(websiteGroupOpener(async () => (await db.get(record.id))?.record || record));
    const websites = el('div', {
      class: 'website-preview-list',
      tabindex: 0,
      role: 'region',
      'aria-label': t('网页列表'),
    });
    root.append(websites);
    for (const item of record.url_list) {
      const link = websiteLink(item);
      if (!record.deleted_at && !item.removed_at && onMoveWebsite)
        enableWebsiteDrag(link, record.id, item);
      const line = el(
        'div',
        { class: `website-preview-line${item.removed_at ? ' removed' : ''}` },
        !record.deleted_at && !item.removed_at && onMoveWebsite
          ? websiteDragHandle(record.id, item, onMoveWebsite)
          : null,
        link,
      );
      const remove = button(
        item.removed_at ? t('恢复网页') : icon('trash'),
        async () => {
          try {
            await db.mutate(record.id, (r) => ({
              ...r,
              schema_version: 5,
              url_list: r.url_list.map((u) =>
                u.id === item.id
                  ? { ...u, removed_at: item.removed_at ? null : new Date().toISOString() }
                  : u,
              ),
              updated_at: new Date().toISOString(),
            }));
            item.removed_at = item.removed_at ? null : new Date().toISOString();
            line.classList.toggle('removed', !!item.removed_at);
            remove.replaceChildren(
              item.removed_at ? document.createTextNode(t('恢复网页')) : icon('trash'),
            );
            remove.setAttribute(
              'aria-label',
              msg`${item.removed_at ? t('恢复') : t('删除')}网页 ${item.title || item.url}`,
            );
            onChanged();
          } catch (e) {
            error.textContent = e.message;
          }
        },
        'icon-button',
      );
      const error = el('span', { class: 'error-text' });
      remove.setAttribute(
        'aria-label',
        msg`${item.removed_at ? t('恢复') : t('删除')}网页 ${item.title || item.url}`,
      );
      line.append(remove, error);
      websites.append(line);
    }
  } else if (record.type === 'list') {
    for (const mode of [true, false])
      root.append(
        el('h3', {}, mode ? 'Todo' : 'Idea'),
        ...record.list
          .filter((i) => i.is_checkbox === mode)
          .map((i) =>
            i.kind === 'divider'
              ? el('hr')
              : el(
                  'div',
                  { class: 'list-item-preview', 'data-list-item-id': i.id },
                  el(
                    'p',
                    { class: i.checked ? 'completed' : '' },
                    `${mode ? (i.checked ? '☑' : '☐') : '•'} `,
                    linkedText(i.text),
                  ),
                  ...(record.attachments || [])
                    .filter((a) => a.storage === 'drive' && a.item_id === i.id)
                    .map((a) => assetView(a)),
                ),
          ),
      );
  } else root.append(markdownPreview(record.content, assets));
  const referenced = new Set(
    [...record.content.matchAll(/assets\/([a-f0-9]{64})\./g)].map((m) => m[1]),
  );
  for (const attachment of record.attachments || [])
    if (
      !(record.type === 'list' && attachment.storage === 'drive') &&
      !referenced.has(attachment.id) &&
      record.snapshot?.asset_id !== attachment.id
    )
      root.append(assetView(attachment, assets));
  const tagStyles = await db.getState('ui:tag-styles', {});
  root.append(
    el('div', { class: 'record-meta' }, ...record.tags.map((tag) => tagBadge(tag, tagStyles))),
  );
  for (const source of record.sources)
    root.append(
      el(
        'p',
        {},
        el(
          'a',
          { href: source.url, target: '_blank', rel: 'noopener noreferrer' },
          source.title || source.url,
        ),
      ),
    );
  root.dispose = () => {
    root.querySelectorAll('.markdown').forEach((n) => n.dispose?.());
    root.querySelectorAll('.asset-view').forEach((n) => n.dispose?.());
  };
  return root;
}

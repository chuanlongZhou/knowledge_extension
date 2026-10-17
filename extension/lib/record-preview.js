import { el, button, markdownPreview, assetView } from './dom.js';
import { loadAsset } from './assets.js';
import { websiteLink } from './websites.js';
import { icon } from './icons.js';
import { tagBadge } from './appearance.js';

export async function recordPreview(db, record, { onChanged = () => {} } = {}) {
  const root = el('article', { class: 'record-preview', 'data-preview-id': record.id });
  const assets = {
    attachments: record.attachments || [],
    local: async (d) => (await db.getAsset(d.id))?.blob,
    load: (d) => loadAsset(db, d),
  };
  root.append(el('h2', {}, record.type === 'list' ? 'Todo / Idea' : record.title || '未命名记录'));
  if (record.summary) root.append(el('p', { class: 'record-summary' }, record.summary));
  if (record.type === 'snapshot' && record.snapshot) {
    const descriptor = record.attachments.find((a) => a.id === record.snapshot.asset_id);
    if (descriptor) root.append(assetView(descriptor, assets));
  } else if (record.type === 'website_group') {
    for (const item of record.url_list) {
      const line = el(
        'div',
        { class: `website-preview-line${item.removed_at ? ' removed' : ''}` },
        websiteLink(item),
      );
      const remove = button(
        item.removed_at ? '恢复网页' : icon('trash'),
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
              item.removed_at ? document.createTextNode('恢复网页') : icon('trash'),
            );
            remove.setAttribute(
              'aria-label',
              `${item.removed_at ? '恢复' : '删除'}网页 ${item.title || item.url}`,
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
        `${item.removed_at ? '恢复' : '删除'}网页 ${item.title || item.url}`,
      );
      line.append(remove, error);
      root.append(line);
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
                  'p',
                  { class: i.checked ? 'completed' : '' },
                  `${mode ? (i.checked ? '☑' : '☐') : '•'} ${i.text}`,
                ),
          ),
      );
  } else root.append(markdownPreview(record.content, assets));
  const referenced = new Set(
    [...record.content.matchAll(/assets\/([a-f0-9]{64})\./g)].map((m) => m[1]),
  );
  for (const attachment of record.attachments || [])
    if (!referenced.has(attachment.id) && record.snapshot?.asset_id !== attachment.id)
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

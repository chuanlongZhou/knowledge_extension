import { t, msg } from './i18n.js';
import { el, button, dateLabel, assetView, linkedText } from './dom.js';
import { loadAsset } from './assets.js';
import { icon } from './icons.js';
import { websiteLink } from './websites.js';
import { enableWebsiteDrag, websiteDragHandle } from './website-drag.js';
import { websiteGroupOpener } from './website-group-actions.js';
export function typedCard(
  record,
  {
    db,
    toggleList,
    toggleRead,
    toggleRemoved,
    listMode = true,
    onListMode,
    moveWebsite,
    websiteScrollTop = 0,
  } = {},
) {
  const root = el('div', { class: 'typed-preview' });
  root.addEventListener('click', (event) => {
    if (event.target.closest('button, a, input, audio')) event.stopPropagation();
  });
  const stop = (action) => (event) => {
    event.stopPropagation();
    return action(event);
  };
  if (record.type === 'list') {
    let mode = listMode;
    const rows = el('div');
    const modes = el(
      'div',
      { class: 'list-modes row' },
      ...[
        [true, 'Todo'],
        [false, 'Idea'],
      ].map(([value, label]) => {
        const node = button(
          label,
          stop(() => {
            mode = value;
            onListMode?.(mode);
            render();
          }),
          'type-tab',
        );
        node.dataset.mode = String(value);
        return node;
      }),
    );
    function render() {
      for (const node of modes.children)
        node.classList.toggle('active', node.dataset.mode === String(mode));
      rows.replaceChildren(
        ...(record.list_preview || [])
          .filter((item) => item.is_checkbox === mode)
          .map((item) =>
            item.kind === 'divider'
              ? el('hr', { class: 'list-divider' })
              : el(
                  'label',
                  {
                    class: `list-preview-line${item.checked ? ' completed' : ''}`,
                    onclick: (event) => event.stopPropagation(),
                  },
                  mode
                    ? el('input', {
                        type: 'checkbox',
                        checked: item.checked,
                        'aria-label': msg`完成 ${item.text}`,
                        onchange: stop((event) => toggleList(item.id, event.target.checked)),
                      })
                    : el('span', {}, '•'),
                  linkedText(item.text || t('空项目')),
                  ...(record.attachments || [])
                    .filter((a) => a.storage === 'drive' && a.item_id === item.id)
                    .map((a) => assetView(a)),
                ),
          ),
      );
    }
    root.append(modes, rows);
    render();
  } else if (record.type === 'website_group') {
    root.append(
      el(
        'small',
        { class: 'muted' },
        msg`${record.url_count || 0} 个网页 · ${record.unread_count || 0} 个未读`,
      ),
    );
    const websiteRows = el('div', {
      class: 'website-card-list',
      tabindex: 0,
      role: 'region',
      'aria-label': t('网页列表'),
      onclick: (event) => event.stopPropagation(),
    });
    if (!record.deleted_at)
      root.append(
        websiteGroupOpener(async () => (db ? (await db.get(record.id))?.record : record)),
      );
    root.append(websiteRows);
    function renderWebsites(items) {
      websiteRows.replaceChildren();
      for (const item of items) {
        const link = websiteLink(item);
        if (!record.deleted_at && !item.removed_at && moveWebsite)
          enableWebsiteDrag(link, record.id, item);
        websiteRows.append(
          el(
            'div',
            {
              class: `website-preview-line${item.read_at ? ' completed' : ''}${item.removed_at ? ' removed' : ''}`,
              'data-website-id': item.id,
            },
            !record.deleted_at && !item.removed_at && moveWebsite
              ? websiteDragHandle(record.id, item, moveWebsite)
              : null,
            el('input', {
              type: 'checkbox',
              checked: !!item.read_at,
              'aria-label': msg`已读 ${item.title || item.url}`,
              onclick: (event) => event.stopPropagation(),
              onchange: stop((event) => toggleRead(item.id, event.target.checked)),
            }),
            link,
            el(
              'button',
              {
                type: 'button',
                class: 'icon-button',
                'aria-label': msg`${item.removed_at ? t('恢复') : t('删除')}网页 ${item.title || item.url}`,
                onclick: stop(() => toggleRemoved?.(item.id, !item.removed_at)),
              },
              item.removed_at ? t('恢复') : icon('trash'),
            ),
          ),
        );
      }
      websiteRows.scrollTop = websiteScrollTop;
    }
    renderWebsites(record.url_list || record.url_preview || []);
    // Catalog rows intentionally contain short previews. Fetch this record to make
    // every website available in the scroll area, including pre-existing catalogs.
    if (db)
      db.get(record.id)
        .then((row) => {
          if (row?.record.type === 'website_group') renderWebsites(row.record.url_list);
        })
        .catch(() => {
          websiteRows.append(
            el('small', { class: 'error-text' }, t('网页列表读取失败，请刷新重试。')),
          );
        });
    root.append(
      el(
        'small',
        { class: 'drop-hint' },
        t('拖动网页或 ⠿ 移动单项；拖动标题、空白处或“整组”移动整条记录。'),
      ),
    );
  } else if (record.type === 'snapshot') {
    const descriptor = record.attachments?.find((a) => a.id === record.snapshot?.asset_id);
    if (descriptor && db)
      root.append(
        assetView(descriptor, {
          local: async (d) => (await db.getAsset(d.id))?.blob,
          load: (d) => loadAsset(db, d),
          imageOnly: descriptor.kind === 'image',
        }),
      );
    else
      root.append(
        el(
          'div',
          { class: 'snapshot-card' },
          el('span', { class: 'snapshot-symbol' }, '▤'),
          el(
            'div',
            {},
            el('strong', {}, record.snapshot?.format === 'png' ? t('页面截图') : t('旧版网页文件')),
            el(
              'small',
              { class: 'muted' },
              record.snapshot ? dateLabel(record.snapshot.captured_at) : t('尚未捕获'),
            ),
          ),
        ),
      );
  } else if (record.attachments?.length)
    root.append(
      el(
        'small',
        { class: 'muted' },
        msg`${record.attachments.filter((a) => a.kind === 'image').length} 张图片 · ${record.attachments.filter((a) => a.kind === 'audio').length} 段录音`,
        record.attachments.some((a) => a.storage === 'drive')
          ? msg` · ${record.attachments.filter((a) => a.storage === 'drive').length} 个文件`
          : '',
      ),
    );
  return root;
}

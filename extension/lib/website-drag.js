import { t, msg } from './i18n.js';
import { el } from './dom.js';
export const WEBSITE_DRAG_TYPE = 'application/x-pkm-website-item';
export function enableWebsiteDrag(node, groupId, item) {
  node.draggable = true;
  node.addEventListener('dragstart', (event) => {
    event.stopPropagation();
    event.dataTransfer.setData(WEBSITE_DRAG_TYPE, JSON.stringify({ groupId, itemId: item.id }));
    event.dataTransfer.effectAllowed = 'move';
    node.closest('.website-preview-line')?.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    document
      .querySelectorAll('.dragging, .drag-over')
      .forEach((node) => node.classList.remove('dragging', 'drag-over'));
  });
}
export function websiteDragHandle(groupId, item, onMove) {
  const handle = el(
    'button',
    {
      type: 'button',
      class: 'website-drag-handle',
      draggable: true,
      'aria-label': msg`移动单个网页 ${item.title || item.url}`,
      title: t('拖到另一个网页组；点击可选择目标组'),
      onclick: (event) => {
        event.stopPropagation();
        onMove?.(item.id);
      },
    },
    '⠿',
  );
  enableWebsiteDrag(handle, groupId, item);
  return handle;
}
export function readWebsiteDrag(data) {
  try {
    const value = JSON.parse(data.getData(WEBSITE_DRAG_TYPE));
    if (
      typeof value.groupId === 'string' &&
      value.groupId.length < 200 &&
      typeof value.itemId === 'string' &&
      value.itemId.length < 200
    )
      return value;
  } catch {
    /* Ignore invalid or unrelated drag data. */
  }
  throw new Error(t('无法识别拖入的网页，请从网页旁边的拖动柄重新拖动。'));
}

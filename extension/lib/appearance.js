import { t, msg } from './i18n.js';
import { el, button } from './dom.js';

export function colorControl(value, label) {
  const picker = el('input', { type: 'color', value, 'aria-label': label });
  const hex = el('input', {
    type: 'text',
    value,
    maxlength: 7,
    pattern: '#[0-9a-fA-F]{6}',
    'aria-label': msg`${label}十六进制`,
  });
  const palette = el('div', { class: 'color-palette', 'aria-label': msg`${label}预设` });
  const set = (next) => {
    picker.value = next;
    hex.value = next;
  };
  picker.addEventListener('input', () => {
    hex.value = picker.value;
  });
  hex.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(hex.value)) picker.value = hex.value;
  });
  for (const color of [
    '#285f49',
    '#2764b7',
    '#7c4db0',
    '#a3466b',
    '#bf6336',
    '#9a7920',
    '#64748b',
  ]) {
    const swatch = button(
      '',
      () => {
        set(color);
        picker.dispatchEvent(new Event('input', { bubbles: true }));
      },
      'color-swatch',
    );
    swatch.style.backgroundColor = color;
    swatch.setAttribute('aria-label', `${label} ${color}`);
    palette.append(swatch);
  }
  return {
    root: el('div', { class: 'color-control' }, picker, hex, palette),
    picker,
    get value() {
      return picker.value;
    },
    set value(next) {
      set(next);
    },
  };
}

export function tagBadge(tag, styles = {}) {
  const node = el('span', { class: 'tag' }, tag);
  if (/^#[0-9a-f]{6}$/i.test(styles[tag]?.color))
    node.style.setProperty('--tag-color', styles[tag].color);
  return node;
}

export function iconChoices(value = '📁') {
  const root = el('div', { class: 'icon-choices', role: 'group', 'aria-label': t('项目图标') });
  const icons = [
    ...new Set(['📁', '📚', '📝', '🔬', '💡', '🎯', '💼', '🏠', '🌱', '⭐', '🎨', '💻', value]),
  ];
  const select = (next) => {
    value = next;
    for (const item of root.children)
      item.setAttribute('aria-pressed', String(item.dataset.icon === value));
  };
  for (const symbol of icons) {
    const item = button(symbol, () => select(symbol), 'button icon-choice');
    item.dataset.icon = symbol;
    item.setAttribute('aria-label', msg`图标 ${symbol}`);
    root.append(item);
  }
  select(value);
  return {
    root,
    get value() {
      return value;
    },
  };
}

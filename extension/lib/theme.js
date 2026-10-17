import { el, button, field, option } from './dom.js';
import { colorControl } from './appearance.js';

const KEY = 'uiTheme';
const palettes = {
  paper: ['#f5f4f0', '#ffffff', '#25332f', '#6b756f', '#dce1d8', '#285f49'],
  light: ['#f4f6fa', '#ffffff', '#243047', '#657188', '#dbe1eb', '#2764b7'],
  dark: ['#181d23', '#232b34', '#e5eaf0', '#a7b3c1', '#43505f', '#83c5a7'],
};
const colors = ['background', 'surface', 'text', 'muted', 'border', 'accent'];
const colorLabels = ['页面背景', '卡片背景', '正文颜色', '辅助文字', '边框颜色', '主题色'];
const zones = {
  general: ['基础界面', 14],
  sidebar: ['导航与侧栏', 13],
  records: ['记录卡片', 14],
  editor: ['编辑器', 14],
  preview: ['记录预览', 15],
  graph: ['关系图', 13],
  headings: ['页面标题', 24],
};
const systemFont = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif";
let current = {},
  ready;
const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
export function normalizeTheme(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  const mode = ['paper', 'light', 'dark', 'system'].includes(raw.mode) ? raw.mode : 'paper';
  const theme = {
    mode,
    colors: {},
    fonts: {},
    spacing: Math.max(2, Math.min(12, Number(raw.spacing) || 5)),
  };
  for (const key of colors)
    if (/^#[0-9a-f]{6}$/i.test(raw.colors?.[key])) theme.colors[key] = raw.colors[key];
  for (const [key, [, size]] of Object.entries(zones)) {
    const font = raw.fonts?.[key];
    theme.fonts[key] = {
      size: Math.max(11, Math.min(36, Number(font?.size) || size)),
      family:
        typeof font?.family === 'string' &&
        font.family.length < 200 &&
        !/[;{}<>\\]/.test(font.family)
          ? font.family
          : systemFont,
    };
  }
  return theme;
}
export function applyTheme(raw) {
  const theme = normalizeTheme(raw),
    mode = theme.mode === 'system' ? (media?.matches ? 'dark' : 'light') : theme.mode;
  const style = document.documentElement.style;
  const vars = ['paper', 'white', 'ink', 'muted', 'line', 'green'];
  colors.forEach((key, i) =>
    style.setProperty(`--${vars[i]}`, theme.colors[key] || palettes[mode][i]),
  );
  const accent = theme.colors.accent || palettes[mode][5];
  const rgb = [1, 3, 5]
    .map((index) => parseInt(accent.slice(index, index + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  style.setProperty(
    '--accent-ink',
    rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#17212b' : '#ffffff',
  );
  style.setProperty('--green-light', 'color-mix(in srgb, var(--green) 12%, var(--white))');
  for (const [key, font] of Object.entries(theme.fonts)) {
    style.setProperty(`--font-${key}`, `${font.size}px`);
    style.setProperty(`--family-${key}`, font.family);
  }
  style.setProperty('--nav-space', `${theme.spacing}px`);
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode === 'dark' ? 'dark' : 'light';
}
export function installTheme() {
  if (ready) return ready;
  ready = chrome.storage.local.get(KEY).then((data) => {
    current = normalizeTheme(data[KEY]);
    applyTheme(current);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) {
      current = normalizeTheme(changes[KEY].newValue);
      applyTheme(current);
    }
  });
  media?.addEventListener('change', () => applyTheme(current));
  return ready;
}
export async function themeEditor() {
  await installTheme();
  let draft = structuredClone(current),
    saved = false;
  const root = el('div', { class: 'theme-editor' });
  function render() {
    const mode = el(
      'select',
      { 'aria-label': '主题' },
      ...[
        ['paper', '纸张'],
        ['light', '明亮'],
        ['dark', '深色'],
        ['system', '跟随系统'],
      ].map(([key, label]) => option(key, label, key === draft.mode)),
    );
    mode.addEventListener('change', () => {
      draft.mode = mode.value;
      draft.colors = {};
      applyTheme(draft);
      render();
    });
    const colorGrid = el('div', { class: 'theme-colors' });
    const resolved = draft.mode === 'system' ? (media?.matches ? 'dark' : 'light') : draft.mode;
    colors.forEach((key, i) => {
      const control = colorControl(draft.colors[key] || palettes[resolved][i], colorLabels[i]);
      control.root.addEventListener('input', () => {
        draft.colors[key] = control.value;
        applyTheme(draft);
      });
      colorGrid.append(field(colorLabels[i], control.root));
    });
    const fonts = el('div', { class: 'theme-fonts' });
    for (const [key, [label]] of Object.entries(zones)) {
      const size = el('input', {
        type: 'number',
        min: 11,
        max: 36,
        value: draft.fonts[key].size,
        'aria-label': `${label}字号`,
      });
      const family = el('input', {
        type: 'text',
        value: draft.fonts[key].family,
        list: 'font-families',
        'aria-label': `${label}字体`,
      });
      const update = () => {
        draft.fonts[key] = normalizeTheme({
          fonts: { [key]: { size: size.value, family: family.value } },
        }).fonts[key];
        applyTheme(draft);
      };
      size.addEventListener('input', update);
      family.addEventListener('input', update);
      fonts.append(
        el(
          'div',
          { class: 'theme-font-row' },
          el('strong', {}, label),
          field('字号', size),
          field('字体', family),
        ),
      );
    }
    const spacing = el('input', {
      type: 'range',
      min: 2,
      max: 12,
      value: draft.spacing,
      'aria-label': '导航行距',
    });
    spacing.addEventListener('input', () => {
      draft.spacing = Number(spacing.value);
      applyTheme(draft);
    });
    root.replaceChildren(
      el(
        'p',
        { class: 'description' },
        '即时预览；保存后应用到插件各页面。字体可填本机字体名，如 Microsoft YaHei、Georgia。',
      ),
      field('主题', mode),
      colorGrid,
      fonts,
      el(
        'datalist',
        { id: 'font-families' },
        ...[systemFont, 'Microsoft YaHei, sans-serif', 'Georgia, serif', 'Consolas, monospace'].map(
          (name) => option(name, name),
        ),
      ),
      field('导航行距', spacing),
      button('恢复默认', () => {
        draft = normalizeTheme();
        applyTheme(draft);
        render();
      }),
    );
  }
  render();
  return {
    root,
    async save() {
      current = normalizeTheme(draft);
      await chrome.storage.local.set({ [KEY]: current });
      saved = true;
      applyTheme(current);
    },
    dispose() {
      if (!saved) applyTheme(current);
    },
  };
}

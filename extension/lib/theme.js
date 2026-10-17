import { el, button, field, option } from './dom.js';
import { colorControl } from './appearance.js';

const KEY = 'uiTheme';
export const THEME_PRESETS = [
  {
    id: 'vintage-vinyl',
    label: '美式复古',
    name: 'Vintage Vinyl',
    swatches: [
      ['复古青绿 · Vintage Teal', '#3E6868'],
      ['陶土红 · Retro Coral', '#C94E44'],
      ['亚麻卡其 · Linen Beige', '#C1AB85'],
    ],
    palette: ['#f5f0e8', '#fffdf9', '#263d3d', '#536563', '#C1AB85', '#3E6868'],
  },
  {
    id: 'hawaiian-surf',
    label: '美式复古',
    name: 'Hawaiian Surf',
    swatches: [
      ['阳光黄 · Sunshine Yellow', '#FBC359'],
      ['冲浪绿 · Surf Green', '#73A642'],
      ['湖水蓝 · Lagoon Blue', '#4B848A'],
    ],
    palette: ['#fff7e8', '#fffef9', '#263e40', '#526352', '#e4d3ac', '#4B848A'],
  },
  {
    id: 'french-vintage',
    label: '法式复古',
    name: 'French Vintage',
    swatches: [
      ['深鼠尾草绿 · Deep Sage', '#3D5D52'],
      ['深咖啡棕 · Espresso Brown', '#352D27'],
      ['柔沙米色 · Soft Sand', '#D3B8A6'],
    ],
    palette: ['#f5eee9', '#fffdfa', '#352D27', '#686056', '#D3B8A6', '#3D5D52'],
  },
  {
    id: 'spiced-chai',
    label: '暖调香料',
    name: 'Spiced Chai',
    swatches: [
      ['Red Chai · 红茶棕', '#632626'],
      ['Masala · 玛萨拉红', '#9D5353'],
      ['Cinnamon Toast · 肉桂吐司', '#BF8567'],
      ['Cardamom · 小豆蔻米黄', '#DBC896'],
    ],
    palette: ['#f9f3e7', '#fffdf8', '#392626', '#9D5353', '#DBC896', '#632626'],
  },
  {
    id: 'ocean-mist',
    label: '海洋自然',
    name: 'Ocean Mist',
    swatches: [
      ['Ocean Deep · 深海绿', '#4E635E'],
      ['Villa Nova · 象牙米白', '#E2E0C8'],
      ['Siren Song · 浅灰鼠尾草绿', '#A6B49E'],
      ['Big River · 河岸灰绿', '#818C78'],
    ],
    palette: ['#E2E0C8', '#fafbf5', '#263630', '#54634f', '#A6B49E', '#4E635E'],
  },
  {
    id: 'matcha-forest',
    label: '抹茶森林',
    name: 'Matcha Forest',
    swatches: [
      ['Almond · 杏仁米色', '#D6BD98'],
      ['Matcha Brew · 抹茶绿', '#677D6A'],
      ['Forest Roast · 森林深绿', '#40534C'],
      ['Eclipse · 暗夜墨绿', '#1A3636'],
    ],
    palette: ['#f5f0e8', '#fdfcf8', '#1A3636', '#677D6A', '#D6BD98', '#40534C'],
  },
];
const palettes = {
  paper: ['#f5f4f0', '#ffffff', '#25332f', '#6b756f', '#dce1d8', '#285f49'],
  light: ['#f4f6fa', '#ffffff', '#243047', '#657188', '#dbe1eb', '#2764b7'],
  dark: ['#181d23', '#232b34', '#e5eaf0', '#a7b3c1', '#43505f', '#83c5a7'],
  ...Object.fromEntries(THEME_PRESETS.map((preset) => [preset.id, preset.palette])),
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
  const mode = raw.mode === 'system' || Object.hasOwn(palettes, raw.mode) ? raw.mode : 'paper';
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
  const preset = THEME_PRESETS.find((preset) => preset.id === mode);
  style.setProperty('--theme-secondary', preset?.swatches[1][1] || accent);
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
        ...THEME_PRESETS.map((preset) => [preset.id, `${preset.label} · ${preset.name}`]),
      ].map(([key, label]) => option(key, label, key === draft.mode)),
    );
    mode.addEventListener('change', () => {
      draft.mode = mode.value;
      draft.colors = {};
      applyTheme(draft);
      render();
    });
    const presets = el('div', { class: 'theme-presets', role: 'group', 'aria-label': '配色主题' });
    for (const preset of THEME_PRESETS) {
      const selected = draft.mode === preset.id && !Object.keys(draft.colors).length;
      const card = button(
        '',
        () => {
          draft.mode = preset.id;
          draft.colors = {};
          applyTheme(draft);
          render();
        },
        'theme-preset',
      );
      card.dataset.preset = preset.id;
      card.setAttribute('aria-label', `预览 ${preset.name}`);
      card.setAttribute('aria-pressed', String(selected));
      card.style.setProperty('--preset-paper', preset.palette[0]);
      card.style.setProperty('--preset-ink', preset.palette[2]);
      card.style.setProperty('--preset-accent', preset.palette[5]);
      card.append(
        el(
          'span',
          { class: 'theme-preset-heading' },
          el('span', {}, preset.label),
          el(
            'span',
            { class: 'theme-preset-selected', 'aria-hidden': 'true' },
            selected ? '✓' : '',
          ),
        ),
        el('strong', { class: 'theme-preset-name' }, preset.name),
        el(
          'span',
          { class: 'theme-preset-swatches' },
          ...preset.swatches.map(([name, hex]) => {
            const swatch = el('span', { class: 'theme-preset-swatch', title: `${name} ${hex}` });
            swatch.style.backgroundColor = hex;
            return swatch;
          }),
        ),
      );
      presets.append(card);
    }
    const colorGrid = el('div', { class: 'theme-colors' });
    const resolved = draft.mode === 'system' ? (media?.matches ? 'dark' : 'light') : draft.mode;
    colors.forEach((key, i) => {
      const control = colorControl(draft.colors[key] || palettes[resolved][i], colorLabels[i]);
      control.root.addEventListener('input', () => {
        draft.colors[key] = control.value;
        applyTheme(draft);
        for (const card of presets.children) {
          card.setAttribute('aria-pressed', 'false');
          card.querySelector('.theme-preset-selected').textContent = '';
        }
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
        '点击色卡即时预览，保存主题后应用到插件各页面。也可单独调整颜色与字体。',
      ),
      presets,
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

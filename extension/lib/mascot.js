import { t, msg } from './i18n.js';
import { el, button, field, option } from './dom.js';

const KEY = 'uiMascot';
export const MASCOTS = [
  { id: 'original', name: t('原版企鹅'), src: 'icons/penguin.png' },
  { id: 'sleeping-penguin', name: t('睡觉企鹅'), src: 'icons/mascots/sleeping-penguin.png' },
  { id: 'round-penguin', name: t('团子企鹅'), src: 'icons/mascots/round-penguin.png' },
  { id: 'sketched-penguin', name: t('手绘企鹅'), src: 'icons/mascots/sketched-penguin.png' },
  { id: 'penguin-pair', name: t('双人企鹅'), src: 'icons/mascots/penguin-pair.png' },
  { id: 'black-cat', name: t('发呆黑猫'), src: 'icons/mascots/black-cat.png' },
];
export function normalizeMascot(raw = {}) {
  return {
    mode: ['fixed', 'random', 'cycle'].includes(raw?.mode) ? raw.mode : 'fixed',
    selected: MASCOTS.some((item) => item.id === raw?.selected) ? raw.selected : 'original',
    interval: [10, 30, 60, 300].includes(raw?.interval) ? raw.interval : 30,
  };
}
export function nextMascot(settings, previous, random = Math.random) {
  if (settings.mode === 'fixed') return settings.selected;
  if (settings.mode === 'cycle')
    return MASCOTS[(MASCOTS.findIndex((item) => item.id === previous) + 1) % MASCOTS.length].id;
  const candidates = MASCOTS.filter((item) => item.id !== previous);
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))].id;
}
let current = normalizeMascot(),
  shown = current.selected,
  timer,
  ready;
function display(id) {
  const item = MASCOTS.find((item) => item.id === id) || MASCOTS[0];
  shown = item.id;
  for (const image of document.querySelectorAll('.brand-penguin')) {
    image.src = item.src;
    image.alt = item.name;
    image.dataset.mascot = item.id;
    image.draggable = false;
  }
}
function schedule() {
  clearInterval(timer);
  if (current.mode !== 'fixed' && !document.hidden)
    timer = setInterval(() => display(nextMascot(current, shown)), current.interval * 1000);
}
function apply(raw) {
  current = normalizeMascot(raw);
  display(current.mode === 'random' ? nextMascot(current, shown) : current.selected);
  schedule();
}
export function installMascot() {
  if (ready) return ready;
  ready = chrome.storage.local.get(KEY).then((data) => apply(data[KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) apply(changes[KEY].newValue);
  });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', () => clearInterval(timer));
  return ready;
}
export async function mascotSettings() {
  await installMascot();
  const root = el('section', {
    class: 'settings-section mascot-settings',
    'aria-label': t('页面企鹅与伙伴'),
  });
  let draft = structuredClone(current);
  const status = el('small', { class: 'muted', role: 'status' });
  const mode = el(
    'select',
    { 'aria-label': t('伙伴显示方式') },
    option('fixed', t('固定'), draft.mode === 'fixed'),
    option('random', t('随机'), draft.mode === 'random'),
    option('cycle', t('循环'), draft.mode === 'cycle'),
  );
  const interval = el(
    'select',
    { 'aria-label': t('伙伴更换间隔') },
    ...[10, 30, 60, 300].map((seconds) =>
      option(
        seconds,
        seconds === 300 ? t('5 分钟') : msg`${seconds} 秒`,
        seconds === draft.interval,
      ),
    ),
  );
  const choices = el('div', {
    class: 'mascot-choices',
    role: 'group',
    'aria-label': t('选择页面伙伴'),
  });
  const next = button(
    t('立即换一张'),
    () => {
      display(nextMascot(current, shown));
      schedule();
    },
    'button small',
  );
  const render = () => {
    mode.value = draft.mode;
    interval.disabled = draft.mode === 'fixed';
    next.hidden = draft.mode === 'fixed';
    for (const choice of choices.children)
      choice.setAttribute(
        'aria-pressed',
        String(draft.mode === 'fixed' && choice.dataset.mascot === draft.selected),
      );
  };
  async function save() {
    try {
      await chrome.storage.local.set({ [KEY]: normalizeMascot(draft) });
      status.textContent = t('已保存，整理页与侧栏同时生效。');
    } catch (error) {
      status.textContent = error.message;
    }
    render();
  }
  for (const item of MASCOTS) {
    const choice = button(
      '',
      async () => {
        draft.selected = item.id;
        draft.mode = 'fixed';
        await save();
      },
      'mascot-choice',
    );
    choice.dataset.mascot = item.id;
    choice.setAttribute('aria-label', msg`固定显示${item.name}`);
    choice.append(
      el('img', { src: item.src, alt: '', draggable: false }),
      el('span', {}, item.name),
    );
    choices.append(choice);
  }
  mode.addEventListener('change', async () => {
    draft.mode = mode.value;
    await save();
  });
  interval.addEventListener('change', async () => {
    draft.interval = Number(interval.value);
    await save();
  });
  root.append(
    el('h3', {}, t('页面企鹅与伙伴')),
    el(
      'p',
      { class: 'description' },
      t('固定显示喜欢的伙伴，或按间隔随机更换、依次循环。点击图片固定显示；设置立即保存。'),
    ),
    el(
      'div',
      { class: 'mascot-controls' },
      field(t('显示方式'), mode),
      field(t('更换间隔'), interval),
      next,
    ),
    choices,
    status,
  );
  render();
  return root;
}

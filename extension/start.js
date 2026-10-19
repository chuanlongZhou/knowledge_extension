import { t, msg, getLanguage } from './lib/i18n.js';
import { Database } from './lib/db.js';
import { LIST_ID, upgradeRecord, newRecord, displayType } from './lib/model.js';
import { singletonList, migrateTodos } from './lib/collections.js';
import { editStartList } from './lib/start-list.js';
import {
  START_KEY,
  readStartConfig,
  updateStartConfig,
  normalizeShortcutUrl,
} from './lib/start-config.js';
import { installTheme } from './lib/theme.js';
import { recordPreview } from './lib/record-preview.js';
import { el, button, field, closeOnBackdrop } from './lib/dom.js';
import { favicon, websiteLink } from './lib/websites.js';
import { PINNED_RECORDS, togglePinnedRecord } from './lib/pins.js';

const db = new Database(),
  $ = (id) => document.getElementById(id);
let config,
  catalog = [],
  timer,
  toastTimer,
  activeDialog,
  generation = 0;
await installTheme();
function notify(message) {
  $('start-status').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('start-status').textContent = '';
  }, 5000);
}
const act =
  (fn) =>
  (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch((error) => notify(error.message));
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => refresh().catch((error) => notify(error.message)), 80);
}
function modal(title, { parent = null, onClose } = {}) {
  if (activeDialog?.open && activeDialog !== parent) activeDialog.close();
  const dialog = el('dialog', { class: 'start-dialog', 'aria-label': title });
  const body = el('div', { class: 'dialog-body' }),
    footer = el('div', { class: 'dialog-footer' });
  dialog.append(
    el(
      'header',
      { class: 'dialog-header' },
      el('h2', {}, title),
      button('×', () => dialog.close(), 'icon-button'),
    ),
    body,
    footer,
  );
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (activeDialog === dialog) activeDialog = parent?.open ? parent : null;
    onClose?.();
  });
  closeOnBackdrop(dialog);
  document.body.append(dialog);
  dialog.showModal();
  activeDialog = dialog;
  return { dialog, body, footer };
}
const empty = (message) => el('div', { class: 'start-empty' }, message);
function card(record, content, open, extra = '') {
  return el(
    'article',
    {
      class: `home-card ${extra}`,
      role: 'button',
      tabindex: 0,
      'aria-label': msg`查看 ${record.title || t('记录')}`,
      'data-record-id': record.id,
      onclick: act(open),
      onkeydown: (event) => {
        if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          act(open)();
        }
      },
    },
    content,
  );
}
function siteIcon(url) {
  return el('img', {
    src: favicon(url),
    alt: '',
    loading: 'lazy',
    onerror: (event) => {
      event.currentTarget.hidden = true;
    },
  });
}
const date = (value) =>
  new Intl.DateTimeFormat(getLanguage(), { month: 'numeric', day: 'numeric' }).format(
    new Date(value),
  );
const isDivider = (item) => item.kind === 'divider' || /^([-*_])\1{2,}$/.test(item.text.trim());

function renderList(record) {
  const todos = record.list.filter((item) => item.is_checkbox);
  const ideas = record.list.filter((item) => !item.is_checkbox);
  $('todo-count').textContent =
    msg`${todos.filter((item) => !isDivider(item) && !item.checked).length} 待完成`;
  $('idea-count').textContent = msg`${ideas.filter((item) => !isDivider(item)).length} 个念头`;
  for (const [id, items, mode] of [
    ['todo-items', todos, true],
    ['idea-items', ideas, false],
  ])
    $(id).replaceChildren(
      ...(items.length
        ? items.map((item) => {
            const divider = isDivider(item);
            const remove = button(
              '×',
              act(() => editStartList(db, (list) => list.filter((entry) => entry.id !== item.id))),
              'start-task-delete',
            );
            remove.setAttribute(
              'aria-label',
              `${t('删除')} ${mode ? 'Todo' : 'Idea'} ${divider ? t('分隔线') : item.text}`,
            );
            remove.title = t('删除');
            if (divider)
              return el(
                'div',
                { class: 'start-task start-divider' },
                el('hr', { 'aria-label': t('分隔线') }),
                remove,
              );
            return el(
              'div',
              { class: `start-task${item.checked ? ' completed' : ''}` },
              mode
                ? el('input', {
                    type: 'checkbox',
                    checked: item.checked,
                    'aria-label': msg`完成 ${item.text}`,
                    onchange: act(async (event) => {
                      const checked = event.target.checked;
                      try {
                        await editStartList(db, (list) => {
                          const target = list.find((i) => i.id === item.id);
                          if (!target) throw new Error(t('这条 Todo 已在另一窗口移除。'));
                          target.checked = checked;
                          return list;
                        });
                      } catch (error) {
                        event.target.checked = !checked;
                        throw error;
                      }
                    }),
                  })
                : el('span', { class: 'idea-bullet', 'aria-hidden': 'true' }, '•'),
              button(item.text, () => editListItem(item, mode), 'task-text'),
              remove,
            );
          })
        : [empty(mode ? t('给今天留下一件想完成的事。') : t('灵感不必完整，先记下来。'))]),
    );
}
function editListItem(item, mode) {
  const { dialog, body, footer } = modal(mode ? t('编辑 Todo') : t('编辑 Idea'));
  const text = el('textarea', {
    rows: 4,
    maxlength: 5000,
    'aria-label': mode ? t('Todo 内容') : t('Idea 内容'),
  });
  text.value = item.text;
  const error = el('p', { class: 'error-text', role: 'status' });
  body.append(field(t('内容'), text), error);
  footer.append(
    button(
      t('删除'),
      act(async () => {
        await editStartList(db, (list) => list.filter((i) => i.id !== item.id));
        dialog.close();
      }),
      'button danger',
    ),
    button(t('取消'), () => dialog.close()),
    button(
      t('保存'),
      async () => {
        try {
          if (!text.value.trim()) throw new Error(t('请填写内容。'));
          await editStartList(db, (list) => {
            const target = list.find((i) => i.id === item.id);
            if (!target) throw new Error(t('这条内容已在另一窗口移除。'));
            target.text = text.value.trim();
            return list;
          });
          dialog.close();
        } catch (e) {
          error.textContent = e.message;
        }
      },
      'button primary',
    ),
  );
}
for (const mode of ['todo', 'idea']) {
  $(mode + '-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $(mode + '-input'),
      text = input.value.trim(),
      submit = event.currentTarget.querySelector('button');
    if (!text || submit.disabled) return;
    submit.disabled = true;
    const divider = /^([-*_])\1{2,}$/.test(text);
    const item = {
      id: crypto.randomUUID(),
      kind: divider ? 'divider' : 'item',
      text: divider ? '' : text,
      checked: false,
      is_checkbox: mode === 'todo',
    };
    editStartList(db, (list) => [...list, item])
      .then(() => {
        if (input.value.trim() === text) input.value = '';
        schedule();
      })
      .catch((error) => notify(error.message))
      .finally(() => {
        submit.disabled = false;
      });
  });
  $('open-' + mode).addEventListener(
    'click',
    act(() => openRecord(LIST_ID)),
  );
}
async function openRecord(id, parent = null) {
  const row = (await db.get(id)) || (id === LIST_ID ? await singletonList(db) : null);
  if (!row || row.record.deleted_at || row.record.kind === 'tombstone')
    throw new Error(t('这条记录已不在资料库中。'));
  let preview,
    disposed = false;
  const { dialog, body, footer } = modal(t('记录详情'), {
    parent,
    onClose: () => {
      disposed = true;
      preview?.dispose?.();
    },
  });
  preview = await recordPreview(db, row.record);
  if (disposed) {
    preview.dispose?.();
    return;
  }
  body.append(preview);
  if (row.record.type !== 'list') {
    const pinnedIds = await db.getState(PINNED_RECORDS, []);
    footer.append(
      button(
        row.record.favorite ? t('★ 已喜爱') : t('☆ 喜爱'),
        act(async () => {
          await db.mutate(id, (r) => ({
            ...upgradeRecord(r),
            schema_version: 5,
            favorite: !r.favorite,
            updated_at: new Date().toISOString(),
          }));
          dialog.close();
          await openRecord(id, parent);
        }),
      ),
      button(
        pinnedIds.includes(id) ? t('取消置顶') : t('置顶'),
        act(async () => {
          await togglePinnedRecord(db, id);
          dialog.close();
          await openRecord(id, parent);
        }),
      ),
    );
  }
  footer.append(
    el(
      'a',
      {
        class: 'button',
        href: row.rev
          ? `dashboard.html?record=${encodeURIComponent(id)}&edit=1`
          : 'dashboard.html?new=list',
        target: '_blank',
        rel: 'noopener',
      },
      t('编辑记录 ↗'),
    ),
    button(t('关闭'), () => dialog.close()),
  );
}
function favoriteCard(record) {
  const source = record.sources.find((s) => /^https?:/.test(s.url)),
    host = new URL(source.url).hostname.replace(/^www\./, '');
  return card(
    record,
    [
      el(
        'div',
        { class: 'favorite-top' },
        siteIcon(source.url),
        el('span', { class: 'site-name' }, host),
        el('span', { class: 'favorite-star' }, '✦'),
      ),
      el('h3', {}, record.title || source.title || host),
      el('p', { class: 'card-excerpt' }, record.summary || t('打开看看当时留下的内容。')),
      el(
        'div',
        { class: 'card-foot' },
        record.tags[0]
          ? el('span', { class: 'home-tag' }, record.tags[0])
          : el('span', {}, t('收藏')),
        el('time', {}, date(record.updated_at)),
      ),
    ],
    () => openRecord(record.id),
    'favorite-card',
  );
}
function pinnedCard(record) {
  return card(
    record,
    [
      el('span', { class: 'pinned-mark' }, '📌 ', t(displayType(record.type))),
      el('h3', {}, record.title || t('未命名记录')),
      el('p', { class: 'card-excerpt' }, record.summary || t('打开查看内容')),
      el(
        'div',
        { class: 'card-foot' },
        record.tags[0] || t('已置顶'),
        el('time', {}, date(record.updated_at)),
      ),
    ],
    () => openRecord(record.id),
    'pinned-card',
  );
}
function projectCard(project, parent = null) {
  const count = catalog.filter((r) => !r.deleted_at && r.project_ids?.includes(project.id)).length;
  return card(
    project,
    [
      el('span', { class: 'project-symbol' }, project.appearance?.icon || '📁'),
      el('h3', {}, project.title),
      el('p', { class: 'card-excerpt' }, project.summary || t('在这里，把零散的知识连起来。')),
      el('div', { class: 'card-foot' }, msg`${count} 条记录`, '↗'),
    ],
    () => openProject(project.id, parent),
    'project-card',
  );
}
async function openProject(id, parent = null) {
  const row = await db.get(id);
  if (!row || row.record.deleted_at || row.record.type !== 'project')
    throw new Error(t('项目已不存在。'));
  const { dialog, body, footer } = modal(row.record.title, { parent });
  body.append(el('p', { class: 'description' }, row.record.summary || t('这个项目还没有描述。')));
  const current = (await db.allCatalog()).filter((r) => !r.deleted_at && r.kind !== 'tombstone');
  const children = current.filter((r) => r.type === 'project' && r.parent_project_id === id),
    members = current.filter((r) => r.project_ids?.includes(id));
  if (children.length)
    body.append(
      el('h3', {}, t('子项目')),
      el('div', { class: 'project-grid' }, ...children.map((p) => projectCard(p, dialog))),
    );
  body.append(
    el('h3', {}, msg`项目记录 · ${members.length}`),
    ...(members.length
      ? members.map((r) =>
          card(
            r,
            [
              el('h3', {}, r.type === 'list' ? 'Todo / Idea' : r.title || t('未命名记录')),
              el('p', { class: 'card-excerpt' }, r.summary || t('打开查看内容')),
            ],
            () => openRecord(r.id, dialog),
          ),
        )
      : [empty(t('还没有记录，可以在整理页把资料加入这个项目。'))]),
  );
  footer.append(
    el(
      'a',
      {
        href: `dashboard.html?project=${encodeURIComponent(id)}`,
        class: 'button',
        target: '_blank',
        rel: 'noopener',
      },
      t('在整理页打开 ↗'),
    ),
    button(t('关闭'), () => dialog.close()),
  );
}
function renderDock() {
  $('site-dock').replaceChildren(
    ...config.shortcuts.map((site) =>
      el(
        'a',
        { href: site.url, class: 'dock-link', title: site.name },
        siteIcon(site.url),
        el('span', {}, site.name),
      ),
    ),
    ...(!config.shortcuts.length
      ? [el('span', { class: 'dock-empty' }, t('把常用网站放在这里'))]
      : []),
    button('＋', () => shortcutEditor(), 'dock-control'),
    el('span', { class: 'dock-manage' }, button('⚙', manageDock, 'dock-control')),
  );
  $('site-dock').querySelector('button').setAttribute('aria-label', t('添加常用网站'));
  $('site-dock').querySelector('.dock-manage button').setAttribute('aria-label', t('管理常用网站'));
}
function shortcutEditor(site = null, parent = null) {
  if (!site && config.shortcuts.length >= 12) {
    notify(t('最多添加 12 个常用网站，可在管理中替换。'));
    return;
  }
  const { dialog, body, footer } = modal(site ? t('编辑常用网站') : t('添加常用网站'), { parent });
  const name = el('input', { type: 'text', maxlength: 40, 'aria-label': t('网站名称') }),
    url = el('input', {
      type: 'text',
      'aria-label': t('网站地址'),
      placeholder: 'https://example.com',
      maxlength: 8000,
    });
  name.value = site?.name || '';
  url.value = site?.url || '';
  const error = el('p', { class: 'error-text', role: 'status' });
  body.append(field(t('网站名称'), name), field(t('网站地址'), url), error);
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('保存网站'),
      async () => {
        try {
          if (!name.value.trim()) throw new Error(t('请填写网站名称。'));
          const value = {
            id: site?.id || crypto.randomUUID(),
            name: name.value.trim(),
            url: normalizeShortcutUrl(url.value),
          };
          await updateStartConfig((current) => {
            if (!site && current.shortcuts.length >= 12)
              throw new Error(t('最多添加 12 个常用网站。'));
            if (site && !current.shortcuts.some((item) => item.id === site.id))
              throw new Error(t('网站已在其他页面移除，请重新添加。'));
            return {
              shortcuts: site
                ? current.shortcuts.map((item) => (item.id === site.id ? value : item))
                : [...current.shortcuts, value],
            };
          });
          dialog.close();
          if (parent?.open) {
            parent.close();
            await manageDock();
          }
        } catch (e) {
          error.textContent = e.message;
        }
      },
      'button primary',
    ),
  );
}
async function manageDock() {
  config = await readStartConfig();
  const { dialog, body, footer } = modal(t('管理常用网站'));
  if (!config.shortcuts.length)
    body.append(empty(t('还没有常用网站。点击添加，把常去的地方放进 Dock。')));
  for (const [index, site] of config.shortcuts.entries()) {
    const move = (delta) =>
      act(async () => {
        await updateStartConfig((current) => {
          const list = [...current.shortcuts],
            from = list.findIndex((item) => item.id === site.id),
            to = from + delta;
          if (from < 0 || to < 0 || to >= list.length) return {};
          [list[from], list[to]] = [list[to], list[from]];
          return { shortcuts: list };
        });
        dialog.close();
        await manageDock();
      });
    const up = button('↑', move(-1));
    up.disabled = index === 0;
    up.setAttribute('aria-label', msg`上移 ${site.name}`);
    const down = button('↓', move(1));
    down.disabled = index === config.shortcuts.length - 1;
    down.setAttribute('aria-label', msg`下移 ${site.name}`);
    body.append(
      el(
        'div',
        { class: 'dock-edit-row' },
        el('strong', {}, site.name),
        up,
        down,
        button(t('编辑'), () => shortcutEditor(site, dialog)),
        button(
          t('移除'),
          act(async () => {
            await updateStartConfig((current) => ({
              shortcuts: current.shortcuts.filter((item) => item.id !== site.id),
            }));
            dialog.close();
            await manageDock();
          }),
        ),
      ),
    );
  }
  footer.append(
    button(t('添加网站'), () => shortcutEditor(null, dialog)),
    button(t('关闭'), () => dialog.close()),
  );
}
async function refresh() {
  const current = ++generation;
  const [rows, list, preferences, pinnedIds] = await Promise.all([
    db.allCatalog(),
    db.get(LIST_ID),
    readStartConfig(),
    db.getState(PINNED_RECORDS, []),
  ]);
  if (current !== generation) return;
  catalog = rows;
  config = preferences;
  $('today').textContent = new Intl.DateTimeFormat(getLanguage(), {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
  renderList(
    list && !list.record.deleted_at && list.record.kind !== 'tombstone'
      ? upgradeRecord(list.record)
      : newRecord({ type: 'list' }),
  );
  renderDock();
  const active = rows.filter((r) => !r.deleted_at && r.kind !== 'tombstone'),
    recent = (a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
  const activeById = new Map(active.map((record) => [record.id, record]));
  const pinned = pinnedIds
    .map((id) => activeById.get(id))
    .filter((record) => record && !['project', 'list'].includes(record.type));
  $('pinned-section').hidden = !pinned.length;
  $('pinned-cards').replaceChildren(...pinned.map(pinnedCard));
  const favorites = active
    .filter(
      (r) =>
        r.favorite &&
        !['project', 'list', 'website_group'].includes(r.type) &&
        r.sources.some((s) => /^https?:/.test(s.url)),
    )
    .sort(recent)
    .slice(0, config.favoritesLimit);
  $('favorite-cards').replaceChildren(
    ...(favorites.length
      ? favorites.map(favoriteCard)
      : [empty(t('把喜欢的网页标记为“喜爱”，下次打开就能在这里遇见。'))]),
  );
  const projects = active
    .filter((r) => r.type === 'project')
    .sort(recent)
    .slice(0, 6);
  $('project-cards').replaceChildren(
    ...(projects.length
      ? projects.map((p) => projectCard(p))
      : [empty(t('建一个项目，让记录有一个可以相遇的地方。'))]),
  );
  const groups = active
    .filter((r) => r.type === 'website_group' && r.unread_count > 0)
    .sort(recent)
    .slice(0, 5);
  const groupRows = await Promise.all(groups.map((r) => db.get(r.id)));
  if (current !== generation) return;
  $('group-cards').replaceChildren(
    ...(groupRows.length
      ? groupRows.filter(Boolean).map(({ record }) =>
          card(
            record,
            [
              el(
                'div',
                { class: 'group-heading' },
                el('h3', {}, record.title || t('网页组')),
                el(
                  'span',
                  { class: 'unread-label' },
                  msg`${record.url_list.filter((item) => !item.read_at && !item.removed_at).length} 待浏览`,
                ),
              ),
              el(
                'div',
                { class: 'group-sites' },
                ...record.url_list
                  .filter((item) => !item.read_at && !item.removed_at)
                  .slice(0, 3)
                  .map(websiteLink),
              ),
            ],
            () => openRecord(record.id),
            'group-card',
          ),
        )
      : [empty(t('待浏览的网页组会出现在这里，一次打开，一点点读完。'))]),
  );
}
await migrateTodos(db).catch((error) => notify(error.message));
db.onChange((kind) => {
  if (kind !== 'draft') schedule();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[START_KEY]) schedule();
});
window.addEventListener('pagehide', () => {
  clearTimeout(timer);
  void db.close();
});
await refresh().catch((error) => notify(error.message));

import { icon } from './lib/icons.js';
import { colorControl, iconChoices, tagBadge } from './lib/appearance.js';
import { installTheme, themeEditor } from './lib/theme.js';
import { recordPreview } from './lib/record-preview.js';
import { Database } from './lib/db.js';
import {
  activeProject,
  projectTree,
  upgradeProject,
  setProjectMemberships,
  saveProject,
} from './lib/projects.js';
import { projectGraph } from './lib/project-graph.js';
import { CompanionClient, handoffCompanion } from './lib/companion.js';
import { companionInstaller } from './lib/companion-install.js';
import { loadAsset } from './lib/assets.js';
import {
  newRecord,
  TYPES,
  TASK_STATUSES,
  LIST_ID,
  upgradeRecord,
  displayType,
  duplicateIds,
  safeUrl,
} from './lib/model.js';
import { captureInto, appendCapture } from './lib/capture.js';
import { readConfig, protectStorage } from './lib/config.js';
import {
  el,
  button,
  field,
  option,
  dateLabel,
  download,
  markdownPreview,
  assetView,
} from './lib/dom.js';
import {
  loadExamples,
  loadExampleAsset,
  saveExample,
  saveExamples,
  EXAMPLES_VISIBLE,
} from './lib/examples.js';
import { typedCard } from './lib/card.js';
import { createEditor } from './lib/editor.js';
import { cachedDraft, clearDraft } from './lib/drafts.js';
import { COLLECTION_QUEUE, COLLECTION_LOCK } from './lib/collected.js';
import { singletonList, migrateTodos, appendWebsites, listDocument } from './lib/collections.js';
import { droppedWebsites, closeCapturedTabs } from './lib/tabs.js';
import { buildLocalBackup, buildMarkdownExport, previewZipImport } from './lib/backup.js';

const db = new Database();
await installTheme();
const panel = document.body.dataset.mode === 'panel';
const state = {
  view: 'inbox',
  query: '',
  tag: '',
  type: '',
  project: '',
  limit: panel ? 20 : 60,
  selected: new Set(),
  projects: [],
  captures: [],
  conflicts: [],
  items: [],
  busy: false,
  progress: '',
  generation: 0,
  tagGroups: [],
  pinnedIds: [],
  cardModes: {},
};
const TAG_GROUPS = 'ui:tag-groups',
  PINNED_RECORDS = 'ui:pinned-records';
const RECORD_DRAG_TYPE = 'application/x-pkm-records';
let viewStorageKey;
let currentWindowId;
const $ = (id) => document.getElementById(id);
let toastTimer, refreshTimer, activeDialog, panelEditor;
let examples = [],
  examplesError = '';
function toast(text, error = false) {
  const node = $('toast');
  node.textContent = text;
  node.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      node.className = '';
    },
    error ? 9000 : 4500,
  );
}
const act =
  (fn) =>
  (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch((error) => toast(error.message || '操作失败，请重试。', true));
function refreshSoon(delay = 100) {
  persistView();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch((error) => toast(error.message, true)), delay);
}
function persistView() {
  if (!viewStorageKey) return;
  const { view, query, tag, type, project, limit, examplesExpanded, cardModes } = state;
  chrome.storage.session
    .set({
      [viewStorageKey]: {
        view,
        query,
        tag,
        type,
        project,
        limit,
        examplesExpanded,
        cardModes,
      },
    })
    .catch(() => {});
}
function openDashboard(hash = '') {
  return chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash}`) });
}
function modal(title, { wide = false, onClose, parent = null } = {}) {
  if (activeDialog?.open && activeDialog !== parent) activeDialog.close();
  const dialog = el('dialog', { class: wide ? 'wide' : '', 'aria-label': title });
  const body = el('div', { class: 'dialog-body' }),
    footer = el('div', { class: 'dialog-footer' });
  dialog.append(
    el(
      'div',
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
    Promise.resolve()
      .then(() => onClose?.())
      .catch((error) => toast(error.message, true));
  });
  document.body.append(dialog);
  dialog.showModal();
  activeDialog = dialog;
  return { dialog, body, footer };
}
function splitTags(value) {
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}
function textInput(value = '', attrs = {}) {
  return el('input', { type: 'text', value, ...attrs });
}
function textarea(value = '', attrs = {}) {
  const node = el('textarea', attrs);
  node.value = value;
  return node;
}
function check(label, checked = false, attrs = {}) {
  const input = el('input', { type: 'checkbox', checked, ...attrs });
  return { input, label: el('label', { class: 'checkbox-line' }, input, label) };
}
function titleOf(record) {
  return record.type === 'list'
    ? 'Todo / Idea'
    : record.kind === 'tombstone'
      ? '已移除当前正文'
      : record.title || '未命名记录';
}
const VIEWS = {
  inbox: ['收件箱', '所有新收集都先留在这里。先保存，稍后整理。', '▣'],
  all: ['全部记录', '你的文字、链接与想法，保存在自己的数据库中。', '≡'],
  organized: ['已整理', '已经分类，随时可以再次使用。', '✓'],
  favorites: ['喜爱', '收藏的记录，随时回来浏览。', '☆'],
  duplicates: ['重复检查', '检查正文相同的记录和重复保存的网页链接。', '⊕'],
  pending: ['待同步记录', '这些修改只保存在本机，点击同步后才会上传。', '↥'],
  trash: ['回收站', '删除与还原也由你决定同步时机。回收站不会自动清空。', '⌫'],
};

// This template contains no user data; all dynamic text uses textContent / DOM nodes.
$('app').innerHTML = `
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><img class="brand-penguin" src="icons/penguin.png" alt="企鹅"><div><div class="brand-name">PKM Nexus</div><div class="brand-sub">YOUR KNOWLEDGE, YOURS.</div></div></div>
    <nav id="nav" class="nav" aria-label="记录视图"></nav>
    <section class="projects-section"><div class="section-label"><span>项目</span><button id="add-project" class="icon-button" aria-label="新增项目">＋</button></div><div id="projects-nav"></div></section>
    <section class="tag-groups" aria-label="标签"><div class="section-label"><span>标签</span><div><button id="tag-appearance" class="icon-button" aria-label="设置标签外观">⚙</button><button id="add-tag-group" class="icon-button" aria-label="新建标签">＋</button></div></div><div id="tags-nav" class="tag-cloud"></div></section>
    <p class="tag-group-hint muted">把标签拖到记录上；把记录拖到项目文件夹。归类后可标记已整理。</p>
    <nav id="utility-nav" class="nav utility-nav" aria-label="重复检查与回收站"></nav>
    <div class="sidebar-bottom"><div id="library-summary" class="library-summary"></div><button id="theme" class="nav-item">◐　主题与字体</button><button id="manual" class="nav-item">▤　使用说明书</button><button id="settings" class="nav-item">⚙　设置与数据管理</button><small class="extension-version muted"></small></div>
  </aside>
  <main class="main"><div class="panel-brand"><img class="brand-penguin" src="icons/penguin.png" alt="企鹅"><strong>PKM Nexus</strong></div>
    <header class="topbar"><div class="search-wrap"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="搜索标题、正文、标签和来源…" aria-label="搜索记录"></div><div class="topbar-actions"><button id="save-local" class="button">保存到本地</button><button id="sync" class="button">↻ 立即同步</button><button id="new" class="button primary">＋ 新建记录</button></div></header>
    <div class="content">
      <section id="capture-box" class="capture-box"></section>
      <div class="page-eyebrow">PERSONAL KNOWLEDGE INBOX</div>
      <div class="page-heading"><div><h1 id="heading"></h1><p id="description" class="description"></p></div><div id="sync-status" class="sync-status"></div></div>
      <div id="notices"></div>
      <div class="filters"><label class="checkbox-line"><input id="select-all" type="checkbox">选择本页</label><div id="type-filter" class="filter-tabs" role="tablist" aria-label="记录类型"></div><select id="tag-filter" aria-label="标签筛选"></select><span class="spacer"></span><div id="project-actions"></div><small id="result-count" class="muted"></small></div>
      <div id="selection-bar" class="selection-bar" hidden></div>
      <section id="builtin-examples" aria-label="内置示例" hidden></section>
      <section id="records" class="records" aria-label="记录列表"></section>
      <button id="load-more" class="button load-more" hidden>加载更多</button>
    </div>
    <footer class="panel-footer"><div class="panel-footer-meta"><small id="extension-version" class="extension-version muted"></small><button id="examples-shortcut" class="link-button" aria-controls="builtin-examples">查看内置示例</button></div><div id="panel-sync-status" class="sync-status"></div><button id="panel-sync" class="button primary">立即同步</button><button id="panel-save-local" class="button">保存到本地</button><button id="open-dashboard" class="button">整理页 ↗</button><button id="panel-manual" class="icon-button" aria-label="使用说明书">?</button><button id="panel-settings" class="icon-button" aria-label="打开设置">⚙</button></footer>
  </main>
</div>`;

for (const [id, label, name] of [
  ['theme', '主题与字体', 'theme'],
  ['manual', '使用说明书', 'book'],
  ['settings', '设置与数据管理', 'settings'],
]) {
  $(id).replaceChildren(
    el('span', { class: 'nav-symbol', 'aria-hidden': 'true' }, icon(name)),
    el('span', { class: 'nav-label' }, label),
  );
}
for (const penguin of document.querySelectorAll('.brand-penguin')) {
  if (!panel && !matchMedia('(prefers-reduced-motion: reduce)').matches)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        penguin.classList.add('animate-penguin');
        setTimeout(() => penguin.classList.remove('animate-penguin'), 650);
      }),
    );
}
const NAV_ICONS = {
  inbox: 'inbox',
  all: 'records',
  organized: 'check',
  favorites: 'star',
  duplicates: 'duplicates',
  pending: 'upload',
  trash: 'trash',
};
for (const key of Object.keys(VIEWS)) $('nav').append(button('', () => setView(key), 'nav-item'));
Object.keys(VIEWS).forEach((key, i) => {
  const node = $('nav').children[i];
  node.dataset.view = key;
  node.append(
    el('span', { class: 'nav-symbol', 'aria-hidden': 'true' }, icon(NAV_ICONS[key])),
    el('span', { class: 'nav-label' }, VIEWS[key][0]),
    el('span', { class: 'count' }),
  );
  if (['inbox', 'organized'].includes(key))
    recordDropTarget(node, ({ ids }) => setOrganization(ids, key));
});
$('type-filter').append(
  ...[['', '全部'], ...Object.entries(TYPES)].map(([type, label]) => {
    const node = button(
      label,
      () => {
        state.type = type;
        state.selected.clear();
        refreshSoon();
      },
      'type-tab',
    );
    node.dataset.type = type;
    node.setAttribute('role', 'tab');
    return node;
  }),
);
$('search').addEventListener('input', () => {
  state.query = $('search').value;
  state.limit = 60;
  state.selected.clear();
  refreshSoon(220);
});

$('tag-filter').addEventListener('change', () => {
  state.tag = $('tag-filter').value;
  state.project = '';
  state.selected.clear();
  refreshSoon();
});
$('select-all').addEventListener('change', () => {
  if ($('select-all').checked)
    state.items.filter((m) => m.type !== 'list').forEach((m) => state.selected.add(m.id));
  else state.selected.clear();
  renderSelection();
  renderCards();
});
$('load-more').addEventListener('click', () => {
  state.limit += panel ? 20 : 60;
  refreshSoon();
});
$('new').addEventListener(
  'click',
  act(() => openEditor()),
);
for (const key of ['duplicates', 'trash'])
  $('utility-nav').append(document.querySelector(`[data-view="${key}"]`));
$('tag-appearance').addEventListener(
  'click',
  act(() => openTagStyle()),
);
$('settings').addEventListener('click', act(openSettings));
$('theme').addEventListener('click', act(openTheme));
const panelTheme = button('◐', act(openTheme), 'icon-button');
panelTheme.setAttribute('aria-label', '主题与字体');
$('manual').addEventListener('click', () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('manual.html') }),
);
$('panel-manual').addEventListener('click', () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('manual.html') }),
);
$('panel-settings').addEventListener('click', () => openDashboard('#settings'));
$('add-project').addEventListener(
  'click',
  act(() => openProject()),
);
$('add-tag-group').addEventListener('click', () => openTagGroup());
$('open-dashboard').addEventListener('click', () => openDashboard());
if (panel) $('extension-version').after(panelTheme, $('panel-manual'), $('panel-settings'));
for (const node of document.querySelectorAll('.extension-version'))
  node.textContent = `PKM Nexus v${chrome.runtime.getManifest().version}`;
$('examples-shortcut').addEventListener('click', act(showExamples));
$('sync').addEventListener(
  'click',
  act(() => syncNow()),
);
$('panel-sync').addEventListener(
  'click',
  act(() => syncNow()),
);
$('save-local').addEventListener('click', act(saveLocal));
$('panel-save-local').addEventListener('click', act(saveLocal));
async function saveLocal() {
  if (panelEditor?.recording) throw new Error('请先停止录音，再保存完整本地包。');
  await panelEditor?.flush();
  for (const id of ['save-local', 'panel-save-local']) $(id).disabled = true;
  try {
    const blob = await buildLocalBackup(db, {
      progress: (message) => {
        $('sync-status').textContent = message;
        $('panel-sync-status').textContent = message;
      },
    });
    download(
      `PKM-Nexus-data-${new Date().toISOString().slice(0, 10)}.zip`,
      blob,
      'application/zip',
    );
    toast('已生成完整本地 ZIP：包含记录、图片、音频和 Markdown。');
  } finally {
    for (const id of ['save-local', 'panel-save-local']) $(id).disabled = false;
    await refresh();
  }
}
function setView(view, project = '') {
  state.view = view;
  state.project = project;
  state.tag = '';
  state.selected.clear();
  state.limit = panel ? 20 : 60;
  refreshSoon();
}

async function refresh() {
  const generation = ++state.generation;
  const [
    catalog,
    captures,
    conflicts,
    lastSync,
    settings,
    notice,
    examplesVisible,
    tagGroups,
    pinnedIds,
  ] = await Promise.all([
    db.allCatalog(),
    db.captures(),
    db.getState('companion:conflicts', []),
    db.getState('companion:last'),
    readConfig(),
    db.getState('notice'),
    db.getState(EXAMPLES_VISIBLE, true),
    db.getState(TAG_GROUPS, []),
    db.getState(PINNED_RECORDS, []),
  ]);
  const projects = catalog.filter((m) => m.type === 'project' && !m.deleted_at);
  state.companionEnabled = settings.companionEnabled;
  const links = await db.companionLinks();
  const pendingIds = new Set(
    catalog.filter((m) => links.get(m.id)?.hash !== m.hash).map((m) => m.id),
  );
  for (const item of catalog) item.dirty = pendingIds.has(item.id);
  const duplicates = duplicateIds(catalog);
  const results = await db.list({
    view: state.view,
    query: state.query,
    tag: state.tag,
    type: state.type,
    project: state.project,
    ids: state.view === 'duplicates' ? duplicates : null,
    pendingIds,
    pinnedIds,
    limit: state.limit,
  });
  if (generation !== state.generation) return;
  for (const tab of $('type-filter').children) {
    tab.classList.toggle('active', tab.dataset.type === state.type);
    tab.setAttribute('aria-selected', String(tab.dataset.type === state.type));
  }
  state.projects = projects;
  state.pinnedIds = pinnedIds;
  state.captures = captures;
  state.conflicts = conflicts;
  state.items = results.items.map((item) =>
    pendingIds ? { ...item, dirty: pendingIds.has(item.id) } : item,
  );
  state.notice = notice;
  const active = catalog.filter((m) => !m.deleted_at && m.type !== 'project');
  const counts = {
    inbox: active.filter((m) => m.organization_state === 'inbox').length,
    all: active.length,
    favorites: active.filter((m) => m.favorite).length,
    organized: active.filter((m) => m.organization_state === 'organized').length,
    duplicates: duplicates.size,
    pending: catalog.filter((m) => m.dirty).length,
    trash: catalog.filter((m) => m.deleted_at && m.kind !== 'tombstone').length,
  };
  for (const node of [...document.querySelectorAll('.nav-item[data-view]')]) {
    node.classList.toggle(
      'active',
      node.dataset.view === state.view && !state.project && !state.tag,
    );
    node.querySelector('.count').textContent = counts[node.dataset.view] || '';
  }
  const projectBranches = new Map();
  const projectRoots = [];
  for (const p of projectTree(projects)) {
    const node = el(
      'div',
      { class: `project-nav${state.project === p.id ? ' active' : ''}`, 'data-project-id': p.id },
      button(
        `${p.appearance?.icon || '📁'}  ${p.title}`,
        () => {
          setView('all', p.id);
        },
        'link-button',
      ),
      el(
        'small',
        { class: 'muted' },
        String(active.filter((m) => m.project_ids.includes(p.id)).length),
      ),
      button(
        '⋯',
        act(() => openProject(p.id)),
        'icon-button',
      ),
    );
    node.title = p.breadcrumb;
    if (p.appearance?.color) node.style.color = p.appearance.color;
    recordDropTarget(node, ({ ids }) => addToProjects(ids, [p.id]));
    const branch = el('div', { class: 'project-branch' }, node);
    const children = el('div', { class: 'project-children' });
    branch.append(children);
    projectBranches.set(p.id, children);
    if (projectBranches.has(p.parent_project_id))
      projectBranches.get(p.parent_project_id).append(branch);
    else projectRoots.push(branch);
  }
  $('projects-nav').replaceChildren(...projectRoots);
  const p = projects.find((p) => p.id === state.project);
  if (state.project && !p) state.project = '';
  document.querySelector('.page-eyebrow').hidden = !!p;
  $('heading').textContent = p ? p.title : state.tag ? `标签 · ${state.tag}` : VIEWS[state.view][0];
  $('description').textContent = p
    ? p.summary || '为这个项目添加描述，说明目标与资料范围。'
    : state.tag
      ? '把标签拖到记录上即可追加分类，保留已有标签。'
      : VIEWS[state.view][1];
  const pending = catalog.filter((m) => m.dirty).length;
  const localStatus = lastSync;
  const lastError = await db.getState('companion:error');
  const statusNodes = () => [
    el('span', { class: `dot${pending ? ' pending' : ''}` }),
    el(
      'span',
      {},
      state.busy
        ? state.progress
        : lastError
          ? `本地交接失败：${lastError.message}`
          : !settings.companionEnabled
            ? `已保存到浏览器 · ${pending} 项待连接本地资料库`
            : pending
              ? `已保存到浏览器 · ${pending} 项待交接本地程序`
              : !localStatus
                ? '等待本地程序确认'
                : localStatus.driveError
                  ? `已保存到本地资料库 · Drive 同步失败：${localStatus.driveError.message}`
                  : !localStatus.driveConnected
                    ? '已保存到本地资料库 · 待连接 Google Drive'
                    : !localStatus.driveBound
                      ? '已保存到本地资料库 · 待选择 Drive 资料库'
                      : `已保存到本地资料库 · ${localStatus.drivePending} 条待传 Drive${localStatus.conflicts ? ` · ${localStatus.conflicts} 条冲突` : ''}${localStatus.deferred ? ` · ${localStatus.deferred} 条关联资料待处理` : ''}`,
    ),
    ...(!state.busy && localStatus?.lastDriveSync
      ? [el('span', {}, ` · 上次 Drive 同步 ${dateLabel(localStatus.lastDriveSync)}`)]
      : []),
  ];
  $('sync-status').replaceChildren(...statusNodes());
  $('panel-sync-status').replaceChildren(...statusNodes());
  for (const id of ['sync', 'panel-sync']) {
    $(id).disabled = state.busy;
    $(id).textContent = state.busy ? '同步中…' : '↻ 立即同步';
  }
  $('library-summary').replaceChildren(
    el('span', {}, settings.companionEnabled ? '本地资料库 · Google Drive' : '尚未连接本地资料库'),
    el('small', {}, '浏览器离线保存；连接本地程序后交接，云端同步由本地程序执行。'),
  );
  const tags = [...new Set([...tagGroups, ...active.flatMap((m) => m.tags)])].sort((a, b) =>
    a.localeCompare(b),
  );
  state.tagGroups = tags;
  state.tagStyles = await db.getState('ui:tag-styles', {});
  $('tags-nav').replaceChildren(
    ...tags.map((tag) => {
      const node = button(
        '',
        () => {
          setView('all');
          state.tag = tag;
          persistView();
        },
        'tag-chip tag-group',
      );
      node.dataset.tag = tag;
      node.classList.toggle('active', tag === state.tag);
      node.append(
        el('span', { class: 'tag-group-name' }, tag),
        el('span', { class: 'count' }, String(active.filter((m) => m.tags.includes(tag)).length)),
      );
      node.draggable = true;
      node.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('application/x-pkm-tag', tag);
        event.dataTransfer.effectAllowed = 'copy';
      });
      node.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openTagStyle(tag);
      });
      if (state.tagStyles[tag]?.color)
        node.style.setProperty('--tag-color', state.tagStyles[tag].color);
      return node;
    }),
    ...(!tags.length ? [el('small', { class: 'muted tag-group-empty' }, '点击 ＋ 新建标签')] : []),
  );
  $('tag-filter').replaceChildren(
    option('', '全部标签'),
    ...tags.map((tag) => option(tag, tag, tag === state.tag)),
  );
  $('result-count').textContent = `${results.items.length}${results.hasMore ? '+' : ''} 条记录`;
  $('load-more').hidden = !results.hasMore;
  $('project-actions').replaceChildren();
  if (p) {
    $('project-actions').append(
      button(
        '关系图',
        act(() => openProjectGraph(p.id)),
        'button small',
      ),
      button(
        '新建子项目',
        act(() => openProject(null, p.id)),
        'button small',
      ),
      button(
        '编辑项目',
        act(() => openProject(p.id)),
        'button small',
      ),
    );
  }
  $('new').hidden = state.view === 'duplicates' || state.view === 'trash';
  renderNotices();
  renderSelection();
  renderCards();
  renderExamples(examplesVisible);
  await consumeCapture();
}
function renderExamples(visible) {
  const container = $('builtin-examples');
  $('examples-shortcut').textContent = examples.length
    ? `查看 ${examples.length} 条内置示例`
    : '查看内置示例';
  container.hidden =
    !visible ||
    state.view !== 'inbox' ||
    !!(state.query || state.type || state.tag || state.project);
  container.replaceChildren();
  if (container.hidden) return;
  if (examplesError) {
    container.append(
      el('p', { class: 'muted' }, examplesError),
      button(
        '重试加载示例',
        act(async () => {
          examples = await loadExamples();
          examplesError = '';
          await refresh();
        }),
      ),
    );
    return;
  }
  if (!examples.length) {
    container.hidden = true;
    return;
  }
  const details = el('details', { open: state.examplesExpanded ?? true });
  details.append(
    el(
      'summary',
      {
        onclick: () => {
          state.examplesExpanded = !details.open;
          persistView();
        },
      },
      `内置示例 · ${examples.length} 条`,
    ),
  );
  const grid = el('div', { class: 'example-grid' });
  for (const example of examples)
    grid.append(
      el(
        'article',
        { class: 'example-card' },
        el('span', { class: 'example-badge' }, '内置示例 · 只读预览'),
        el('h3', {}, example.title),
        el('p', { class: 'description' }, example.description),
        el(
          'button',
          {
            type: 'button',
            class: 'button small',
            'aria-label': `查看示例：${example.title}`,
            onclick: act(() => openExample(example)),
          },
          '打开示例',
        ),
      ),
    );
  details.append(
    el(
      'p',
      { class: 'description' },
      '示例随扩展离线提供，预览不参与同步。点击保存后成为你的普通记录，并使用当前同步设置。',
    ),
    grid,
    el(
      'div',
      { class: 'example-actions' },
      el(
        'button',
        {
          type: 'button',
          class: 'button primary',
          disabled: state.examplesSaving,
          onclick: act(async () => {
            if (state.examplesSaving) return;
            state.examplesSaving = true;
            renderExamples(true);
            try {
              const result = await saveExamples(db, examples);
              state.examplesExpanded = false;
              await refresh();
              $('records').scrollIntoView({ block: 'start' });
              toast(
                `已加入 ${result.saved} 条示例到收件箱；${result.existing} 条已保存过，保留原有内容。`,
              );
            } finally {
              state.examplesSaving = false;
              refreshSoon();
            }
          }),
        },
        state.examplesSaving ? '正在加入…' : '全部加入我的收件箱',
      ),
      el('small', { class: 'muted' }, '加入后可编辑，并按当前设置同步；已保存过的示例会跳过。'),
    ),
    button(
      '隐藏内置示例',
      act(async () => {
        await db.setState(EXAMPLES_VISIBLE, false);
        toast('已隐藏内置示例，可在设置与数据管理中恢复。');
      }),
      'link-button',
    ),
  );
  container.append(details);
}
async function showExamples() {
  await db.setState(EXAMPLES_VISIBLE, true);
  state.query = '';
  state.type = '';
  state.tag = '';
  state.project = '';
  state.view = 'inbox';
  state.selected.clear();
  state.examplesExpanded = true;
  persistView();
  $('search').value = '';
  await refresh();
  $('builtin-examples').scrollIntoView({ block: 'start' });
}
async function openExample(example) {
  const record = example.record;
  let preview;
  const { dialog, body, footer } = modal('内置示例：' + example.title, {
    wide: true,
    onClose: () => {
      preview?.querySelectorAll('.asset-view').forEach((view) => view.dispose?.());
    },
  });
  preview = el(
    'div',
    { class: 'example-preview' },
    el('h3', {}, record.title),
    el('p', { class: 'description' }, example.description),
  );
  const media = {
    attachments: record.attachments,
    local: loadExampleAsset,
    load: loadExampleAsset,
  };
  if (record.content) preview.append(markdownPreview(record.content, media));
  for (const descriptor of record.attachments)
    if (!record.content.includes(descriptor.path))
      preview.append(
        assetView(descriptor, {
          local: () => loadExampleAsset(descriptor),
          load: loadExampleAsset,
        }),
      );
  for (const source of record.sources)
    preview.append(
      el(
        'p',
        {},
        el('span', { class: 'muted' }, '来源：'),
        el(
          'a',
          { href: safeUrl(source.url), target: '_blank', rel: 'noopener noreferrer' },
          source.title || source.url,
        ),
      ),
    );
  body.append(preview);
  const save = button(
    '保存到我的收件箱',
    async () => {
      save.disabled = true;
      try {
        const result = await saveExample(db, example);
        if (result.status === 'already-saved') {
          toast('此示例已保存过；已有的修改和删除状态保持不变。');
          save.textContent = '已保存过此示例';
        } else {
          state.examplesExpanded = false;
          dialog.close();
          toast('示例已保存到你的收件箱，可编辑并按当前设置同步。');
        }
      } catch (error) {
        toast(error.message, true);
        save.disabled = false;
      }
    },
    'button primary',
  );
  footer.append(
    el('small', { class: 'muted' }, '保存前为只读预览；图片和测试录音来自已验证的演示数据。'),
    button('关闭', () => dialog.close()),
  );
}
function renderNotices() {
  const nodes = [];
  if (state.notice?.error)
    nodes.push(
      el(
        'div',
        { class: 'notice' },
        state.notice.text,
        el(
          'div',
          { class: 'row' },
          button(
            '知道了',
            act(() => db.setState('notice', null)),
            'button small',
          ),
        ),
      ),
    );
  if (state.captures.length)
    nodes.push(
      el(
        'div',
        { class: 'notice' },
        el('h3', {}, `${state.captures.length} 条收集等待处理`),
        '发现重复或相关内容，原文已保留在本机。',
        el(
          'div',
          { class: 'row' },
          button(
            '查看重复提示',
            act(() => openDuplicates()),
            'button small',
          ),
        ),
      ),
    );
  if (state.conflicts.length)
    nodes.push(
      el(
        'div',
        { class: 'notice' },
        el('h3', {}, `${state.conflicts.length} 条同步冲突`),
        '双方版本都已保留。处理后再次立即同步。',
        el(
          'div',
          { class: 'row' },
          button(
            '处理冲突',
            act(() => openConflict()),
            'button small',
          ),
        ),
      ),
    );
  $('notices').replaceChildren(...nodes);
}
function recordDropTarget(node, onDrop) {
  const accepts = (event) => [...event.dataTransfer.types].includes(RECORD_DRAG_TYPE);
  node.addEventListener('dragover', (event) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    node.classList.add('drag-over');
  });
  node.addEventListener('dragleave', (event) => {
    if (!node.contains(event.relatedTarget)) node.classList.remove('drag-over');
  });
  node.addEventListener('drop', (event) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    node.classList.remove('drag-over');
    const data = event.dataTransfer.getData(RECORD_DRAG_TYPE);
    act(async () => {
      const value = JSON.parse(data);
      if (
        !Array.isArray(value.ids) ||
        !value.ids.length ||
        value.ids.some((id) => typeof id !== 'string')
      )
        throw new Error('没有识别到可移动的记录。');
      await onDrop({
        ids: [...new Set(value.ids)],
        sourceTag: typeof value.sourceTag === 'string' ? value.sourceTag : '',
      });
    })();
  });
}
async function addTagGroup(value) {
  const name = value.trim();
  if (!name || name.length > 100 || /[,，\n]/.test(name))
    throw new Error('请填写 1–100 字的标签名称，不含逗号或换行。');
  await navigator.locks.request('pkm-nexus:tag-groups', async () => {
    const groups = await db.getState(TAG_GROUPS, []);
    if (!groups.includes(name)) await db.setState(TAG_GROUPS, [...groups, name]);
  });
  return name;
}
function openTagGroup() {
  const { dialog, body, footer } = modal('新建标签');
  const input = textInput('', { maxlength: 100, placeholder: '例如：工作、学习、待读' });
  body.append(field('标签名称', input, '已有标签也会自动显示在标签列表中。'));
  const create = act(async () => {
    const tag = await addTagGroup(input.value);
    dialog.close();
    setView('all');
    state.tag = tag;
    persistView();
    toast(`已新建标签“${tag}”，可拖入记录。`);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      create();
    }
  });
  footer.append(
    button('取消', () => dialog.close()),
    button('新建标签', create, 'button primary'),
  );
  input.focus();
}
async function setOrganization(ids, organization) {
  for (const id of ids)
    await db.mutate(id, (record) => {
      if (
        record.deleted_at ||
        record.kind === 'tombstone' ||
        ['project', 'list'].includes(record.type)
      )
        throw new Error('这条记录不能移动，请重新选择。');
      return { ...record, organization_state: organization, updated_at: new Date().toISOString() };
    });
  state.selected.clear();
  refreshSoon();
  toast(organization === 'organized' ? '已标记为已整理。' : '已移回收件箱。');
}
async function moveToTagGroup(ids, tag) {
  for (const id of ids)
    await db.mutate(id, (record) => {
      if (record.deleted_at || record.kind === 'tombstone' || record.type === 'project')
        throw new Error('这条记录不能移动，请重新选择。');
      return {
        ...record,
        tags: [...new Set([...record.tags, tag])],
        organization_state: 'organized',
        updated_at: new Date().toISOString(),
      };
    });
  state.selected.clear();
  refreshSoon();
  toast(`已移动到“${tag}”并标记已整理。`);
}
function openMove(ids) {
  const sourceTag = state.tag;
  const { dialog, body, footer } = modal('移动记录');
  const target = el(
    'select',
    { 'aria-label': '移动目标' },
    option('inbox', '收件箱'),
    option('organized', '已整理'),
    ...state.tagGroups.map((tag) => option(`tag:${tag}`, `标签 · ${tag}`)),
    option('new', '＋ 新建标签…'),
  );
  target.value = state.tagGroups.length ? `tag:${state.tagGroups[0]}` : 'organized';
  const name = textInput('', {
    maxlength: 100,
    placeholder: '新标签名称',
    'aria-label': '新标签名称',
  });
  const nameField = field('新标签名称', name);
  nameField.hidden = true;
  target.addEventListener('change', () => {
    nameField.hidden = target.value !== 'new';
    if (!nameField.hidden) name.focus();
  });
  body.append(
    field(`移动 ${ids.length} 条记录到`, target),
    nameField,
    el('p', { class: 'description' }, '添加标签并标记已整理，保留已有标签。标签之间没有父子层级。'),
  );
  footer.append(
    button('取消', () => dialog.close()),
    button(
      '移动',
      act(async () => {
        if (target.value === 'new')
          await moveToTagGroup(ids, await addTagGroup(name.value), sourceTag);
        else if (target.value.startsWith('tag:'))
          await moveToTagGroup(ids, target.value.slice(4), sourceTag);
        else await setOrganization(ids, target.value);
        dialog.close();
      }),
      'button primary',
    ),
  );
}
async function addToProjects(ids, projectIds) {
  for (const id of ids) await setProjectMemberships(db, id, projectIds, { add: true });
  state.selected.clear();
  refreshSoon();
  toast('已加入项目，保留原有标签和整理状态。');
}
async function openProjectAssignment(ids) {
  const projects = (await db.allCatalog()).filter(
    (record) => record.type === 'project' && !record.deleted_at,
  );
  const { dialog, body, footer } = modal('加入项目');
  const choices = projectTree(projects).map((project) => ({
    id: project.id,
    ...check(project.breadcrumb),
  }));
  body.append(
    el(
      'p',
      { class: 'description' },
      '可加入多个项目，保留已有项目关联、标签与整理状态。加入子项目不会自动加入父项目。',
    ),
    ...choices.map((choice) => choice.label),
    ...(!choices.length ? [el('p', { class: 'muted' }, '还没有项目，请先新建。')] : []),
  );
  footer.append(
    button(
      '新建项目',
      act(() => openProject()),
    ),
    button('取消', () => dialog.close()),
    button(
      '加入项目',
      act(async () => {
        const selected = choices
          .filter((choice) => choice.input.checked)
          .map((choice) => choice.id);
        if (!selected.length) throw new Error('请选择至少一个项目。');
        await addToProjects(ids, selected);
        dialog.close();
      }),
      'button primary',
    ),
  );
}
async function togglePin(id) {
  await navigator.locks.request('pkm-nexus:pinned-records', async () => {
    const pins = await db.getState(PINNED_RECORDS, []);
    await db.setState(
      PINNED_RECORDS,
      pins.includes(id) ? pins.filter((pin) => pin !== id) : [id, ...pins],
    );
  });
}
function renderSelection() {
  const ids = [...state.selected];
  $('selection-bar').hidden = !ids.length;
  const selectable = state.items.filter((m) => m.type !== 'list');
  $('select-all').checked =
    !!selectable.length && selectable.every((m) => state.selected.has(m.id));
  $('selection-bar').replaceChildren(
    el('span', {}, `已选 ${ids.length} 条`),
    ...(state.view === 'trash'
      ? [
          button(
            '批量还原',
            act(async () => {
              for (const id of ids) await db.restore(id);
              state.selected.clear();
              refreshSoon();
              toast('已还原到本机，等待同步。');
            }),
            'button small',
          ),
        ]
      : [
          button(
            '标记已整理',
            act(async () => {
              for (const id of ids)
                await db.mutate(id, (r) => ({
                  ...r,
                  organization_state: 'organized',
                  updated_at: new Date().toISOString(),
                }));
              state.selected.clear();
              refreshSoon();
              toast('已整理，等待同步。');
            }),
            'button small',
          ),
          button('添加标签', () => bulkTags(ids), 'button small'),
          button('移动到…', () => openMove(ids), 'button small'),
          button(
            '加入项目…',
            act(() => openProjectAssignment(ids)),
            'button small',
          ),
          button(
            '移回收件箱',
            act(() => setOrganization(ids, 'inbox')),
            'button small',
          ),
          ids.length === 2
            ? button(
                '合并两条',
                act(() => openMerge(ids[0], ids[1])),
                'button small',
              )
            : null,
          button(
            '移入回收站',
            () =>
              confirmAction(
                '将所选记录移入回收站？',
                '记录可以还原，下一次同步时才传播删除状态。',
                async () => {
                  for (const id of ids) await db.trash(id);
                  state.selected.clear();
                  refreshSoon();
                },
              ),
            'button small danger',
          ),
        ]),
    button(
      '取消选择',
      () => {
        state.selected.clear();
        renderSelection();
        renderCards();
      },
      'link-button',
    ),
  );
}
function renderCards() {
  $('records')
    .querySelectorAll('.asset-view')
    .forEach((node) => node.dispose?.());
  if (!state.items.length) {
    $('records').replaceChildren(
      el(
        'div',
        { class: 'empty' },
        el('div', { class: 'empty-symbol' }, state.view === 'trash' ? icon('trash') : '▣'),
        el(
          'h2',
          {},
          state.query || state.tag || state.project
            ? '没有匹配的记录'
            : state.view === 'inbox'
              ? '给下一次灵感留个位置'
              : '这里还没有记录',
        ),
        el(
          'p',
          {},
          panel
            ? '选择网页文字，右键或按 Alt + Shift + S。\n也可以在上方直接写一条。'
            : state.view === 'inbox'
              ? '选择网页文字，右键保存，或按 Alt + Shift + S。\n每一条新收集都会先来到这里。'
              : '试试其他筛选条件，或新建一条记录。',
        ),
        !panel && !['trash', 'duplicates'].includes(state.view)
          ? button(
              '＋ 新建记录',
              act(() => openEditor()),
              'button primary',
            )
          : null,
      ),
    );
    return;
  }
  $('records').replaceChildren(
    ...state.items.map((m) => {
      if (m.kind === 'tombstone')
        return el(
          'article',
          { class: 'record', 'data-record-id': m.id },
          el(
            'div',
            { class: 'record-main' },
            el('h2', {}, '删除标记'),
            el('p', {}, `记录 ${m.id} 的正文已移除，等待同步删除状态。`),
          ),
        );
      const selected = el('input', {
        type: 'checkbox',
        disabled: m.type === 'list',
        checked: state.selected.has(m.id),
        'aria-label': `选择 ${m.type === 'list' ? 'Todo / Idea' : m.title || '未命名记录'}`,
      });
      selected.addEventListener('change', () => {
        if (selected.checked) state.selected.add(m.id);
        else state.selected.delete(m.id);
        renderSelection();
      });
      const edit = act(() => (m.type === 'project' ? openProject(m.id) : openRecord(m.id)));
      const main = el(
        'div',
        {
          class: 'record-main',
          tabindex: '0',
          role: 'button',
          'aria-label': `打开 ${m.type === 'list' ? 'Todo / Idea' : m.title || '未命名记录'}`,
          onclick: edit,
          onkeydown: (event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
              event.preventDefault();
              edit();
            }
          },
        },
        el(
          'div',
          { class: 'record-top' },
          el('h2', {}, m.type === 'list' ? 'Todo / Idea' : m.title || '未命名记录'),
          el('span', { class: 'badge' }, displayType(m.type)),
          !m.deleted_at && (m.type === 'list' || state.pinnedIds.includes(m.id))
            ? el('span', { class: 'badge pinned-badge' }, m.type === 'list' ? '固定置顶' : '已置顶')
            : null,
          m.organization_state === 'organized' ? el('span', { class: 'badge' }, '已整理') : null,
          m.dirty ? el('span', { class: 'badge pending' }, '待同步') : null,
          m.task_status ? el('span', { class: 'badge' }, TASK_STATUSES[m.task_status]) : null,
          ...((m.attachments || []).some((a) => a.kind !== 'snapshot')
            ? [
                el(
                  'span',
                  { class: 'badge' },
                  `${m.attachments.filter((a) => a.kind === 'image').length} 图片 · ${m.attachments.filter((a) => a.kind === 'audio').length} 音频`,
                ),
              ]
            : []),
        ),
        m.summary || !['list', 'snapshot', 'website_group'].includes(m.type)
          ? el(
              'p',
              { class: 'record-summary' },
              m.summary || (m.type === 'project' ? '项目文件夹' : '尚未补充正文'),
            )
          : null,
        el(
          'div',
          { class: 'record-meta' },
          el('span', {}, dateLabel(m.created_at)),
          ...m.tags.slice(0, 8).map((t) => tagBadge(t, state.tagStyles)),
          ...m.project_ids
            .map((id) => state.projects.find((p) => p.id === id))
            .filter(Boolean)
            .slice(0, 3)
            .map((p) => el('span', { class: 'badge' }, `◌ ${p.title}`)),
          m.sources[0]?.url
            ? el(
                'a',
                {
                  href: safeUrl(m.sources[0].url),
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  onclick: (event) => event.stopPropagation(),
                },
                new URL(m.sources[0].url).hostname,
              )
            : null,
        ),
      );
      main.append(
        typedCard(m, {
          db,
          toggleRemoved: act((id, removed) => toggleWebsiteRemoved(m.id, id, removed)),
          listMode: state.cardModes[m.id] !== false,
          onListMode: (mode) => {
            state.cardModes[m.id] = mode;
            persistView();
          },
          toggleList: act(async (id, checked) =>
            db.mutate(m.id, (r) => ({
              ...r,
              list: r.list.map((item) => (item.id === id ? { ...item, checked } : item)),
              content: listDocument(
                r.list.map((item) => (item.id === id ? { ...item, checked } : item)),
                r.content,
                r.list,
              ),
              updated_at: new Date().toISOString(),
            })),
          ),
          toggleRead: act(async (id, read) =>
            db.mutate(m.id, (r) => ({
              ...r,
              url_list: r.url_list.map((item) =>
                item.id === id
                  ? { ...item, read_at: read ? new Date().toISOString() : null }
                  : item,
              ),
              updated_at: new Date().toISOString(),
            })),
          ),
        }),
      );
      const actions =
        m.type === 'list' && !m.deleted_at
          ? []
          : m.deleted_at
            ? [
                button(
                  '还原',
                  act(async () => {
                    await db.restore(m.id);
                    toast('已还原到本机。');
                  }),
                  'button small',
                ),
                button(
                  '移除正文',
                  () =>
                    confirmAction(
                      '移除当前正文？',
                      '此操作不能从回收站还原。保留最小删除标记防止旧电脑复活；其他设备和已有备份仍可能保留内容。',
                      async () => {
                        await db.purge(m.id);
                        toast('当前正文已移除，等待同步。');
                      },
                    ),
                  'button small danger',
                ),
              ]
            : [
                button(
                  m.favorite ? '★ 已喜爱' : '☆ 喜爱',
                  act(() => toggleFavorite(m.id)),
                  'button small',
                ),
                button(
                  state.pinnedIds.includes(m.id) ? '取消置顶' : '置顶',
                  act(() => togglePin(m.id)),
                  'button small',
                ),
                button(
                  m.organization_state === 'organized' ? '移回收件箱' : '标记已整理',
                  act(() =>
                    setOrganization(
                      [m.id],
                      m.organization_state === 'organized' ? 'inbox' : 'organized',
                    ),
                  ),
                  'button small',
                ),
                button('移动到…', () => openMove([m.id]), 'button small'),
                button(
                  '加入项目…',
                  act(() => openProjectAssignment([m.id])),
                  'button small',
                ),
                button(
                  '管理项目…',
                  act(() => openProjectMemberships(m.id)),
                  'button small',
                ),
                state.view === 'duplicates'
                  ? button(
                      '合并…',
                      act(() => openMerge(m.id)),
                      'button small',
                    )
                  : null,
                button(
                  '⌫',
                  act(async () => {
                    await db.trash(m.id);
                    toast('已移入回收站，可还原。');
                  }),
                  'icon-button',
                ),
              ];
      const card = el(
        'article',
        {
          class: `record record-${m.type}`,
          'data-record-id': m.id,
          draggable: !m.deleted_at && m.type !== 'list',
        },
        el('div', { class: 'selection' }, selected),
        main,
        el('div', { class: 'record-actions' }, ...actions),
      );
      card.addEventListener('dragover', (event) => {
        if ([...event.dataTransfer.types].includes('application/x-pkm-tag')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          card.classList.add('drag-over');
        }
      });
      card.addEventListener('drop', (event) => {
        const tag = event.dataTransfer.getData('application/x-pkm-tag');
        if (!tag) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        card.classList.remove('drag-over');
        act(() => moveToTagGroup([m.id], tag))();
      });
      card.addEventListener('dragstart', (event) => {
        if (
          event.target.closest('a, input, button, textarea, select') ||
          m.deleted_at ||
          m.type === 'list'
        ) {
          event.preventDefault();
          return;
        }
        const ids = state.selected.has(m.id) ? [...state.selected] : [m.id];
        event.dataTransfer.setData(RECORD_DRAG_TYPE, JSON.stringify({ ids, sourceTag: state.tag }));
        event.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document
          .querySelectorAll('.drag-over')
          .forEach((node) => node.classList.remove('drag-over'));
      });
      if (m.type === 'website_group' && !m.deleted_at) {
        card.addEventListener('dragover', (e) => {
          if (
            [...e.dataTransfer.types].some((t) =>
              [RECORD_DRAG_TYPE, 'application/x-pkm-tag'].includes(t),
            )
          )
            return;
          e.preventDefault();
          card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', (e) => {
          if ([...e.dataTransfer.types].includes(RECORD_DRAG_TYPE)) return;
          e.preventDefault();
          e.stopPropagation();
          card.classList.remove('drag-over');
          const data = Object.fromEntries(
            ['application/x-pkm-tab', 'text/uri-list', 'text/plain', 'text/html'].map((key) => [
              key,
              e.dataTransfer.getData(key),
            ]),
          );
          toast('正在读取网页标题…');
          act(async () => {
            const dropped = await droppedWebsites({ getData: (key) => data[key] || '' });
            if (!dropped.items.length) return;
            const saved = await appendWebsites(db, m.id, dropped.items);
            const close = document.querySelector('[name=close_tabs]');
            const result =
              !close || close.checked
                ? await closeCapturedTabs(dropped.tabs, saved.record)
                : { closed: [] };
            toast(`已加入网页组并关闭 ${result.closed.length} 个标签页。`);
          })();
        });
      }
      return card;
    }),
  );
}

function confirmAction(title, message, fn) {
  const { dialog, body, footer } = modal(title);
  body.append(el('p', { class: 'description' }, message));
  const submit = button(
    '确认',
    act(async () => {
      submit.disabled = true;
      try {
        await fn();
        dialog.close();
      } finally {
        submit.disabled = false;
      }
    }),
    'button danger',
  );
  footer.append(
    button('取消', () => dialog.close()),
    submit,
  );
}
function bulkTags(ids) {
  const { dialog, body, footer } = modal('批量添加标签');
  const input = textInput('', { placeholder: '用逗号分隔，如：学习, 待阅读' });
  body.append(field(`添加到 ${ids.length} 条记录`, input, '保留每条记录已有的标签。'));
  footer.append(
    button('取消', () => dialog.close()),
    button(
      '添加标签',
      act(async () => {
        const tags = splitTags(input.value);
        if (!tags.length) throw new Error('请填写标签。');
        for (const id of ids)
          await db.mutate(id, (r) => ({
            ...r,
            tags: [...new Set([...r.tags, ...tags])],
            updated_at: new Date().toISOString(),
          }));
        dialog.close();
        state.selected.clear();
        refreshSoon();
      }),
      'button primary',
    ),
  );
}

async function editorData(id, explicitDraft, savedKey) {
  const row = id ? await db.get(id) : null;
  if (id && (!row || row.record.kind === 'tombstone')) throw new Error('记录不存在。');
  const key = savedKey || (row ? `draft:editor:${id}` : panel ? 'draft:panel' : 'draft:editor:new');
  const persisted = await db.getState(key),
    cached = cachedDraft(key);
  const recovered = cached && (!persisted || (cached.savedAt || 0) >= (persisted.savedAt || 0));
  const stored = explicitDraft?.value || (recovered ? cached : persisted);
  if (stored?.record && (explicitDraft || stored.expectedRev === (row?.rev || 0)))
    return {
      row,
      record: upgradeRecord(stored.record),
      draftKey: explicitDraft?.key || key,
      rawUrls: stored.rawUrls,
      draftUi: stored.ui,
      capturedTabs: stored.pendingTabs,
      recovered: !explicitDraft && recovered,
    };
  if (stored?.record) {
    await db.setState(`${key}:archive-${crypto.randomUUID()}`, stored);
    await clearDraft(db, key);
  }
  if (!row && stored?.content !== undefined)
    return {
      record: newRecord({
        type: 'note',
        title: stored.title,
        content: stored.content,
        attachments: stored.attachments || [],
      }),
      draftKey: key,
      rawUrls: stored.url,
    };
  return {
    row,
    record: row ? upgradeRecord(row.record) : newRecord(),
    draftKey: key,
    draftUi: stored?.ui,
  };
}
async function saveEditorRecord(value, row) {
  if (row?.rev) {
    await db.save(value, { expectedRev: row.rev });
    return { status: 'saved' };
  }
  if (value.type === 'list') {
    await db.save(value, { expectedRev: 0 });
    return { status: 'saved' };
  }
  return captureInto(db, value);
}
async function openRecord(id) {
  const row = await db.get(id);
  if (!row || row.record.kind === 'tombstone') throw new Error('记录已不存在。');
  let preview;
  const { dialog, body, footer } = modal('预览记录', {
    wide: true,
    onClose: () => preview?.dispose?.(),
  });
  preview = await recordPreview(db, row.record, { onChanged: refreshSoon });
  body.append(preview);
  footer.append(
    button(
      row.record.favorite ? '★ 已喜爱' : '☆ 喜爱',
      act(async () => {
        await toggleFavorite(id);
        dialog.close();
        await openRecord(id);
      }),
    ),
    ...(row.record.deleted_at
      ? []
      : [
          ...(row.record.type === 'note'
            ? [
                button(
                  '简单修改 · Markdown',
                  act(() => openEditor(id, { simple: true })),
                ),
              ]
            : []),
          button(
            row.record.type === 'note' ? '完整修改' : '修改记录',
            act(() => openEditor(id)),
          ),
        ]),
    button('关闭', () => dialog.close()),
  );
}
async function toggleFavorite(id) {
  await db.mutate(id, (record) => ({
    ...upgradeRecord(record),
    schema_version: 5,
    favorite: !record.favorite,
    updated_at: new Date().toISOString(),
  }));
  refreshSoon();
}
async function toggleWebsiteRemoved(id, itemId, removed) {
  await db.mutate(id, (record) => ({
    ...record,
    schema_version: 5,
    url_list: record.url_list.map((item) =>
      item.id === itemId
        ? { ...item, removed_at: removed ? new Date().toISOString() : null }
        : item,
    ),
    updated_at: new Date().toISOString(),
  }));
}
async function openTagStyle(tag = state.tagGroups?.[0]) {
  if (!tag) throw new Error('请先新建标签。');
  const styles = await db.getState('ui:tag-styles', {});
  const { dialog, body, footer } = modal('标签外观');
  const selected = el('div', {
    class: 'tag-cloud tag-choices',
    role: 'group',
    'aria-label': '选择标签',
  });
  const name = textInput(tag, { maxlength: 100, 'aria-label': '标签名称' });
  const color = colorControl(styles[tag]?.color || '#285f49', '标签颜色');
  for (const value of state.tagGroups) {
    const choice = button(
      value,
      () => {
        tag = value;
        name.value = value;
        color.value = styles[value]?.color || '#285f49';
        for (const node of selected.children)
          node.setAttribute('aria-pressed', String(node.dataset.tag === tag));
      },
      'tag-chip',
    );
    choice.dataset.tag = value;
    choice.setAttribute('aria-pressed', String(value === tag));
    if (styles[value]?.color) choice.style.setProperty('--tag-color', styles[value].color);
    selected.append(choice);
  }
  body.append(selected, field('标签名称', name), field('颜色', color.root));
  footer.append(
    button('取消', () => dialog.close()),
    button(
      '保存外观',
      act(async () => {
        await db.renameTag(tag, name.value, color.value);
        if (state.tag === tag) state.tag = name.value.trim();
        dialog.close();
        refreshSoon();
      }),
      'button primary',
    ),
  );
}
async function openEditor(id, { value, key, simple = false, parentDialog = null, onReturn } = {}) {
  if (panel && !parentDialog) {
    activeDialog?.close();
    await panelEditor.load(id, { value, key });
    return;
  }
  const data = await editorData(id, value ? { value, key } : null);
  let editor;
  const { dialog, body, footer } = modal(data.row?.rev ? '编辑记录' : '新建记录', {
    parent: parentDialog,
    onClose: async () => {
      const pending = editor?.flush();
      editor?.destroy();
      await pending;
      await onReturn?.();
    },
  });
  async function navigate(type, captured) {
    if (type === 'capture' && captured.type === 'note' && editor.type === 'note')
      return editor.collect(captured);
    await editor.flush();
    dialog.close();
    if (type === 'capture')
      return openEditor(null, {
        parentDialog,
        onReturn,
        value: {
          record: captured,
          expectedRev: 0,
          rawUrls: captured.sources.map((s) => s.url).join('\n'),
        },
        key: `draft:editor:new:captured-${captured.id}`,
      });
    if (type === 'list') return openList();
    return openEditor(null, {
      parentDialog,
      onReturn,
      value: { record: newRecord({ type }), expectedRev: 0, rawUrls: '' },
    });
  }
  editor = createEditor(db, {
    ...data,
    draftUi: { ...data.draftUi, previewing: false },
    simple,
    panel: false,
    onSave: saveEditorRecord,
    onNavigate: act(navigate),
    onCancel: async (result) => {
      if (result?.saved) toast('已保存到本机，等待同步。');
      dialog.close();
      refreshSoon();
    },
  });
  body.append(editor.root);
  footer.append(
    el(
      'span',
      { class: 'hint' },
      data.row ? `原 ID ${data.row.id.slice(0, 8)}` : '保存后才进入收件箱',
    ),
  );
  editor.root.querySelector(simple ? '[name=content]' : '[name=title]').focus();
}
async function openList() {
  const row = await singletonList(db);
  if (row.rev) return openEditor(row.id);
  return openEditor(null, { value: { record: row.record, expectedRev: 0, rawUrls: '' } });
}
async function setupPanel() {
  if (!panel) return;
  let editor;
  async function mount(data, persistInitial = false) {
    if (editor?.recording) throw new Error('请先停止当前录音。');
    await editor?.flush();
    editor?.destroy();
    editor = createEditor(db, {
      ...data,
      panel: true,
      onSave: saveEditorRecord,
      onNavigate: act(async (type, captured) => {
        if (type === 'capture' && captured.type === 'note' && editor.type === 'note')
          return editor.collect(captured);
        if (type === 'capture')
          return mount(
            {
              record: captured,
              draftKey: `draft:editor:new:captured-${captured.id}`,
              rawUrls: captured.sources.map((s) => s.url).join('\n'),
            },
            true,
          );
        if (type === 'list') {
          const row = await singletonList(db);
          return mount(
            row.rev
              ? await editorData(row.id)
              : { record: row.record, draftKey: `draft:editor:${LIST_ID}` },
            true,
          );
        }
        return mount({ record: newRecord({ type }), draftKey: 'draft:panel', rawUrls: '' }, true);
      }),
      onCancel: async (result) => {
        if (result?.saved)
          toast(result.message?.includes('关闭') ? result.message : '已保存到本机，等待同步。');
        const type = editor.type,
          draftUi = editor.preferences;
        editor.destroy();
        editor = null;
        if (type === 'list') {
          const row = await singletonList(db);
          await mount(
            { row, record: row.record, draftKey: `draft:editor:${LIST_ID}`, draftUi },
            true,
          );
        } else {
          await clearDraft(db, 'draft:panel');
          await mount({ record: newRecord({ type }), draftKey: 'draft:panel', draftUi }, true);
        }
        refreshSoon();
      },
    });
    $('capture-box').replaceChildren(editor.root);
    await chrome.storage.session.set({
      [`${viewStorageKey}:editor`]: {
        id: data.row?.id || null,
        key: data.draftKey || 'draft:panel',
      },
    });
    if (persistInitial || data.recovered) await editor.flush({ force: true });
  }
  panelEditor = {
    get recording() {
      return editor?.recording;
    },
    flush: () => editor?.flush(),
    collect: async (record, nonce) => {
      if (editor?.type !== 'note') {
        if (editor?.recording) return false;
        await mount(await editorData(null, null, 'draft:panel:collected'));
      }
      return editor.collect(record, nonce);
    },
    load: async (id, explicit) => {
      const data = await editorData(id, explicit?.value ? explicit : null);
      await mount(data, true);
      $('capture-box').scrollIntoView({ behavior: 'smooth' });
    },
  };
  const activeKey = `${viewStorageKey}:editor`;
  const active = (await chrome.storage.session.get(activeKey))[activeKey];
  const activeRow = active?.id ? await db.get(active.id) : null;
  await mount(
    await editorData(
      activeRow && !activeRow.record.deleted_at && activeRow.record.kind !== 'tombstone'
        ? active.id
        : null,
      null,
      active?.id &&
        (!activeRow || activeRow.record.deleted_at || activeRow.record.kind === 'tombstone')
        ? undefined
        : active?.key,
    ),
  );
  window.addEventListener('pagehide', () => {
    editor?.flush().catch(() => {});
    editor?.destroy();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') editor?.flush().catch(() => {});
  });
}
async function consumeCapture() {
  if (!panel || !panelEditor) return;
  await navigator.locks.request(COLLECTION_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      refreshSoon(150);
      return;
    }
    const pending = await db.getState(COLLECTION_QUEUE);
    let queue = Array.isArray(pending) ? pending : pending ? [pending] : [];
    for (const item of [...queue]) {
      if (item.windowId !== undefined && item.windowId !== currentWindowId) continue;
      const incoming = item.record || (await db.getState(item.key))?.record;
      if (!incoming) continue;
      if (incoming.type !== 'note') {
        if (panelEditor.recording) continue;
        await panelEditor.load(null, {
          value: { record: incoming, expectedRev: 0 },
          key: item.key,
        });
      } else if (!(await panelEditor.collect(incoming, item.nonce))) break;
      queue = queue.filter((queued) => queued !== item);
      await db.setState(COLLECTION_QUEUE, queue.length ? queue : null);
      if (incoming.type === 'note') await clearDraft(db, item.key);
      toast(
        incoming.sources.some((s) => s.kind === 'web_image') && !incoming.attachments.length
          ? '已追加到 collected；图片已嵌入在线地址，离线查看需先保存原图。'
          : '已追加到 collected，确认后再保存。',
      );
    }
  });
}

async function openDuplicates(captureId) {
  const captures = await db.captures(),
    capture = captures.find((c) => c.id === captureId) || captures[0];
  if (!capture) return;
  const matches = await db.duplicates(capture.record);
  const { dialog, body, footer } = modal('重复与相关内容');
  body.append(
    el('h3', {}, capture.record.title || '待处理收集'),
    el(
      'p',
      { class: 'description' },
      capture.record.content.slice(0, 500) || capture.record.sources[0]?.url || '仅链接',
    ),
    el(
      'p',
      { class: 'description' },
      '你的这次收集已经留在本机。选择追加、另存或取消，系统不会自动合并。',
    ),
  );
  const choices = el('div', { class: 'records' });
  let selectedId = matches[0]?.id;
  const labels = { exact: '内容重复', related: '同页不同内容', similar: '不同来源、内容相同' };
  for (const match of matches) {
    const radio = el('input', {
      type: 'radio',
      name: 'duplicate-target',
      value: match.id,
      checked: match.id === selectedId,
    });
    radio.addEventListener('change', () => {
      selectedId = match.id;
    });
    choices.append(
      el(
        'label',
        { class: 'version' },
        el(
          'div',
          { class: 'row' },
          radio,
          el('strong', {}, match.title || '未命名记录'),
          el('span', { class: 'badge' }, labels[match.match]),
          match.deleted_at ? el('span', { class: 'badge pending' }, '在回收站') : null,
        ),
        el('p', { class: 'description' }, match.summary || '只有链接'),
        button(
          '查看已有记录',
          act(() => openEditor(match.id)),
          'link-button',
        ),
      ),
    );
  }
  if (!matches.length)
    choices.append(el('p', { class: 'description' }, '当前没有重复候选，可以另存为新记录。'));
  body.append(choices);
  const finish = async (fn) => {
    await fn();
    dialog.close();
    chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
    toast('这条收集已处理。');
  };
  footer.append(
    button(
      '取消这次收集',
      act(() => finish(() => db.dismissCapture(capture.id))),
      'button',
    ),
    matches.length
      ? button(
          matches.some((m) => m.deleted_at) ? '追加（必要时还原）' : '追加到所选记录',
          act(() => finish(() => appendCapture(db, selectedId, capture))),
          'button',
        )
      : null,
    button(
      '仍然另存一条',
      act(() => finish(() => db.finishCapture(capture.id, capture.record, 0))),
      'button primary',
    ),
  );
}
async function openMerge(sourceId, selectedTarget) {
  const source = await db.get(sourceId);
  if (!source) throw new Error('记录不存在。');
  const matches = selectedTarget
    ? [await db.get(selectedTarget)].filter(Boolean).map((row) => ({
        id: row.id,
        title: row.record.title,
        summary: row.record.summary || row.record.content.slice(0, 160),
      }))
    : await db.duplicates(source.record);
  if (!matches.length) throw new Error('没有可合并的候选。可在列表选择两条记录手动合并。');
  const { dialog, body, footer } = modal('合并已有记录');
  let target = await db.get(matches[0].id);
  body.append(
    el(
      'p',
      { class: 'description' },
      `将“${source.record.title || '未命名记录'}”合并到所选记录。合并正文、附件、标签、项目和来源；来源记录保留在回收站中，可恢复。目标保留自己的类型与待办状态。`,
    ),
  );
  const select = el(
      'select',
      {},
      ...matches.map((m) =>
        option(m.id, m.type === 'list' ? 'Todo / Idea' : m.title || '未命名记录'),
      ),
    ),
    targetPreview = el('pre', { class: 'preview-list' }),
    scopeHint = el('p', { class: 'description' });
  function showTarget() {
    targetPreview.textContent = target.record.content || '（没有正文）';
    scopeHint.textContent = target.record.deleted_at
      ? '目标在回收站：合并时会明确还原到正常记录。'
      : '合并先保存在本机，等待同步。';
  }
  select.addEventListener(
    'change',
    act(async () => {
      target = await db.get(select.value);
      if (!target) throw new Error('目标已不存在。');
      showTarget();
    }),
  );
  showTarget();
  body.append(
    field('合并到', select),
    el(
      'div',
      { class: 'conflict-columns' },
      el(
        'div',
        { class: 'version' },
        el('h4', {}, '来源记录正文'),
        el('pre', {}, source.record.content || '（没有正文）'),
      ),
      el('div', { class: 'version' }, el('h4', {}, '目标记录正文'), targetPreview),
    ),
    scopeHint,
  );
  footer.append(
    button('取消', () => dialog.close()),
    button(
      '合并并保留来源到回收站',
      act(async () => {
        await db.mergeRecords(source.id, target.id, source.rev, target.rev);
        dialog.close();
        state.selected.clear();
        toast('已合并到本机，来源记录保留在回收站。');
      }),
      'button primary',
    ),
  );
}

async function openProject(id, parentId = null, { parentDialog = null, onReturn } = {}) {
  const row = id ? await db.get(id) : null;
  if (id && !row) throw new Error('项目不存在。');
  const record = row
    ? upgradeProject(row.record)
    : newRecord({
        schema_version: 5,
        type: 'project',
        organization_state: 'organized',
        parent_project_id: parentId,
        graph: { edges: [] },
      });
  const projects = projectTree((await db.allCatalog()).filter(activeProject));
  const { dialog, body, footer } = modal(id ? '编辑项目' : '新建项目', {
    parent: parentDialog,
    onClose: onReturn,
  });
  const name = textInput(record.title, { maxlength: '500', placeholder: '例如：论文研究' });
  const description = textarea(record.summary || '', {
    rows: 4,
    maxlength: 2000,
    'aria-label': '项目描述',
    placeholder: '这个项目要完成什么？这些资料有什么用途？',
  });
  const color = colorControl(record.appearance?.color || '#285f49', '项目颜色');
  const symbol = iconChoices(record.appearance?.icon || '📁');
  const parent = el(
    'select',
    { 'aria-label': '父项目' },
    option('', '顶层项目', !record.parent_project_id),
    ...projects
      .filter((p) => p.id !== id)
      .map((p) => option(p.id, p.breadcrumb, p.id === record.parent_project_id)),
  );
  body.append(
    field('项目名称', name),
    field('项目描述', description),
    field('父项目', parent),
    field('颜色', color.root),
    field('图标', symbol.root),
    el(
      'p',
      { class: 'description' },
      '项目可包含子项目；每条记录可属于多个项目。关系图只连接当前层的记录与子项目节点。',
    ),
  );
  footer.append(
    id && !record.deleted_at
      ? button(
          '移入回收站',
          act(async () => {
            await db.trash(id);
            dialog.close();
          }),
          'button danger',
        )
      : null,
    button('取消', () => dialog.close()),
    button(
      '保存项目',
      act(async () => {
        if (!name.value.trim()) throw new Error('请填写项目名称。');
        await saveProject(
          db,
          {
            ...record,
            title: name.value.trim(),
            summary: description.value,
            appearance: { color: color.value, icon: symbol.value.trim() },
            parent_project_id: parent.value || null,
            updated_at: new Date().toISOString(),
          },
          row?.rev || 0,
        );
        dialog.close();
        toast('项目已保存。');
      }),
      'button primary',
    ),
  );
}
async function openProjectGraph(id) {
  const row = await db.get(id);
  if (!row || row.record.deleted_at) throw new Error('项目不存在。');
  let graph;
  const { dialog, body, footer } = modal('项目关系图 · ' + row.record.title, {
    onClose: () => graph?.dispose?.(),
  });
  dialog.classList.add('graph-dialog');
  graph = await projectGraph(db, id, {
    onChanged: refreshSoon,
    onEdit: async (record) => {
      const context = {
        parentDialog: dialog,
        onReturn: async () => {
          if (!dialog.open) return;
          await graph.refresh();
          if (activeDialog === dialog) graph.querySelector('.graph-preview-edit')?.focus();
        },
      };
      if (record.type === 'project') await openProject(record.id, null, context);
      else await openEditor(record.id, context);
    },
  });
  body.append(graph);
  const fullscreen = button('全屏', () => {
    dialog.classList.toggle('graph-fullscreen');
    fullscreen.textContent = dialog.classList.contains('graph-fullscreen') ? '退出全屏' : '全屏';
  });
  footer.append(
    fullscreen,
    button('关闭', () => dialog.close()),
  );
}
async function openProjectMemberships(id) {
  const row = await db.get(id);
  if (!row) throw new Error('记录不存在。');
  const projects = projectTree((await db.allCatalog()).filter(activeProject));
  const { dialog, body, footer } = modal('管理项目归属');
  const choices = projects.map((p) => ({
    id: p.id,
    ...check(p.breadcrumb, row.record.project_ids.includes(p.id)),
  }));
  body.append(
    el('p', {}, '可选择多个项目。取消某项目会同时删除该记录在该项目内的连线。'),
    ...choices.map((c) => c.label),
  );
  footer.append(
    button('取消', () => dialog.close()),
    button(
      '保存归属',
      act(async () => {
        await setProjectMemberships(
          db,
          id,
          choices.filter((c) => c.input.checked).map((c) => c.id),
        );
        dialog.close();
        refreshSoon();
      }),
      'button primary',
    ),
  );
}

async function openCompanion() {
  const client = new CompanionClient();
  try {
    await client.call('ui.open');
  } finally {
    client.close();
  }
}
async function openConflict() {
  await openCompanion();
}
async function syncNow() {
  if (state.busy) return;
  state.busy = true;
  state.progress = '正在交接本地资料库并同步 Google Drive…';
  clearTimeout(toastTimer);
  $('toast').textContent = '';
  $('toast').className = '';
  for (const id of ['sync', 'panel-sync']) {
    $(id).disabled = true;
    $(id).textContent = '同步中…';
  }
  try {
    if (!(await readConfig()).companionEnabled) {
      if (panel) await openDashboard('#settings');
      else await openSettings();
      toast('请先安装并连接本地资料库；浏览器中的记录已保留。');
      return;
    }
    await refresh();
    const response = await chrome.runtime.sendMessage({ type: 'companion-sync', remote: true });
    if (!response?.ok) throw new Error(response?.error || '同步未完成，已保存内容仍保留。');
    const result = response.result;
    if (result.busy) toast('另一个窗口正在交接，请稍后重试。');
    else if (result.driveError)
      toast(`已保存到本地资料库；Drive 同步未完成：${result.driveError}`, true);
    else if (result.refreshPending) toast('Drive 同步完成，正在等待本地记录交接。');
    else
      toast(
        `同步完成：上传 ${result.drive.pushed} 项，拉取 ${result.drive.pulled} 项，${result.conflicts} 条冲突。其他设备需完成各自同步。`,
      );
  } finally {
    state.busy = false;
    state.progress = '';
    await refresh();
  }
}

async function openTheme() {
  const editor = await themeEditor();
  const { dialog, body, footer } = modal('主题与字体', { onClose: () => editor.dispose() });
  body.append(editor.root);
  footer.append(
    button('取消', () => dialog.close()),
    button(
      '保存主题',
      act(async () => {
        await editor.save();
        dialog.close();
      }),
      'button primary',
    ),
  );
}
async function openSettings() {
  const settings = await readConfig();
  const { dialog, body, footer } = modal('设置与数据管理');
  body.append(
    el('p', { class: 'muted' }, `PKM Nexus v${chrome.runtime.getManifest().version}`),
    button('主题与字体', act(openTheme)),
    el(
      'section',
      { class: 'settings-section' },
      el('h3', {}, '内置示例'),
      el(
        'p',
        { class: 'description' },
        '收件箱中的示例用于展示文字、网页、图片、录音和快照。隐藏后可在这里恢复预览。',
      ),
      button(
        '显示收件箱内置示例',
        act(async () => {
          await db.setState(EXAMPLES_VISIBLE, true);
          dialog.close();
          state.query = '';
          state.type = '';
          state.tag = '';
          state.examplesExpanded = true;
          $('search').value = '';
          setView('inbox');
        }),
      ),
    ),
  );
  const companionSection = el(
    'section',
    { class: 'settings-section' },
    el('h3', {}, '本地资料库与 Google Drive'),
    el(
      'p',
      { class: 'description' },
      '先下载并安装本地应用，再连接当前扩展。连接后，已保存记录会交接到本地资料库；Google 授权和自动同步在本地应用中配置。',
    ),
    await companionInstaller(),
    el('p', { class: 'description' }, '当前扩展 ID（复制到本地应用中）：'),
    el('code', {}, chrome.runtime.id),
  );
  const companionStatus = el(
    'p',
    { class: 'description' },
    settings.companionEnabled ? '本地连接已启用。' : '本地连接尚未启用。',
  );
  companionSection.append(
    el(
      'div',
      { class: 'row' },
      button(
        '连接并启用本地资料库',
        act(async () => {
          companionStatus.textContent = '正在交接已保存记录…';
          const result = await handoffCompanion(db, {
            resolveAsset: (descriptor) => loadAsset(db, descriptor),
          });
          if (result.busy) throw new Error('另一个窗口正在交接，请稍后重试。');
          await chrome.storage.local.set({ companionEnabled: true });
          companionStatus.textContent = `已连接：交接 ${result.pushed} 条，接收 ${result.pulled} 条，${result.conflicts} 条冲突。`;
        }),
      ),
      button(
        '打开本地管理程序',
        act(async () => {
          const client = new CompanionClient();
          try {
            await client.call('ui.open');
          } finally {
            client.close();
          }
        }),
      ),
      button(
        '停用本地连接',
        act(async () => {
          await chrome.storage.local.set({ companionEnabled: false });
          companionStatus.textContent =
            '已停用浏览器连接。本地程序中的自动同步需要在其设置中单独关闭。';
        }),
        'link-button',
      ),
    ),
    companionStatus,
  );
  body.append(companionSection);
  const websitesSection = el(
    'section',
    { class: 'settings-section' },
    el('h3', {}, '网页访问权限'),
    el(
      'p',
      { class: 'description' },
      '捕获时可只允许当前网站。若需要跨网站捕获、页面截图或读取外部链接标题，可在这里允许所有网站访问；授权不会开启后台扫描。请使用下方按钮发起 Chrome 授权。',
    ),
  );
  const webStatus = el(
    'small',
    { class: 'muted' },
    (await chrome.permissions.contains({ origins: ['<all_urls>'] }))
      ? '已允许网站访问。'
      : '尚未允许所有网站访问。可在捕获界面单独授权网站，或使用下方按钮授权全部网站。',
  );
  websitesSection.append(
    el(
      'div',
      { class: 'row' },
      button('允许所有网站访问', async () => {
        try {
          webStatus.textContent = (await chrome.permissions.request({
            origins: ['<all_urls>'],
          }))
            ? '已允许所有网站访问。'
            : '未获得授权。可以重新点击授权，或在捕获界面只允许当前网站。';
        } catch (error) {
          webStatus.textContent = `网站授权失败：${error.message}`;
        }
      }),
      button(
        '撤销额外网站访问',
        async () => {
          try {
            await chrome.permissions.remove({ origins: ['<all_urls>'] });
            webStatus.textContent = '已撤销额外网站访问。';
          } catch (error) {
            webStatus.textContent = `撤销权限失败：${error.message}`;
          }
        },
        'link-button',
      ),
    ),
    webStatus,
  );
  body.append(websitesSection);
  const dataSection = el(
    'section',
    { class: 'settings-section' },
    el('h3', {}, '完整本地备份'),
    el(
      'p',
      { class: 'description' },
      '完整 ZIP 包含 JSON、Markdown、图片、音频、项目层级与关系图、回收站与草稿。JSON 单独导出仅包含数据和附件清单，不包含二进制附件。导出不包含 Google 授权凭证。',
    ),
  );
  const file = el('input', {
    type: 'file',
    accept: '.zip,.json,application/zip,application/json',
    hidden: true,
    'aria-label': '选择 JSON 或 ZIP 备份',
  });
  file.addEventListener(
    'change',
    act(async () => {
      const selected = file.files[0];
      if (!selected) return;
      if (selected.size > 512 * 1024 * 1024) throw new Error('备份超过 512 MB，请拆分后导入。');
      const plan = selected.name.toLowerCase().endsWith('.zip')
        ? await previewZipImport(db, selected)
        : await db.previewImport(JSON.parse(await selected.text()));
      await openImport(plan);
    }),
  );
  dataSection.append(
    el(
      'div',
      { class: 'row' },
      button('保存到本地（完整 ZIP）', act(saveLocal)),
      button(
        '导出 JSON',
        act(async () => {
          const data = await db.exportData();
          download(
            `PKM-Nexus-${new Date().toISOString().slice(0, 10)}.json`,
            JSON.stringify(data, null, 2),
          );
        }),
      ),
      button(
        '导出 Markdown（含图片 ZIP）',
        act(async () => {
          const blob = await buildMarkdownExport(db, {
            progress: (message) => {
              $('sync-status').textContent = message;
            },
          });
          download(
            `PKM-Nexus-Markdown-${new Date().toISOString().slice(0, 10)}.zip`,
            blob,
            'application/zip',
          );
          toast('Markdown 与图片已打包，解压后打开 notes 中的 .md 文件。');
        }),
      ),
      button('导入 JSON / ZIP', () => file.click()),
      file,
    ),
  );
  const storageInfo = el('p', { class: 'description' }, '正在读取本地存储信息…');
  const estimate = await navigator.storage.estimate();
  storageInfo.textContent = `本地存储约 ${((estimate.usage || 0) / 1024 / 1024).toFixed(2)} MB（浏览器估算，包含索引）。卸载扩展前请导出备份。`;
  const drafts = await db.drafts(),
    draftSection = el(
      'section',
      { class: 'settings-section' },
      el('h3', {}, '本机未保存草稿'),
      el(
        'p',
        { class: 'description' },
        '旧版本编辑草稿不会覆盖最新记录。可继续编辑，或下载原始草稿；JSON 备份也会保留这些内容。',
      ),
    );
  if (!drafts.length) draftSection.append(el('small', { class: 'muted' }, '目前没有未保存草稿。'));
  for (const draft of drafts)
    draftSection.append(
      el(
        'div',
        { class: 'row' },
        el('span', {}, draft.value.record?.title || draft.value.title || '未命名草稿'),
        button(
          draft.value.record?.type === 'list' ? '继续编辑清单' : '恢复为新记录',
          act(async () => {
            if (draft.value.record?.type === 'list') {
              await openList();
              return;
            }
            const value = draft.value.record
              ? draft.value
              : {
                  record: newRecord({
                    type: draft.value.type,
                    title: draft.value.title,
                    content: draft.value.content,
                    attachments: draft.value.attachments || [],
                  }),
                  rawUrls: draft.value.url,
                  expectedRev: 0,
                };
            await openEditor(null, { value, key: draft.key });
          }),
          'button small',
        ),
        button(
          '下载',
          () => download('PKM-Nexus-draft.json', JSON.stringify(draft, null, 2)),
          'link-button',
        ),
      ),
    );
  const recordings = await db.recordings(),
    recordingSection = el('section', { class: 'settings-section' }, el('h3', {}, '未完成录音恢复'));
  if (!recordings.some((r) => r.chunks))
    recordingSection.append(el('small', { class: 'muted' }, '没有需要恢复的录音。'));
  for (const session of recordings.filter((r) => r.chunks))
    recordingSection.append(
      el(
        'div',
        { class: 'row' },
        el('span', {}, `录音 ${dateLabel(session.created_at)}`),
        button(
          '恢复到收件箱',
          act(async () => {
            const attachment = await db.finishRecording(session.id);
            await db.save(
              newRecord({
                type: 'note',
                title: attachment.name,
                content: `[${attachment.name}](${attachment.path})`,
                attachments: [attachment],
              }),
              { expectedRev: 0 },
            );
            await db.removeRecording(session.id);
            dialog.close();
            toast('已恢复录音到收件箱。');
          }),
          'button small',
        ),
      ),
    );
  body.append(dataSection, draftSection, recordingSection, storageInfo);
  footer.append(button('关闭', () => dialog.close()));
}
async function openImport(plan) {
  const counts = { new: 0, same: 0, changed: 0 };
  plan.entries.forEach((e) => counts[e.status]++);
  const { dialog, body, footer } = modal('导入预览');
  const overwrite = check('更新相同 ID 但内容不同的记录（包含恢复或删除状态变化）', false);
  body.append(
    el(
      'p',
      { class: 'description' },
      `新增 ${counts.new} 条 · 相同 ${counts.same} 条 · 内容不同 ${counts.changed} 条 · 待处理收集 ${plan.captures.length} 条 · 草稿 ${plan.drafts?.length || 0} 条。默认保留本机已有差异，重复导入不会复制整个数据库。`,
    ),
    el(
      'div',
      { class: 'preview-list' },
      ...plan.entries
        .filter((e) => e.status !== 'same')
        .slice(0, 100)
        .map((e) =>
          el('div', {}, `${e.status === 'new' ? '新增' : '差异'} · ${titleOf(e.record)}`),
        ),
    ),
    overwrite.label,
    el(
      'p',
      { class: 'description' },
      '导入只修改本机，不自动上传。相同记录沿用原 ID，本地资料库绑定和 Google 授权不会被备份覆盖。',
    ),
  );
  footer.append(
    button('取消', () => dialog.close()),
    button(
      '导入到本机',
      act(async () => {
        const count = await db.applyImport(plan, overwrite.input.checked);
        await migrateTodos(db);
        dialog.close();
        toast(`已导入 ${count} 项变化，等待你立即同步。`);
      }),
      'button primary',
    ),
  );
}

async function initialize() {
  await protectStorage();
  const currentWindow = await chrome.windows.getCurrent();
  currentWindowId = currentWindow.id;
  viewStorageKey = `ui:${panel ? `panel:${currentWindow.id}` : 'dashboard'}`;
  const saved = (await chrome.storage.session.get(viewStorageKey))[viewStorageKey];
  if (saved && Object.hasOwn(VIEWS, saved.view)) {
    for (const key of [
      'view',
      'query',
      'tag',
      'type',
      'project',
      'limit',
      'examplesExpanded',
      'cardModes',
    ])
      if (saved[key] !== undefined) state[key] = saved[key];
    $('search').value = state.query;
  }
  await migrateTodos(db);
  db.onChange((kind) => {
    if (!['draft', 'companion'].includes(kind)) refreshSoon();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.companionEnabled) refreshSoon();
  });
  try {
    examples = await loadExamples();
  } catch (error) {
    examplesError = error.message;
  }
  await setupPanel();
  await refresh();
  const checkLocal = () => {
    if (state.companionEnabled && document.visibilityState === 'visible')
      chrome.runtime
        .sendMessage({ type: 'companion-sync', pullOnly: true })
        .then(() => refreshSoon())
        .catch(() => {});
  };
  document.addEventListener('visibilitychange', checkLocal);
  if ((await readConfig()).companionEnabled)
    chrome.runtime
      .sendMessage({ type: 'companion-sync' })
      .then(() => refreshSoon())
      .catch(() => {});
  if (!panel && location.hash === '#settings') await openSettings();
}
initialize().catch((error) => {
  $('records').replaceChildren(
    el('div', { class: 'notice' }, '无法打开本地数据库：', error.message),
  );
  toast(error.message, true);
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#settings') act(openSettings)();
});
// An explicitly enabled local companion can receive queued records on startup. No automatic AI calls.

import { t, msg, translateStatic } from './lib/i18n.js';
import { languageSettings } from './lib/language-settings.js';
import { icon } from './lib/icons.js';
import { APP_NAME, APP_TAGLINE, EXPORT_PREFIX } from './lib/brand.js';
import { colorControl, iconChoices, tagBadge } from './lib/appearance.js';
import { installTheme, themeEditor } from './lib/theme.js';
import { recordPreview } from './lib/record-preview.js';
import { Database } from './lib/db.js';
import { TAG_LIBRARY_ID } from './lib/tag-library.js';
import { SHORTCUT_LIBRARY_ID } from './lib/shortcut-library.js';
import {
  activeProject,
  projectTree,
  upgradeProject,
  setProjectMemberships,
  saveProject,
} from './lib/projects.js';
import { projectGraph } from './lib/project-graph.js';
import { animateSortReflow, moveSortItem, setSortDragImage } from './lib/sort-feedback.js';
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
import { driveSettings, driveCommand, metadataSyncStatus } from './lib/drive-ui.js';
import { installMascot, mascotSettings } from './lib/mascot.js';
import { WEBSITE_DRAG_TYPE, readWebsiteDrag } from './lib/website-drag.js';
import {
  el,
  button,
  field,
  option,
  dateLabel,
  download,
  markdownPreview,
  assetView,
  closeOnBackdrop,
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
import {
  singletonList,
  migrateTodos,
  appendWebsites,
  moveWebsite,
  moveWebsiteGroups,
  listDocument,
} from './lib/collections.js';
import { droppedWebsites, closeCapturedTabs } from './lib/tabs.js';
import { buildLocalBackup, buildMarkdownExport, previewZipImport } from './lib/backup.js';
import { EXPORT_GROUPS } from './lib/export-layout.js';
import { RecordOrder, SORT_MODES, sortPreference } from './lib/record-order.js';
import { PINNED_RECORDS, togglePinnedRecord } from './lib/pins.js';
import { startSettings } from './lib/start-settings.js';

const db = new Database();
await installTheme();
const panel = document.body.dataset.mode === 'panel';
const state = {
  view: 'inbox',
  query: '',
  tag: '',
  type: '',
  project: '',
  projectMembership: '',
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
  sortMode: 'updated_at',
  sortDirection: 'desc',
  projectOrder: [],
  collapsedProjects: new Set(),
};
const recordOrder = new RecordOrder();
const TAG_GROUPS = 'ui:tag-groups';
const SIDEBAR_PROJECT_HEIGHT = 'ui:sidebar-project-height';
const SIDEBAR_TOOLS_COLLAPSED = 'ui:sidebar-tools-collapsed';
const PROJECT_ORDER = 'ui:project-order';
const COLLAPSED_PROJECTS = 'ui:collapsed-projects';
const RECORD_DRAG_TYPE = 'application/x-pkm-records';
const PROJECT_DRAG_TYPE = 'application/x-pkm-project';
let viewStorageKey;
let currentWindowId;
const $ = (id) => document.getElementById(id);
let toastTimer, refreshTimer, activeDialog, panelEditor;
let draggedProjectId = '';
let projectDragSession = null;
let projectSortSettling = 0;
let exporting = false;
let sortWrite = Promise.resolve();
let recordPointerHeld = false,
  recordDragging = false,
  refreshAfterDrag = false,
  recordDragOrigin = null;
function refreshBlockedByDrag() {
  if (!recordPointerHeld && !recordDragging && !draggedProjectId && !projectSortSettling)
    return false;
  refreshAfterDrag = true;
  return true;
}
function finishRecordInteraction() {
  if (
    !recordPointerHeld &&
    !recordDragging &&
    !draggedProjectId &&
    !projectSortSettling &&
    refreshAfterDrag
  ) {
    refreshAfterDrag = false;
    refreshSoon(0);
  }
}
document.addEventListener(
  'pointerdown',
  (event) => {
    recordPointerHeld = !!event.target.closest('#records .record');
    const link = event.target.closest('.website-link, .website-drag-handle'),
      row = link?.closest('.website-preview-line'),
      card = row?.closest('#records .record');
    recordDragOrigin =
      card && row?.dataset.websiteId
        ? { groupId: card.dataset.recordId, itemId: row.dataset.websiteId }
        : null;
  },
  true,
);
for (const type of ['pointerup', 'pointercancel', 'dragend'])
  document.addEventListener(
    type,
    () => {
      recordPointerHeld = false;
      if (type !== 'pointercancel') recordDragOrigin = null;
      if (type === 'dragend') recordDragging = false;
      finishRecordInteraction();
    },
    true,
  );
document.addEventListener(
  'dragstart',
  (event) => {
    if (!event.target.closest('#records .record')) return;
    recordDragging = true;
    queueMicrotask(() => {
      if (event.defaultPrevented) {
        recordPointerHeld = recordDragging = false;
        finishRecordInteraction();
      }
    });
  },
  true,
);
let examples = [],
  examplesError = '',
  examplesLoading;
async function ensureExamplesLoaded() {
  if (examples.length || examplesError) return;
  examplesLoading ||= loadExamples()
    .then((loaded) => {
      examples = loaded;
      examplesError = '';
    })
    .catch((error) => {
      examplesError = error.message;
    })
    .finally(() => {
      examplesLoading = null;
    });
  await examplesLoading;
}
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
      .catch((error) => toast(error.message || t('操作失败，请重试。'), true));
function refreshSoon(delay = 100) {
  persistView();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch((error) => toast(error.message, true)), delay);
}
function persistView() {
  if (!viewStorageKey) return;
  const {
    view,
    query,
    tag,
    type,
    project,
    projectMembership,
    limit,
    examplesExpanded,
    cardModes,
    sortMode,
    sortDirection,
  } = state;
  return chrome.storage.session
    .set({
      [viewStorageKey]: {
        view,
        query,
        tag,
        type,
        project,
        projectMembership,
        limit,
        examplesExpanded,
        cardModes,
        sortMode,
        sortDirection,
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
  closeOnBackdrop(dialog);
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
      ? t('已移除当前正文')
      : record.title || t('未命名记录');
}
const VIEWS = {
  inbox: [t('收件箱'), t('所有新收集都先留在这里。先保存，稍后整理。'), '▣'],
  all: [t('全部记录'), t('你的文字、链接与想法，保存在自己的数据库中。'), '≡'],
  organized: [t('已整理'), t('已经分类，随时可以再次使用。'), '✓'],
  favorites: [t('喜爱'), t('收藏的记录，随时回来浏览。'), '☆'],
  duplicates: [t('重复检查'), t('检查正文相同的记录和重复保存的网页链接。'), '⊕'],
  pending: [t('待同步记录'), t('这些修改只保存在本机，点击同步后才会上传。'), '↥'],
  trash: [t('回收站'), t('删除与还原也由你决定同步时机。回收站不会自动清空。'), '⌫'],
};

// This template contains no user data; all dynamic text uses textContent / DOM nodes.
$('app').innerHTML = `
<div class="app-shell">
  <aside class="sidebar">
    <div class="sidebar-brand-row"><div class="brand"><img class="brand-penguin" src="icons/penguin.png" alt="企鹅" data-i18n-alt="企鹅"><div><div class="brand-name">${APP_NAME}</div><div class="brand-sub">${APP_TAGLINE}</div></div></div><button id="manual" class="sidebar-help" aria-label="使用说明书" data-i18n-aria-label="使用说明书" title="使用说明书">?</button></div>
    <nav id="nav" class="nav" aria-label="记录视图" data-i18n-aria-label="记录视图"></nav>
    <div id="sidebar-regions" class="sidebar-regions"><section class="projects-section"><div class="section-label"><span data-i18n="项目">项目</span><button id="add-project" class="icon-button" aria-label="新增项目" data-i18n-aria-label="新增项目">＋</button></div><div id="projects-nav"></div></section><div id="sidebar-splitter" class="sidebar-splitter" role="separator" tabindex="0" aria-orientation="horizontal" aria-controls="projects-nav tags-nav" aria-label="调整项目与标签区域高度" aria-valuemin="20" aria-valuemax="80" aria-valuenow="55"></div><section class="tag-groups" aria-label="标签" data-i18n-aria-label="标签"><div class="section-label"><span data-i18n="标签">标签</span><div><button id="tag-appearance" class="icon-button" aria-label="设置标签外观" data-i18n-aria-label="设置标签外观">⚙</button><button id="add-tag-group" class="icon-button" aria-label="新建标签" data-i18n-aria-label="新建标签">＋</button></div></div><div id="tags-nav" class="tag-cloud"></div></section></div>
    <div class="sidebar-actions"><button id="toggle-utility" class="sidebar-actions-toggle" aria-controls="utility-nav" aria-expanded="true"><span data-i18n="整理工具">整理工具</span><span class="sidebar-actions-caret" aria-hidden="true">▾</span></button><nav id="utility-nav" class="nav utility-nav" aria-label="重复检查与回收站" data-i18n-aria-label="重复检查与回收站"></nav><button id="settings" class="nav-item sidebar-settings" data-i18n="⚙ 设置与数据管理">⚙　设置与数据管理</button></div>
  </aside>
  <main class="main"><div class="panel-brand"><img class="brand-penguin" src="icons/penguin.png" alt="企鹅" data-i18n-alt="企鹅"><strong>${APP_NAME}</strong></div>
    <header class="topbar"><div class="search-wrap"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="搜索标题、正文、标签和来源…" data-i18n-placeholder="搜索标题、正文、标签和来源…" aria-label="搜索记录" data-i18n-aria-label="搜索记录"></div><div class="topbar-actions"><button id="save-local" class="button" data-i18n="导出备份">导出备份</button><button id="sync-download" class="button" data-i18n="↓ 同步下载">↓ 同步下载</button><button id="sync" class="button" data-i18n="↑ 同步上传">↑ 同步上传</button><button id="new" class="button primary" data-i18n="＋ 新建记录">＋ 新建记录</button></div></header>
    <div class="content">
      <section id="capture-box" class="capture-box"></section>
      <div class="page-eyebrow">PERSONAL KNOWLEDGE INBOX</div>
      <div class="page-heading"><div><h1 id="heading"></h1><p id="description" class="description"></p></div><div id="sync-status" class="sync-status"></div></div>
      <div id="notices"></div>
      <div class="filters"><label class="checkbox-line"><input id="select-all" type="checkbox"><span data-i18n="选择本页">选择本页</span></label><div id="type-filter" class="filter-tabs" role="tablist" aria-label="记录类型" data-i18n-aria-label="记录类型"></div><select id="tag-filter" aria-label="标签筛选" data-i18n-aria-label="标签筛选"></select><select id="project-membership-filter" aria-label="是否在项目" data-i18n-aria-label="是否在项目" hidden><option value="" data-i18n="全部记录">全部记录</option><option value="in-project" data-i18n="已在项目">已在项目</option><option value="no-project" data-i18n="未在项目">未在项目</option></select><span class="spacer"></span><div id="project-actions"></div><small id="result-count" class="muted"></small></div>
      <div id="selection-bar" class="selection-bar" hidden></div>
      <div class="sorting-toolbar"><label for="sort-mode" data-i18n="排序">排序</label><select id="sort-mode" aria-label="记录排序方式" data-i18n-aria-label="记录排序方式"></select><button id="sort-direction" class="button small" aria-label="切换排序方向" data-i18n-aria-label="切换排序方向"></button><button id="resort" class="link-button" data-i18n="重新排序">重新排序</button><small id="order-hint" class="muted" data-i18n="修改后保留当前位置">修改后保留当前位置</small></div>
      <section id="builtin-examples" aria-label="内置示例" data-i18n-aria-label="内置示例" hidden></section>
      <section id="records" class="records" aria-label="记录列表" data-i18n-aria-label="记录列表"></section>
      <button id="load-more" class="button load-more" hidden data-i18n="加载更多">加载更多</button>
    </div>
    <footer class="panel-footer"><div class="panel-footer-meta"><small id="extension-version" class="extension-version muted"></small><button id="examples-shortcut" class="link-button" aria-controls="builtin-examples" data-i18n="查看内置示例">查看内置示例</button></div><div id="panel-sync-status" class="sync-status"></div><button id="panel-sync-download" class="button" data-i18n="↓ 同步下载">↓ 同步下载</button><button id="panel-sync" class="button primary" data-i18n="↑ 同步上传">↑ 同步上传</button><button id="panel-save-local" class="button" data-i18n="导出备份">导出备份</button><button id="open-dashboard" class="button" data-i18n="整理页 ↗">整理页 ↗</button><button id="panel-manual" class="icon-button" aria-label="使用说明书" data-i18n-aria-label="使用说明书">?</button><button id="panel-settings" class="icon-button" aria-label="打开设置" data-i18n-aria-label="打开设置">⚙</button></footer>
  </main>
</div>`;
translateStatic($('app'));
await installMascot();

const sidebarRegions = $('sidebar-regions');
const sidebarSplitter = $('sidebar-splitter');
let sidebarProjectHeight = Number(localStorage.getItem(SIDEBAR_PROJECT_HEIGHT));
function setSidebarProjectHeight(value, persist = false) {
  sidebarProjectHeight = Math.max(20, Math.min(80, Math.round(value)));
  sidebarRegions.style.setProperty('--project-height', `${sidebarProjectHeight}%`);
  sidebarSplitter.setAttribute('aria-valuenow', String(sidebarProjectHeight));
  if (persist) localStorage.setItem(SIDEBAR_PROJECT_HEIGHT, String(sidebarProjectHeight));
}
setSidebarProjectHeight(
  Number.isFinite(sidebarProjectHeight) && sidebarProjectHeight > 0 ? sidebarProjectHeight : 55,
);
sidebarSplitter.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  sidebarSplitter.setPointerCapture(event.pointerId);
  sidebarSplitter.classList.add('resizing');
});
sidebarSplitter.addEventListener('pointermove', (event) => {
  if (!sidebarSplitter.hasPointerCapture(event.pointerId)) return;
  const { top, height } = sidebarRegions.getBoundingClientRect();
  if (height > 0) setSidebarProjectHeight(((event.clientY - top) / height) * 100);
});
for (const name of ['pointerup', 'pointercancel'])
  sidebarSplitter.addEventListener(name, (event) => {
    if (!sidebarSplitter.hasPointerCapture(event.pointerId)) return;
    sidebarSplitter.releasePointerCapture(event.pointerId);
    sidebarSplitter.classList.remove('resizing');
    setSidebarProjectHeight(sidebarProjectHeight, true);
  });
sidebarSplitter.addEventListener('keydown', (event) => {
  const change = { ArrowUp: -5, ArrowDown: 5, Home: -Infinity, End: Infinity }[event.key];
  if (change === undefined) return;
  event.preventDefault();
  setSidebarProjectHeight(
    change === -Infinity ? 20 : change === Infinity ? 80 : sidebarProjectHeight + change,
    true,
  );
});
sidebarSplitter.addEventListener('dblclick', () => setSidebarProjectHeight(55, true));

const utilityToggle = $('toggle-utility');
const utilityNav = $('utility-nav');
function setUtilityCollapsed(collapsed, persist = false) {
  utilityNav.hidden = collapsed;
  utilityToggle.setAttribute('aria-expanded', String(!collapsed));
  if (persist) localStorage.setItem(SIDEBAR_TOOLS_COLLAPSED, String(collapsed));
}
setUtilityCollapsed(localStorage.getItem(SIDEBAR_TOOLS_COLLAPSED) === 'true');
utilityToggle.addEventListener('click', () => setUtilityCollapsed(!utilityNav.hidden, true));

$('settings').replaceChildren(
  el('span', { class: 'nav-symbol', 'aria-hidden': 'true' }, icon('settings')),
  el('span', { class: 'nav-label' }, t('设置与数据管理')),
);
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
  ...[['', t('全部')], ...Object.entries(TYPES)].map(([type, label]) => {
    const node = button(
      t(label),
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
$('sort-mode').append(...Object.entries(SORT_MODES).map(([value, label]) => option(value, label)));
async function saveSort() {
  recordOrder.reset();
  const preference = { mode: state.sortMode, direction: state.sortDirection };
  const viewSaved = persistView();
  sortWrite = sortWrite
    .catch(() => {})
    .then(() => chrome.storage.local.set({ recordSort: preference }));
  await Promise.all([viewSaved, sortWrite]);
  refreshSoon();
}
$('sort-mode').addEventListener(
  'change',
  act(async () => {
    state.sortMode = $('sort-mode').value;
    state.sortDirection = ['created_at', 'updated_at'].includes(state.sortMode) ? 'desc' : 'asc';
    await saveSort();
  }),
);
$('sort-direction').addEventListener(
  'click',
  act(async () => {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    await saveSort();
  }),
);
$('resort').addEventListener('click', () => {
  recordOrder.reset();
  refreshSoon();
});
$('project-membership-filter').addEventListener('change', () => {
  state.projectMembership = $('project-membership-filter').value;
  state.limit = panel ? 20 : 60;
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
const panelTheme = button('◐', act(openTheme), 'icon-button');
panelTheme.setAttribute('aria-label', t('主题与字体'));
$('manual').title = t('使用说明书');
$('manual').addEventListener('click', () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('manual.html') }),
);
$('panel-manual').addEventListener('click', () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('manual.html') }),
);
$('panel-settings').addEventListener(
  'click',
  act(async () => {
    await panelEditor?.flush();
    await openDashboard('#settings');
  }),
);
$('add-project').addEventListener(
  'click',
  act(() => openProject()),
);
$('add-tag-group').addEventListener('click', () => openTagGroup());
$('open-dashboard').addEventListener('click', () => openDashboard());
if (panel) $('extension-version').after(panelTheme, $('panel-manual'), $('panel-settings'));
for (const node of document.querySelectorAll('.extension-version'))
  node.textContent = `${APP_NAME} v${chrome.runtime.getManifest().version}`;
$('examples-shortcut').addEventListener('click', act(showExamples));
$('sync').addEventListener(
  'click',
  act(() => syncNow()),
);
$('panel-sync').addEventListener(
  'click',
  act(() => syncNow()),
);
for (const id of ['sync-download', 'panel-sync-download'])
  $(id).addEventListener(
    'click',
    act(() => syncNow('download')),
  );
$('save-local').addEventListener('click', act(saveLocal));
$('panel-save-local').addEventListener('click', act(saveLocal));
async function saveLocal() {
  if (exporting) throw new Error(t('正在导出，请等待当前导出完成。'));
  exporting = true;
  try {
    if (panelEditor?.recording) throw new Error(t('请先停止录音，再保存完整本地包。'));
    await panelEditor?.flush();
    const groupBy = await chooseExportLayout(t('完整 ZIP'));
    if (!groupBy) return;
    for (const id of ['save-local', 'panel-save-local']) $(id).disabled = true;
    const blob = await buildLocalBackup(db, {
      groupBy,
      progress: (message) => {
        $('sync-status').textContent = message;
        $('panel-sync-status').textContent = message;
      },
    });
    download(
      `${EXPORT_PREFIX}-data-${new Date().toISOString().slice(0, 10)}.zip`,
      blob,
      'application/zip',
    );
    toast(t('已生成完整本地 ZIP：包含记录、图片、音频和 Markdown。'));
  } finally {
    exporting = false;
    for (const id of ['save-local', 'panel-save-local']) $(id).disabled = false;
    await refresh();
  }
}
function chooseExportLayout(kind) {
  return new Promise((resolve) => {
    let selection = null;
    const { dialog, body, footer } = modal(t('选择导出整理方式'), {
      parent: activeDialog?.open ? activeDialog : null,
      onClose: () => resolve(selection),
    });
    const group = el(
      'select',
      { 'aria-label': t('文件夹整理方式') },
      ...Object.entries(EXPORT_GROUPS).map(([key, label]) => option(key, t(label))),
    );
    const sample = el('pre', { class: 'conflict-preview', 'aria-label': t('导出目录示例') });
    const update = () => {
      sample.textContent =
        group.value === 'project'
          ? t('notes/项目/项目名称/记录名称.md\nnotes/未归入项目/记录名称.md')
          : group.value === 'tag'
            ? t('notes/标签/标签名称/记录名称.md\nnotes/未打标签/记录名称.md')
            : t('notes/记录名称.md');
    };
    group.addEventListener('change', update);
    update();
    body.append(
      el('p', { class: 'description' }, msg`${kind}：Markdown 使用项目或记录原名，重名自动区分。`),
      field(t('文件夹整理方式'), group),
      sample,
      el(
        'p',
        { class: 'description' },
        t(
          '一条记录属于多个项目或标签时，各目录提供一份阅读副本；附件只保存一份。完整 ZIP 的恢复数据仍按唯一 ID 保存，导入不会重复。',
        ),
      ),
    );
    footer.append(
      button(t('取消'), () => dialog.close()),
      button(
        t('开始导出'),
        () => {
          selection = group.value;
          dialog.close();
        },
        'button primary',
      ),
    );
  });
}
async function saveMarkdown() {
  if (exporting) throw new Error(t('正在导出，请等待当前导出完成。'));
  exporting = true;
  try {
    const groupBy = await chooseExportLayout('Markdown ZIP');
    if (!groupBy) return;
    const blob = await buildMarkdownExport(db, {
      groupBy,
      progress: (message) => {
        $('sync-status').textContent = message;
      },
    });
    download(
      `${EXPORT_PREFIX}-Markdown-${new Date().toISOString().slice(0, 10)}.zip`,
      blob,
      'application/zip',
    );
    toast(t('Markdown 与附件已打包，解压后打开 notes 中的 .md 文件。'));
  } finally {
    exporting = false;
    await refresh();
  }
}
function setView(view, project = '') {
  recordOrder.reset();
  if (state.view !== view || project) state.projectMembership = '';
  state.view = view;
  state.project = project;
  state.tag = '';
  state.selected.clear();
  state.limit = panel ? 20 : 60;
  refreshSoon();
}

async function refresh() {
  if (refreshBlockedByDrag()) return;
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
    projectOrder,
    collapsedProjects,
  ] = await Promise.all([
    db.allCatalog(),
    db.captures(),
    db.getState('drive:conflicts', []),
    db.getState('drive:last'),
    readConfig(),
    db.getState('notice'),
    db.getState(EXAMPLES_VISIBLE, true),
    db.getState(TAG_GROUPS, []),
    db.getState(PINNED_RECORDS, []),
    db.getState(PROJECT_ORDER, []),
    db.getState(COLLAPSED_PROJECTS, []),
  ]);
  if (examplesVisible) await ensureExamplesLoaded();
  const projects = catalog.filter((m) => m.type === 'project' && !m.deleted_at);
  const links = await db.driveLinks();
  const pendingIds = new Set(
    catalog
      .filter((m) => links.get(m.id)?.hash !== m.hash || links.get(m.id)?.needsConsolidation)
      .map((m) => m.id),
  );
  for (const item of catalog) item.dirty = pendingIds.has(item.id);
  const duplicates = duplicateIds(catalog);
  if (generation !== state.generation) return;
  const orderedIds = recordOrder.reconcile(
    catalog,
    [state.view, state.query, state.tag, state.type, state.project, state.projectMembership],
    { mode: state.sortMode, direction: state.sortDirection },
  );
  const results = await db.list({
    orderedIds,
    view: state.view,
    query: state.query,
    tag: state.tag,
    type: state.type,
    project: state.project,
    projectMembership: state.view === 'organized' && !state.project ? state.projectMembership : '',
    ids: state.view === 'duplicates' ? duplicates : null,
    pendingIds,
    pinnedIds,
    limit: state.limit,
  });
  if (generation !== state.generation) return;
  if (refreshBlockedByDrag()) return;
  $('sort-mode').value = state.sortMode;
  $('sort-direction').textContent = state.sortDirection === 'desc' ? t('↓ 降序') : t('↑ 升序');
  $('order-hint').textContent = recordOrder.pending
    ? t('顺序有变化，下次进入或点击重新排序时生效')
    : t('修改后保留当前位置');
  for (const tab of $('type-filter').children) {
    tab.classList.toggle('active', tab.dataset.type === state.type);
    tab.setAttribute('aria-selected', String(tab.dataset.type === state.type));
  }
  state.projects = projects;
  state.projectOrder = Array.isArray(projectOrder) ? projectOrder : [];
  state.collapsedProjects = new Set(Array.isArray(collapsedProjects) ? collapsedProjects : []);
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
  for (const p of projectTree(projects, state.projectOrder)) {
    const hasChildren = projects.some((child) => child.parent_project_id === p.id);
    const collapsed = state.collapsedProjects.has(p.id);
    const toggle = hasChildren
      ? button(
          collapsed ? '▸' : '▾',
          act(async () => {
            if (state.collapsedProjects.has(p.id)) state.collapsedProjects.delete(p.id);
            else state.collapsedProjects.add(p.id);
            const isCollapsed = state.collapsedProjects.has(p.id);
            toggle.textContent = isCollapsed ? '▸' : '▾';
            toggle.setAttribute('aria-expanded', String(!isCollapsed));
            toggle.setAttribute('aria-label', isCollapsed ? t('展开子项目') : t('折叠子项目'));
            children.hidden = isCollapsed;
            await db.setState(COLLAPSED_PROJECTS, [...state.collapsedProjects]);
          }),
          'project-toggle',
        )
      : null;
    if (toggle) {
      toggle.setAttribute('aria-label', collapsed ? t('展开子项目') : t('折叠子项目'));
      toggle.setAttribute('aria-expanded', String(!collapsed));
    }
    const dragHandle = el(
      'span',
      {
        class: 'project-drag-handle',
        draggable: 'true',
        role: 'button',
        tabindex: '0',
        title: t('拖动排序项目'),
        'aria-label': t('拖动排序项目'),
      },
      '⋮⋮',
    );
    const node = el(
      'div',
      { class: `project-nav${state.project === p.id ? ' active' : ''}`, 'data-project-id': p.id },
      toggle || el('span', { class: 'project-toggle-placeholder', 'aria-hidden': 'true' }),
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
      dragHandle,
    );
    node.title = p.breadcrumb;
    if (p.appearance?.color) node.style.color = p.appearance.color;
    recordDropTarget(node, ({ ids }) => addToProjects(ids, [p.id]));
    dragHandle.addEventListener('dragstart', (event) => {
      draggedProjectId = p.id;
      projectDragSession = {
        branch,
        parent: branch.parentElement,
        next: branch.nextSibling,
        committed: false,
      };
      event.dataTransfer.setData(PROJECT_DRAG_TYPE, p.id);
      event.dataTransfer.effectAllowed = 'move';
      setSortDragImage(event, node);
      branch.classList.add('project-dragging');
    });
    dragHandle.addEventListener('dragend', () => {
      if (projectDragSession && !projectDragSession.committed) {
        const { branch: source, parent, next } = projectDragSession;
        if (source.parentElement === parent)
          animateSortReflow(parent, () => parent.insertBefore(source, next));
      }
      draggedProjectId = '';
      branch.classList.remove('project-dragging');
      projectDragSession = null;
      finishRecordInteraction();
    });
    node.addEventListener('dragover', (event) => {
      if (![...event.dataTransfer.types].includes(PROJECT_DRAG_TYPE)) return;
      const source = state.projects.find((project) => project.id === draggedProjectId);
      if (!source || source.parent_project_id !== p.parent_project_id) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      if (source.id !== p.id && projectDragSession)
        moveSortItem(
          projectDragSession.branch,
          branch,
          event.clientY >= node.getBoundingClientRect().top + node.offsetHeight / 2,
        );
    });
    node.addEventListener('drop', (event) => {
      if (![...event.dataTransfer.types].includes(PROJECT_DRAG_TYPE)) return;
      const source = state.projects.find((project) => project.id === draggedProjectId);
      if (!source || source.parent_project_id !== p.parent_project_id) return;
      event.preventDefault();
      event.stopPropagation();
      if (!projectDragSession || !draggedProjectId) return;
      projectDragSession.committed = true;
      const order = [...$('projects-nav').querySelectorAll('.project-branch')].map(
        (item) => item.firstElementChild.dataset.projectId,
      );
      const previous = projectTree(state.projects, state.projectOrder).map((item) => item.id);
      if (order.every((id, index) => id === previous[index])) return;
      projectSortSettling++;
      act(async () => {
        state.projectOrder = order;
        try {
          await db.setState(PROJECT_ORDER, order);
          if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
            await new Promise((resolve) => setTimeout(resolve, 210));
        } catch (error) {
          refreshAfterDrag = true;
          throw error;
        } finally {
          projectSortSettling--;
          finishRecordInteraction();
        }
      })();
    });
    const branch = el('div', { class: 'project-branch' }, node);
    const children = el('div', { class: 'project-children' });
    children.hidden = collapsed;
    branch.append(children);
    projectBranches.set(p.id, children);
    if (projectBranches.has(p.parent_project_id))
      projectBranches.get(p.parent_project_id).append(branch);
    else projectRoots.push(branch);
  }
  const projectScrollTop = $('projects-nav').scrollTop;
  $('projects-nav').replaceChildren(...projectRoots);
  $('projects-nav').scrollTop = projectScrollTop;
  const p = projects.find((p) => p.id === state.project);
  state.tagStyles = await db.getState('ui:tag-styles', {});
  if (state.project && !p) state.project = '';
  document.querySelector('.page-eyebrow').hidden = !!p;
  $('heading').textContent = p
    ? p.title
    : state.tag
      ? msg`标签 · ${state.tag}`
      : VIEWS[state.view][0];
  $('description').textContent = p
    ? p.summary || t('为这个项目添加描述，说明目标与资料范围。')
    : state.tag
      ? state.tagStyles[state.tag]?.description || t('把标签拖到记录上即可追加分类，保留已有标签。')
      : VIEWS[state.view][1];
  const pending = catalog.filter((m) => m.dirty).length;
  const tagsRow = await db.syncRow(TAG_LIBRARY_ID);
  const tagsPending =
    tagsRow &&
    (tagsRow.hash !== links.get(TAG_LIBRARY_ID)?.hash ||
      links.get(TAG_LIBRARY_ID)?.needsConsolidation);
  const shortcutsRow = await db.syncRow(SHORTCUT_LIBRARY_ID);
  const shortcutsPending =
    shortcutsRow &&
    (shortcutsRow.hash !== links.get(SHORTCUT_LIBRARY_ID)?.hash ||
      links.get(SHORTCUT_LIBRARY_ID)?.needsConsolidation);
  const binding = await db.getState('drive:binding');
  const lastError = await db.getState('drive:error');
  const statusNodes = () => [
    el('span', { class: `dot${pending || tagsPending || shortcutsPending ? ' pending' : ''}` }),
    el(
      'span',
      {},
      state.busy
        ? state.progress
        : lastError
          ? msg`同步未完成：${lastError}`
          : !settings.driveAccount
            ? msg`已保存到浏览器 · 登录 Google Drive 后可同步`
            : !binding
              ? t('已登录 Google Drive · 请选择数据文件夹')
              : msg`已保存到浏览器 · ${pending} 条待上传${tagsPending ? t(' · 标签待上传') : ''}${shortcutsPending ? t(' · 常用网站待上传') : ''}${state.conflicts.length ? msg` · ${state.conflicts.length} 条冲突` : ''}`,
    ),
    ...(!state.busy && lastSync?.at
      ? [
          el(
            'span',
            {},
            msg` · 上次${lastSync.direction === 'download' ? t('下载') : t('上传')} ${dateLabel(lastSync.at)}`,
          ),
        ]
      : []),
  ];
  $('sync-status').replaceChildren(...statusNodes());
  $('panel-sync-status').replaceChildren(...statusNodes());
  for (const id of ['sync', 'panel-sync']) {
    $(id).disabled = state.busy;
    $(id).textContent = state.busy ? t('同步中…') : t('↑ 同步上传');
  }
  for (const id of ['sync-download', 'panel-sync-download']) $(id).disabled = state.busy;
  const tags = [...new Set([...tagGroups, ...active.flatMap((m) => m.tags)])].sort((a, b) =>
    a.localeCompare(b),
  );
  state.tagGroups = tags;
  const tagScrollTop = $('tags-nav').scrollTop;
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
      node.append(el('span', { class: 'tag-group-name' }, tag));
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
      if (state.tagStyles[tag]?.description) node.title = state.tagStyles[tag].description;
      return node;
    }),
    ...(!tags.length
      ? [el('small', { class: 'muted tag-group-empty' }, t('点击 ＋ 新建标签'))]
      : []),
  );
  $('tags-nav').scrollTop = tagScrollTop;
  $('tag-filter').replaceChildren(
    option('', t('全部标签')),
    ...tags.map((tag) => option(tag, tag, tag === state.tag)),
  );
  $('project-membership-filter').hidden = state.view !== 'organized' || !!state.project;
  $('project-membership-filter').value = state.projectMembership;
  $('result-count').textContent = msg`${results.items.length}${results.hasMore ? '+' : ''} 条记录`;
  $('load-more').hidden = !results.hasMore;
  $('project-actions').replaceChildren();
  if (p) {
    $('project-actions').append(
      button(
        t('关系图'),
        act(() => openProjectGraph(p.id)),
        'button small',
      ),
      button(
        t('新建子项目'),
        act(() => openProject(null, p.id)),
        'button small',
      ),
      button(
        t('编辑项目'),
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
  const shortcut = $('examples-shortcut');
  shortcut.hidden = !visible;
  if (visible)
    shortcut.textContent = examples.length
      ? msg`查看 ${examples.length} 条内置示例`
      : t('查看内置示例');
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
        t('重试加载示例'),
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
      msg`内置示例 · ${examples.length} 条`,
    ),
  );
  const grid = el('div', { class: 'example-grid' });
  for (const example of examples)
    grid.append(
      el(
        'article',
        { class: 'example-card' },
        el('span', { class: 'example-badge' }, t('内置示例 · 只读预览')),
        el('h3', {}, example.title),
        el('p', { class: 'description' }, example.description),
        el(
          'button',
          {
            type: 'button',
            class: 'button small',
            'aria-label': msg`查看示例：${example.title}`,
            onclick: act(() => openExample(example)),
          },
          t('打开示例'),
        ),
      ),
    );
  details.append(
    el(
      'p',
      { class: 'description' },
      t('示例随扩展离线提供，预览不参与同步。点击保存后成为你的普通记录，并使用当前同步设置。'),
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
                msg`已加入 ${result.saved} 条示例到收件箱；${result.existing} 条已保存过，保留原有内容。`,
              );
            } finally {
              state.examplesSaving = false;
              refreshSoon();
            }
          }),
        },
        state.examplesSaving ? t('正在加入…') : t('全部加入我的收件箱'),
      ),
      el('small', { class: 'muted' }, t('加入后可编辑，并按当前设置同步；已保存过的示例会跳过。')),
    ),
    button(
      t('隐藏内置示例'),
      act(async () => {
        await db.setState(EXAMPLES_VISIBLE, false);
        toast(t('已隐藏内置示例，可在设置与数据管理中恢复。'));
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
  const { dialog, body, footer } = modal(t('内置示例：') + example.title, {
    wide: true,
    onClose: () => {
      preview?.querySelectorAll('.markdown').forEach((view) => view.dispose?.());
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
        el('span', { class: 'muted' }, t('来源：')),
        el(
          'a',
          { href: safeUrl(source.url), target: '_blank', rel: 'noopener noreferrer' },
          source.title || source.url,
        ),
      ),
    );
  body.append(preview);
  const save = button(
    t('保存到我的收件箱'),
    async () => {
      save.disabled = true;
      try {
        const result = await saveExample(db, example);
        if (result.status === 'already-saved') {
          toast(t('此示例已保存过；已有的修改和删除状态保持不变。'));
          save.textContent = t('已保存过此示例');
        } else {
          state.examplesExpanded = false;
          dialog.close();
          toast(t('示例已保存到你的收件箱，可编辑并按当前设置同步。'));
        }
      } catch (error) {
        toast(error.message, true);
        save.disabled = false;
      }
    },
    'button primary',
  );
  footer.append(
    el('small', { class: 'muted' }, t('保存前为只读预览；图片和测试录音来自已验证的演示数据。')),
    button(t('关闭'), () => dialog.close()),
    save,
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
            t('知道了'),
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
        el('h3', {}, msg`${state.captures.length} 条收集等待处理`),
        t('发现重复或相关内容，原文已保留在本机。'),
        el(
          'div',
          { class: 'row' },
          button(
            t('查看重复提示'),
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
        el('h3', {}, msg`${state.conflicts.length} 条同步冲突`),
        t('浏览器和云端版本都已保留。选择版本后同步下载以应用选择，需保留浏览器版本时再同步上传。'),
        el(
          'div',
          { class: 'row' },
          button(
            t('处理冲突'),
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
        throw new Error(t('没有识别到可移动的记录。'));
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
    throw new Error(t('请填写 1–100 字的标签名称，不含逗号或换行。'));
  await navigator.locks.request('pkm-nexus:tag-groups', async () => {
    const groups = await db.getState(TAG_GROUPS, []);
    if (!groups.includes(name)) await db.setState(TAG_GROUPS, [...groups, name]);
  });
  return name;
}
async function availableEditorTags() {
  const [groups, catalog] = await Promise.all([db.getState(TAG_GROUPS, []), db.allCatalog()]);
  return [
    ...new Set([
      ...groups,
      ...catalog.filter((item) => !item.deleted_at).flatMap((item) => item.tags || []),
    ]),
  ];
}
function openTagGroup() {
  const { dialog, body, footer } = modal(t('新建标签'));
  const input = textInput('', { maxlength: 100, placeholder: t('例如：工作、学习、待读') });
  body.append(field(t('标签名称'), input, t('已有标签也会自动显示在标签列表中。')));
  const create = act(async () => {
    const tag = await addTagGroup(input.value);
    dialog.close();
    setView('all');
    state.tag = tag;
    persistView();
    toast(msg`已新建标签“${tag}”，可拖入记录。`);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      create();
    }
  });
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(t('新建标签'), create, 'button primary'),
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
        throw new Error(t('这条记录不能移动，请重新选择。'));
      return { ...record, organization_state: organization, updated_at: new Date().toISOString() };
    });
  state.selected.clear();
  refreshSoon();
  toast(organization === 'organized' ? t('已标记为已整理。') : t('已移回收件箱。'));
}
async function moveToTagGroup(ids, tag) {
  for (const id of ids)
    await db.mutate(id, (record) => {
      if (record.deleted_at || record.kind === 'tombstone' || record.type === 'project')
        throw new Error(t('这条记录不能移动，请重新选择。'));
      return {
        ...record,
        tags: [...new Set([...record.tags, tag])],
        organization_state: 'organized',
        updated_at: new Date().toISOString(),
      };
    });
  state.selected.clear();
  refreshSoon();
  toast(msg`已移动到“${tag}”并标记已整理。`);
}
function openMove(ids) {
  const sourceTag = state.tag;
  const { dialog, body, footer } = modal(t('移动记录'));
  const target = el(
    'select',
    { 'aria-label': t('移动目标') },
    option('inbox', t('收件箱')),
    option('organized', t('已整理')),
    ...state.tagGroups.map((tag) => option(`tag:${tag}`, msg`标签 · ${tag}`)),
    option('new', t('＋ 新建标签…')),
  );
  target.value = state.tagGroups.length ? `tag:${state.tagGroups[0]}` : 'organized';
  const name = textInput('', {
    maxlength: 100,
    placeholder: t('新标签名称'),
    'aria-label': t('新标签名称'),
  });
  const nameField = field(t('新标签名称'), name);
  nameField.hidden = true;
  target.addEventListener('change', () => {
    nameField.hidden = target.value !== 'new';
    if (!nameField.hidden) name.focus();
  });
  body.append(
    field(msg`移动 ${ids.length} 条记录到`, target),
    nameField,
    el(
      'p',
      { class: 'description' },
      t('添加标签并标记已整理，保留已有标签。标签之间没有父子层级。'),
    ),
  );
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('移动'),
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
  toast(t('已加入项目，保留原有标签和整理状态。'));
}
async function openProjectAssignment(ids) {
  const projects = (await db.allCatalog()).filter(
    (record) => record.type === 'project' && !record.deleted_at,
  );
  const { dialog, body, footer } = modal(t('加入项目'));
  const choices = projectTree(projects).map((project) => ({
    id: project.id,
    ...check(project.breadcrumb),
  }));
  body.append(
    el(
      'p',
      { class: 'description' },
      t('可加入多个项目，保留已有项目关联、标签与整理状态。加入子项目不会自动加入父项目。'),
    ),
    ...choices.map((choice) => choice.label),
    ...(!choices.length ? [el('p', { class: 'muted' }, t('还没有项目，请先新建。'))] : []),
  );
  footer.append(
    button(
      t('新建项目'),
      act(() => openProject()),
    ),
    button(t('取消'), () => dialog.close()),
    button(
      t('加入项目'),
      act(async () => {
        const selected = choices
          .filter((choice) => choice.input.checked)
          .map((choice) => choice.id);
        if (!selected.length) throw new Error(t('请选择至少一个项目。'));
        await addToProjects(ids, selected);
        dialog.close();
      }),
      'button primary',
    ),
  );
}
async function togglePin(id) {
  await togglePinnedRecord(db, id);
}
function renderSelection() {
  const ids = [...state.selected];
  $('selection-bar').hidden = !ids.length;
  const selectable = state.items.filter((m) => m.type !== 'list');
  $('select-all').checked =
    !!selectable.length && selectable.every((m) => state.selected.has(m.id));
  $('selection-bar').replaceChildren(
    el('span', {}, msg`已选 ${ids.length} 条`),
    ...(state.view === 'trash'
      ? [
          button(
            t('批量还原'),
            act(async () => {
              for (const id of ids) await db.restore(id);
              state.selected.clear();
              refreshSoon();
              toast(t('已还原到本机，等待同步。'));
            }),
            'button small',
          ),
        ]
      : [
          button(
            t('标记已整理'),
            act(async () => {
              for (const id of ids)
                await db.mutate(id, (r) => ({
                  ...r,
                  organization_state: 'organized',
                  updated_at: new Date().toISOString(),
                }));
              state.selected.clear();
              refreshSoon();
              toast(t('已整理，等待同步。'));
            }),
            'button small',
          ),
          button(t('添加标签'), () => bulkTags(ids), 'button small'),
          button(t('移动到…'), () => openMove(ids), 'button small'),
          button(
            t('加入项目…'),
            act(() => openProjectAssignment(ids)),
            'button small',
          ),
          button(
            t('移回收件箱'),
            act(() => setOrganization(ids, 'inbox')),
            'button small',
          ),
          ids.length === 2
            ? button(
                t('合并两条'),
                act(() => openMerge(ids[0], ids[1])),
                'button small',
              )
            : null,
          button(
            t('移入回收站'),
            () =>
              confirmAction(
                t('将所选记录移入回收站？'),
                t('记录可以还原，下一次同步时才传播删除状态。'),
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
      t('取消选择'),
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
  const websiteScrollPositions = new Map(
    [...$('records').querySelectorAll('[data-record-id]')].map((card) => [
      card.dataset.recordId,
      card.querySelector('.website-card-list')?.scrollTop || 0,
    ]),
  );
  $('records')
    .querySelectorAll('.asset-view')
    .forEach((view) => view.dispose?.());
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
            ? t('没有匹配的记录')
            : state.view === 'inbox'
              ? t('给下一次灵感留个位置')
              : t('这里还没有记录'),
        ),
        el(
          'p',
          {},
          panel
            ? t('选择网页文字，右键或按 Alt + Shift + S。\n也可以在上方直接写一条。')
            : state.view === 'inbox'
              ? t('选择网页文字，右键保存，或按 Alt + Shift + S。\n每一条新收集都会先来到这里。')
              : t('试试其他筛选条件，或新建一条记录。'),
        ),
        !panel && !['trash', 'duplicates'].includes(state.view)
          ? button(
              t('＋ 新建记录'),
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
            el('h2', {}, t('删除标记')),
            el('p', {}, msg`记录 ${m.id} 的正文已移除，等待同步删除状态。`),
          ),
        );
      const selected = el('input', {
        type: 'checkbox',
        disabled: m.type === 'list',
        checked: state.selected.has(m.id),
        'aria-label': msg`选择 ${m.type === 'list' ? 'Todo / Idea' : m.title || t('未命名记录')}`,
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
          'aria-label': msg`打开 ${m.type === 'list' ? 'Todo / Idea' : m.title || t('未命名记录')}`,
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
          el('h2', {}, m.type === 'list' ? 'Todo / Idea' : m.title || t('未命名记录')),
          el('span', { class: 'badge' }, t(displayType(m.type))),
          m.type === 'website_group' && !m.deleted_at
            ? el(
                'button',
                {
                  type: 'button',
                  class: 'record-drag-handle',
                  draggable: true,
                  'aria-label': msg`拖动整个网页组 ${m.title || t('未命名记录')}`,
                  title: t('拖到标签或项目，移动整个网页组'),
                  onclick: (event) => {
                    event.stopPropagation();
                    openMove([m.id]);
                  },
                },
                t('⠿ 整组'),
              )
            : null,
          !m.deleted_at && (m.type === 'list' || state.pinnedIds.includes(m.id))
            ? el(
                'span',
                { class: 'badge pinned-badge' },
                m.type === 'list' ? t('固定置顶') : t('已置顶'),
              )
            : null,
          m.organization_state === 'organized' ? el('span', { class: 'badge' }, t('已整理')) : null,
          m.dirty ? el('span', { class: 'badge pending' }, t('待同步')) : null,
          m.task_status ? el('span', { class: 'badge' }, t(TASK_STATUSES[m.task_status])) : null,
          ...(m.type !== 'snapshot' && (m.attachments || []).some((a) => a.kind !== 'snapshot')
            ? [
                el(
                  'span',
                  { class: 'badge' },
                  msg`${m.attachments.filter((a) => a.kind === 'image').length} 图片 · ${m.attachments.filter((a) => a.kind === 'audio').length} 音频`,
                  m.attachments.some((a) => a.storage === 'drive')
                    ? msg` · ${m.attachments.filter((a) => a.storage === 'drive').length} 个文件`
                    : '',
                ),
              ]
            : []),
        ),
        m.summary || !['list', 'snapshot', 'website_group'].includes(m.type)
          ? el(
              'p',
              { class: 'record-summary' },
              m.summary || (m.type === 'project' ? t('项目文件夹') : t('尚未补充正文')),
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
          websiteScrollTop: websiteScrollPositions.get(m.id) || 0,
          moveWebsite: !m.deleted_at ? act((id) => openWebsiteMove(m.id, id)) : null,
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
                  t('还原'),
                  act(async () => {
                    await db.restore(m.id);
                    toast(t('已还原到本机。'));
                  }),
                  'button small',
                ),
                button(
                  t('移除正文'),
                  () =>
                    confirmAction(
                      t('移除当前正文？'),
                      t(
                        '此操作不能从回收站还原。保留最小删除标记防止旧电脑复活；其他设备和已有备份仍可能保留内容。',
                      ),
                      async () => {
                        await db.purge(m.id);
                        toast(t('当前正文已移除，等待同步。'));
                      },
                    ),
                  'button small danger',
                ),
              ]
            : [
                button(
                  m.favorite ? t('★ 已喜爱') : t('☆ 喜爱'),
                  act(() => toggleFavorite(m.id)),
                  'button small',
                ),
                button(
                  state.pinnedIds.includes(m.id) ? t('取消置顶') : t('置顶'),
                  act(() => togglePin(m.id)),
                  'button small',
                ),
                button(
                  m.organization_state === 'organized' ? t('移回收件箱') : t('标记已整理'),
                  act(() =>
                    setOrganization(
                      [m.id],
                      m.organization_state === 'organized' ? 'inbox' : 'organized',
                    ),
                  ),
                  'button small',
                ),
                button(t('移动到…'), () => openMove([m.id]), 'button small'),
                button(
                  t('加入项目…'),
                  act(() => openProjectAssignment([m.id])),
                  'button small',
                ),
                button(
                  t('管理项目…'),
                  act(() => openProjectMemberships(m.id)),
                  'button small',
                ),
                state.view === 'duplicates'
                  ? button(
                      t('合并…'),
                      act(() => openMerge(m.id)),
                      'button small',
                    )
                  : null,
                button(
                  '⌫',
                  act(async () => {
                    await db.trash(m.id);
                    toast(t('已移入回收站，可还原。'));
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
        // Chromium can target the draggable article even when the gesture began on its link.
        if (recordDragOrigin?.groupId === m.id) {
          const item = m.url_preview?.find((item) => item.id === recordDragOrigin.itemId);
          if (!item || item.removed_at || m.deleted_at) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          event.dataTransfer.clearData();
          event.dataTransfer.setData(WEBSITE_DRAG_TYPE, JSON.stringify(recordDragOrigin));
          event.dataTransfer.effectAllowed = 'move';
          return;
        }
        if (
          (event.target.closest('a, input, button, textarea, select') &&
            !event.target.closest('.record-drag-handle')) ||
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
          if ([...e.dataTransfer.types].includes('application/x-pkm-tag')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = [...e.dataTransfer.types].some((type) =>
            [WEBSITE_DRAG_TYPE, RECORD_DRAG_TYPE].includes(type),
          )
            ? 'move'
            : 'copy';
          card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          card.classList.remove('drag-over');
          if ([...e.dataTransfer.types].includes(RECORD_DRAG_TYPE)) {
            const raw = e.dataTransfer.getData(RECORD_DRAG_TYPE);
            act(async () => {
              const result = await moveWebsiteGroups(db, JSON.parse(raw).ids, m.id);
              toast(
                result.moved
                  ? msg`已并入 ${result.moved} 个网页，重复网址合并。来源组的文字、标签和项目关系仍保留。`
                  : t('没有需要并入的网页。'),
              );
            })();
            return;
          }
          if ([...e.dataTransfer.types].includes(WEBSITE_DRAG_TYPE)) {
            const raw = e.dataTransfer.getData(WEBSITE_DRAG_TYPE);
            act(async () => {
              const { groupId, itemId } = readWebsiteDrag({ getData: () => raw });
              await moveWebsite(db, groupId, m.id, itemId);
              toast(t('已移动网页，已读状态保留。'));
            })();
            return;
          }
          const data = Object.fromEntries(
            ['application/x-pkm-tab', 'text/uri-list', 'text/plain', 'text/html'].map((key) => [
              key,
              e.dataTransfer.getData(key),
            ]),
          );
          toast(t('正在读取网页标题…'));
          act(async () => {
            const dropped = await droppedWebsites({ getData: (key) => data[key] || '' });
            if (!dropped.items.length) return;
            const saved = await appendWebsites(db, m.id, dropped.items);
            const close = document.querySelector('[name=close_tabs]');
            const result =
              !close || close.checked
                ? await closeCapturedTabs(dropped.tabs, saved.record)
                : { closed: [] };
            toast(msg`已加入网页组并关闭 ${result.closed.length} 个标签页。`);
          })();
        });
      }
      return card;
    }),
  );
}

async function openWebsiteMove(sourceId, itemId) {
  const targets = (await db.allCatalog()).filter(
    (row) => row.type === 'website_group' && !row.deleted_at && row.id !== sourceId,
  );
  if (!targets.length) {
    toast(t('请先新建另一个网页组。'));
    return;
  }
  const { dialog, body, footer } = modal(t('移动单个网页'));
  const select = el(
    'select',
    { 'aria-label': t('目标网页组') },
    ...targets.map((row) => option(row.id, row.title || t('未命名网页组'))),
  );
  body.append(
    el(
      'p',
      { class: 'description' },
      t('只移动这个网页，保留已读状态。目标组已有相同网址时合并。'),
    ),
    field(t('目标网页组'), select),
  );
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('移动网页'),
      act(async () => {
        await moveWebsite(db, sourceId, select.value, itemId);
        dialog.close();
        toast(t('已移动网页。'));
      }),
      'button primary',
    ),
  );
}

function confirmAction(title, message, fn) {
  const { dialog, body, footer } = modal(title);
  body.append(el('p', { class: 'description' }, message));
  const submit = button(
    t('确认'),
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
    button(t('取消'), () => dialog.close()),
    submit,
  );
}
function bulkTags(ids) {
  const { dialog, body, footer } = modal(t('批量添加标签'));
  const input = textInput('', { placeholder: t('用逗号分隔，如：学习, 待阅读') });
  body.append(field(msg`添加到 ${ids.length} 条记录`, input, t('保留每条记录已有的标签。')));
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('添加标签'),
      act(async () => {
        const tags = splitTags(input.value);
        if (!tags.length) throw new Error(t('请填写标签。'));
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
  if (id && (!row || row.record.kind === 'tombstone')) throw new Error(t('记录不存在。'));
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
  let result;
  if (row?.rev) {
    await db.save(value, { expectedRev: row.rev });
    result = { status: 'saved' };
  } else if (value.type === 'list') {
    await db.save(value, { expectedRev: 0 });
    result = { status: 'saved' };
  } else result = await captureInto(db, value);
  if (
    result.status === 'saved' &&
    [...value.attachments, ...(row?.record.attachments || [])].some((a) => a.storage === 'drive')
  ) {
    try {
      const response = await driveCommand('sync', { direction: 'upload', recordIds: [value.id] });
      if (response.conflicts || response.missingRemote)
        throw new Error(t('附件关联存在云端冲突，请在设置中处理后重新同步。'));
      result.attachmentsSynced = true;
    } catch (error) {
      result.syncError = error.message;
    }
  }
  return result;
}
async function openRecord(id) {
  const row = await db.get(id);
  if (!row || row.record.kind === 'tombstone') throw new Error(t('记录已不存在。'));
  let preview;
  const { dialog, body, footer } = modal(t('预览记录'), {
    wide: true,
    onClose: () => preview?.dispose?.(),
  });
  preview = await recordPreview(db, row.record, {
    onChanged: refreshSoon,
    onMoveWebsite: act((itemId) => openWebsiteMove(row.id, itemId)),
  });
  body.append(preview);
  footer.append(
    button(
      row.record.favorite ? t('★ 已喜爱') : t('☆ 喜爱'),
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
                  t('简单修改 · Markdown'),
                  act(() => openEditor(id, { simple: true })),
                ),
              ]
            : []),
          button(
            row.record.type === 'note' ? t('完整修改') : t('修改记录'),
            act(() => openEditor(id)),
          ),
        ]),
    button(t('关闭'), () => dialog.close()),
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
  if (!tag) throw new Error(t('请先新建标签。'));
  const styles = await db.getState('ui:tag-styles', {});
  const { dialog, body, footer } = modal(t('标签外观'));
  const selected = el('div', {
    class: 'tag-cloud tag-choices',
    role: 'group',
    'aria-label': t('选择标签'),
  });
  const name = textInput(tag, { maxlength: 100, 'aria-label': t('标签名称') });
  const color = colorControl(styles[tag]?.color || '#285f49', t('标签颜色'));
  const description = textarea(styles[tag]?.description || '', {
    rows: 3,
    maxlength: 2000,
    'aria-label': t('标签描述'),
    placeholder: t('这个标签用于哪些内容？'),
  });
  for (const value of state.tagGroups) {
    const choice = button(
      value,
      () => {
        tag = value;
        name.value = value;
        color.value = styles[value]?.color || '#285f49';
        description.value = styles[value]?.description || '';
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
  body.append(
    selected,
    field(t('标签名称'), name),
    field(t('标签描述'), description),
    field(t('颜色'), color.root),
  );
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('保存外观'),
      act(async () => {
        await db.renameTag(tag, name.value, color.value, description.value);
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
  const { dialog, body, footer } = modal(data.row?.rev ? t('编辑记录') : t('新建记录'), {
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
    availableTags: await availableEditorTags(),
    onCreateTag: addTagGroup,
    draftUi: { ...data.draftUi, previewing: false },
    simple,
    panel: false,
    onSave: saveEditorRecord,
    onNavigate: act(navigate),
    onCancel: async (result) => {
      if (result?.saved) toast(result.message || t('已保存到本机，等待同步。'));
      dialog.close();
      refreshSoon();
    },
  });
  body.append(editor.root);
  footer.append(
    el(
      'span',
      { class: 'hint' },
      data.row ? msg`原 ID ${data.row.id.slice(0, 8)}` : t('保存后才进入收件箱'),
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
    if (editor?.recording) throw new Error(t('请先停止当前录音。'));
    await editor?.flush();
    editor?.destroy();
    editor = createEditor(db, {
      ...data,
      availableTags: await availableEditorTags(),
      onCreateTag: addTagGroup,
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
        if (result?.saved) toast(result.message || t('已保存到本机，等待同步。'));
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
          ? t('已追加到 collected；图片已嵌入在线地址，离线查看需先保存原图。')
          : t('已追加到 collected，确认后再保存。'),
      );
    }
  });
}

async function openDuplicates(captureId) {
  const captures = await db.captures(),
    capture = captures.find((c) => c.id === captureId) || captures[0];
  if (!capture) return;
  const matches = await db.duplicates(capture.record);
  const { dialog, body, footer } = modal(t('重复与相关内容'));
  body.append(
    el('h3', {}, capture.record.title || t('待处理收集')),
    el(
      'p',
      { class: 'description' },
      capture.record.content.slice(0, 500) || capture.record.sources[0]?.url || t('仅链接'),
    ),
    el(
      'p',
      { class: 'description' },
      t('你的这次收集已经留在本机。选择追加、另存或取消，系统不会自动合并。'),
    ),
  );
  const choices = el('div', { class: 'records' });
  let selectedId = matches[0]?.id;
  const labels = {
    exact: t('内容重复'),
    related: t('同页不同内容'),
    similar: t('不同来源、内容相同'),
  };
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
          el('strong', {}, match.title || t('未命名记录')),
          el('span', { class: 'badge' }, labels[match.match]),
          match.deleted_at ? el('span', { class: 'badge pending' }, t('在回收站')) : null,
        ),
        el('p', { class: 'description' }, match.summary || t('只有链接')),
        button(
          t('查看已有记录'),
          act(() => openEditor(match.id)),
          'link-button',
        ),
      ),
    );
  }
  if (!matches.length)
    choices.append(el('p', { class: 'description' }, t('当前没有重复候选，可以另存为新记录。')));
  body.append(choices);
  const finish = async (fn) => {
    await fn();
    dialog.close();
    chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
    toast(t('这条收集已处理。'));
  };
  footer.append(
    button(
      t('取消这次收集'),
      act(() => finish(() => db.dismissCapture(capture.id))),
      'button',
    ),
    matches.length
      ? button(
          matches.some((m) => m.deleted_at) ? t('追加（必要时还原）') : t('追加到所选记录'),
          act(() => finish(() => appendCapture(db, selectedId, capture))),
          'button',
        )
      : null,
    button(
      t('仍然另存一条'),
      act(() => finish(() => db.finishCapture(capture.id, capture.record, 0))),
      'button primary',
    ),
  );
}
async function openMerge(sourceId, selectedTarget) {
  const source = await db.get(sourceId);
  if (!source) throw new Error(t('记录不存在。'));
  const matches = selectedTarget
    ? [await db.get(selectedTarget)].filter(Boolean).map((row) => ({
        id: row.id,
        title: row.record.title,
        summary: row.record.summary || row.record.content.slice(0, 160),
      }))
    : await db.duplicates(source.record);
  if (!matches.length) throw new Error(t('没有可合并的候选。可在列表选择两条记录手动合并。'));
  const { dialog, body, footer } = modal(t('合并已有记录'));
  let target = await db.get(matches[0].id);
  body.append(
    el(
      'p',
      { class: 'description' },
      msg`将“${source.record.title || t('未命名记录')}”合并到所选记录。合并正文、附件、标签、项目和来源；来源记录保留在回收站中，可恢复。目标保留自己的类型与待办状态。`,
    ),
  );
  const select = el(
      'select',
      {},
      ...matches.map((m) =>
        option(m.id, m.type === 'list' ? 'Todo / Idea' : m.title || t('未命名记录')),
      ),
    ),
    targetPreview = el('pre', { class: 'preview-list' }),
    scopeHint = el('p', { class: 'description' });
  function showTarget() {
    targetPreview.textContent = target.record.content || t('（没有正文）');
    scopeHint.textContent = target.record.deleted_at
      ? t('目标在回收站：合并时会明确还原到正常记录。')
      : t('合并先保存在本机，等待同步。');
  }
  select.addEventListener(
    'change',
    act(async () => {
      target = await db.get(select.value);
      if (!target) throw new Error(t('目标已不存在。'));
      showTarget();
    }),
  );
  showTarget();
  body.append(
    field(t('合并到'), select),
    el(
      'div',
      { class: 'conflict-columns' },
      el(
        'div',
        { class: 'version' },
        el('h4', {}, t('来源记录正文')),
        el('pre', {}, source.record.content || t('（没有正文）')),
      ),
      el('div', { class: 'version' }, el('h4', {}, t('目标记录正文')), targetPreview),
    ),
    scopeHint,
  );
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('合并并保留来源到回收站'),
      act(async () => {
        await db.mergeRecords(source.id, target.id, source.rev, target.rev);
        dialog.close();
        state.selected.clear();
        toast(t('已合并到本机，来源记录保留在回收站。'));
      }),
      'button primary',
    ),
  );
}

async function openProject(id, parentId = null, { parentDialog = null, onReturn } = {}) {
  const row = id ? await db.get(id) : null;
  if (id && !row) throw new Error(t('项目不存在。'));
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
  const { dialog, body, footer } = modal(id ? t('编辑项目') : t('新建项目'), {
    parent: parentDialog,
    onClose: onReturn,
  });
  const name = textInput(record.title, { maxlength: '500', placeholder: t('例如：论文研究') });
  const description = textarea(record.summary || '', {
    rows: 4,
    maxlength: 2000,
    'aria-label': t('项目描述'),
    placeholder: t('这个项目要完成什么？这些资料有什么用途？'),
  });
  const color = colorControl(record.appearance?.color || '#285f49', t('项目颜色'));
  const symbol = iconChoices(record.appearance?.icon || '📁');
  const parent = el(
    'select',
    { 'aria-label': t('父项目') },
    option('', t('顶层项目'), !record.parent_project_id),
    ...projects
      .filter((p) => p.id !== id)
      .map((p) => option(p.id, p.breadcrumb, p.id === record.parent_project_id)),
  );
  body.append(
    field(t('项目名称'), name),
    field(t('项目描述'), description),
    field(t('父项目'), parent),
    field(t('颜色'), color.root),
    field(t('图标'), symbol.root),
    el(
      'p',
      { class: 'description' },
      t('项目可包含子项目；每条记录可属于多个项目。关系图只连接当前层的记录与子项目节点。'),
    ),
  );
  footer.append(
    id && !record.deleted_at
      ? button(
          t('移入回收站'),
          act(async () => {
            await db.trash(id);
            dialog.close();
          }),
          'button danger',
        )
      : null,
    button(t('取消'), () => dialog.close()),
    button(
      t('保存项目'),
      act(async () => {
        if (!name.value.trim()) throw new Error(t('请填写项目名称。'));
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
        toast(t('项目已保存。'));
      }),
      'button primary',
    ),
  );
}
async function openProjectGraph(id) {
  const row = await db.get(id);
  if (!row || row.record.deleted_at) throw new Error(t('项目不存在。'));
  let graph;
  const { dialog, body, footer } = modal(t('项目关系图 · ') + row.record.title, {
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
  const fullscreen = button(t('全屏'), () => {
    dialog.classList.toggle('graph-fullscreen');
    fullscreen.textContent = dialog.classList.contains('graph-fullscreen')
      ? t('退出全屏')
      : t('全屏');
  });
  footer.append(
    fullscreen,
    button(t('关闭'), () => dialog.close()),
  );
}
async function openProjectMemberships(id) {
  const row = await db.get(id);
  if (!row) throw new Error(t('记录不存在。'));
  const projects = projectTree((await db.allCatalog()).filter(activeProject));
  const { dialog, body, footer } = modal(t('管理项目归属'));
  const choices = projects.map((p) => ({
    id: p.id,
    ...check(p.breadcrumb, row.record.project_ids.includes(p.id)),
  }));
  body.append(
    el('p', {}, t('可选择多个项目。取消某项目会同时删除该记录在该项目内的连线。')),
    ...choices.map((c) => c.label),
  );
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('保存归属'),
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

async function openConflict() {
  const conflicts = await db.getState('drive:conflicts', []);
  const { dialog, body, footer } = modal(t('选择要保留的记录版本'));
  for (const conflict of conflicts) {
    const local = await db.syncRow(conflict.id);
    const section = el(
      'section',
      { class: 'settings-section' },
      el('h3', {}, conflict.title || conflict.id),
    );
    const choose = (choice) =>
      act(async () => {
        await driveCommand('resolve', { id: conflict.id, choice });
        dialog.close();
        await syncNow('download');
        if (choice === 'local') toast(t('已保留浏览器版本，请点击同步上传更新云端。'));
      });
    if (local)
      section.append(
        el('h4', {}, t('浏览器版本')),
        el('pre', { class: 'conflict-preview' }, JSON.stringify(local.record, null, 2)),
        button(t('保留浏览器版本'), choose('local')),
      );
    for (const variant of conflict.variants)
      section.append(
        el('h4', {}, t('云端版本')),
        el('pre', { class: 'conflict-preview' }, JSON.stringify(variant.record, null, 2)),
        button(t('使用此云端版本'), choose(variant.hash)),
      );
    body.append(section);
  }
  footer.append(button(t('关闭'), () => dialog.close()));
}
async function syncNow(direction = 'upload') {
  if (state.busy) return;
  const { driveAccount } = await readConfig();
  if (!driveAccount || !(await db.getState('drive:binding'))) {
    if (panel) await openDashboard('#settings');
    else await openSettings();
    return;
  }
  state.busy = true;
  state.progress =
    direction === 'download' ? t('正在从 Google Drive 下载…') : t('正在上传到 Google Drive…');
  await refresh();
  try {
    const result = await driveCommand('sync', { direction });
    toast(
      msg`${direction === 'download' ? t('下载') : t('上传')}完成：${direction === 'download' ? result.downloaded : result.uploaded} 条记录${metadataSyncStatus(result, direction)}，${result.conflicts} 条冲突。${direction === 'download' && result.recordsCached ? msg`复用 ${result.recordsCached} 个未变化文件的缓存。` : ''}${result.missingRemote ? t('云端有文件被移除，浏览器版本仍保留；请检查所选文件夹。') : ''}`,
    );
  } finally {
    state.busy = false;
    state.progress = '';
    await refresh();
  }
}
async function openTheme() {
  const editor = await themeEditor();
  const { dialog, body, footer } = modal(t('主题与字体'), { onClose: () => editor.dispose() });
  body.append(editor.root);
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('保存主题'),
      act(async () => {
        await editor.save();
        dialog.close();
      }),
      'button primary',
    ),
  );
}
async function openSettings() {
  const { dialog, body, footer } = modal(t('设置与数据管理'));
  dialog.classList.add('settings-dialog');
  body.classList.add('settings-layout');
  body.append(
    el(
      'div',
      { class: 'settings-intro' },
      el('p', { class: 'description' }, t('管理云端同步、本地备份与界面偏好。')),
      el('small', { class: 'muted' }, `${APP_NAME} v${chrome.runtime.getManifest().version}`),
    ),
    languageSettings({
      beforeApply: async () => {
        if (panelEditor?.recording) throw new Error(t('请先停止录音。'));
        await panelEditor?.flush();
      },
    }),
  );
  const appearanceButton = button(t('主题与字体'), act(openTheme));
  appearanceButton.id = 'theme';
  const appearanceSection = el(
    'section',
    { class: 'settings-section settings-half' },
    el('h3', {}, t('主题与字体')),
    el('p', { class: 'description' }, t('选择配色主题，调整各区域的字体与导航行距。')),
    appearanceButton,
  );
  body.append(appearanceSection, await driveSettings(db));
  const examplesHidden = el('input', {
    type: 'checkbox',
    checked: !(await db.getState(EXAMPLES_VISIBLE, true)),
    'aria-label': t('完全隐藏内置示例'),
  });
  examplesHidden.addEventListener(
    'change',
    act(async () => {
      examplesHidden.disabled = true;
      try {
        await db.setState(EXAMPLES_VISIBLE, !examplesHidden.checked);
        if (examplesHidden.checked) {
          examples = [];
          examplesError = '';
        }
        await refresh();
      } catch (error) {
        examplesHidden.checked = !examplesHidden.checked;
        throw error;
      } finally {
        examplesHidden.disabled = false;
      }
    }),
  );
  const examplesSection = el(
    'section',
    { class: 'settings-section settings-half' },
    el('h3', {}, t('内置示例')),
    el(
      'p',
      { class: 'description' },
      t('开启后隐藏收件箱样例及侧栏入口；已加入收件箱的个人记录不受影响。'),
    ),
    el('label', { class: 'checkbox-line' }, examplesHidden, t('完全隐藏内置示例')),
  );
  const websitesSection = el(
    'section',
    { class: 'settings-section' },
    el('h3', {}, t('网页访问权限')),
    el(
      'p',
      { class: 'description' },
      t(
        '捕获时可只允许当前网站。若需要跨网站捕获、页面截图或读取外部链接标题，可在这里允许所有网站访问；授权不会开启后台扫描。请使用下方按钮发起 Chrome 授权。',
      ),
    ),
  );
  const webStatus = el(
    'small',
    { class: 'muted' },
    (await chrome.permissions.contains({ origins: ['<all_urls>'] }))
      ? t('已允许网站访问。')
      : t('尚未允许所有网站访问。可在捕获界面单独授权网站，或使用下方按钮授权全部网站。'),
  );
  websitesSection.append(
    el(
      'div',
      { class: 'row' },
      button(t('允许所有网站访问'), async () => {
        try {
          webStatus.textContent = (await chrome.permissions.request({
            origins: ['<all_urls>'],
          }))
            ? t('已允许所有网站访问。')
            : t('未获得授权。可以重新点击授权，或在捕获界面只允许当前网站。');
        } catch (error) {
          webStatus.textContent = msg`网站授权失败：${error.message}`;
        }
      }),
      button(
        t('撤销额外网站访问'),
        async () => {
          try {
            await chrome.permissions.remove({ origins: ['<all_urls>'] });
            webStatus.textContent = t('已撤销额外网站访问。');
          } catch (error) {
            webStatus.textContent = msg`撤销权限失败：${error.message}`;
          }
        },
        'link-button',
      ),
    ),
    webStatus,
  );
  const dataSection = el(
    'section',
    { class: 'settings-section' },
    el('h3', {}, t('完整本地备份')),
    el(
      'p',
      { class: 'description' },
      t(
        '完整 ZIP 包含 JSON、Markdown、图片、音频、项目层级与关系图、回收站与草稿。JSON 单独导出仅包含数据和附件清单，不包含二进制附件。导出不包含 Google 授权凭证。',
      ),
    ),
  );
  const file = el('input', {
    type: 'file',
    accept: '.zip,.json,application/zip,application/json',
    hidden: true,
    'aria-label': t('选择 JSON 或 ZIP 备份'),
  });
  file.addEventListener(
    'change',
    act(async () => {
      const selected = file.files[0];
      if (!selected) return;
      if (selected.size > 512 * 1024 * 1024) throw new Error(t('备份超过 512 MB，请拆分后导入。'));
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
      button(t('导出备份（完整 ZIP）'), act(saveLocal)),
      button(
        t('导出 JSON'),
        act(async () => {
          const data = await db.exportData();
          download(
            `${EXPORT_PREFIX}-${new Date().toISOString().slice(0, 10)}.json`,
            JSON.stringify(data, null, 2),
          );
        }),
      ),
      button(t('导出 Markdown（含图片 ZIP）'), act(saveMarkdown)),
      button(t('导入 JSON / ZIP'), () => file.click()),
      file,
    ),
  );
  const storageInfo = el(
    'p',
    { class: 'description settings-storage' },
    t('正在读取本地存储信息…'),
  );
  const estimate = await navigator.storage.estimate();
  storageInfo.textContent = msg`本地存储约 ${((estimate.usage || 0) / 1024 / 1024).toFixed(2)} MB（浏览器估算，包含索引）。卸载扩展前请导出备份。`;
  const drafts = await db.drafts(),
    draftSection = el(
      'section',
      { class: 'settings-section settings-half' },
      el('h3', {}, t('本机未保存草稿')),
      el(
        'p',
        { class: 'description' },
        t(
          '旧版本编辑草稿不会覆盖最新记录。可继续编辑，或下载原始草稿；JSON 备份也会保留这些内容。',
        ),
      ),
    );
  if (!drafts.length)
    draftSection.append(el('small', { class: 'muted' }, t('目前没有未保存草稿。')));
  for (const draft of drafts)
    draftSection.append(
      el(
        'div',
        { class: 'row' },
        el('span', {}, draft.value.record?.title || draft.value.title || t('未命名草稿')),
        button(
          draft.value.record?.type === 'list' ? t('继续编辑清单') : t('恢复为新记录'),
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
          t('下载'),
          () => download(`${EXPORT_PREFIX}-draft.json`, JSON.stringify(draft, null, 2)),
          'link-button',
        ),
      ),
    );
  const recordings = await db.recordings(),
    recordingSection = el(
      'section',
      { class: 'settings-section settings-half' },
      el('h3', {}, t('未完成录音恢复')),
    );
  if (!recordings.some((r) => r.chunks))
    recordingSection.append(el('small', { class: 'muted' }, t('没有需要恢复的录音。')));
  for (const session of recordings.filter((r) => r.chunks))
    recordingSection.append(
      el(
        'div',
        { class: 'row' },
        el('span', {}, msg`录音 ${dateLabel(session.created_at)}`),
        button(
          t('恢复到收件箱'),
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
            toast(t('已恢复录音到收件箱。'));
          }),
          'button small',
        ),
      ),
    );
  body.append(
    dataSection,
    await startSettings(),
    examplesSection,
    await mascotSettings(),
    websitesSection,
    draftSection,
    recordingSection,
    storageInfo,
  );
  footer.append(button(t('关闭'), () => dialog.close()));
}
async function openImport(plan) {
  const counts = { new: 0, same: 0, changed: 0 };
  plan.entries.forEach((e) => counts[e.status]++);
  const { dialog, body, footer } = modal(t('导入预览'));
  const overwrite = check(t('更新相同 ID 但内容不同的记录（包含恢复或删除状态变化）'), false);
  body.append(
    el(
      'p',
      { class: 'description' },
      msg`新增 ${counts.new} 条 · 相同 ${counts.same} 条 · 内容不同 ${counts.changed} 条 · 待处理收集 ${plan.captures.length} 条 · 草稿 ${plan.drafts?.length || 0} 条${plan.tagLibrary ? msg` · 标签定义 ${plan.tagLibrary.definitions.length} 个` : ''}。默认保留本机已有差异，重复导入不会复制整个数据库。`,
    ),
    el(
      'div',
      { class: 'preview-list' },
      ...plan.entries
        .filter((e) => e.status !== 'same')
        .slice(0, 100)
        .map((e) =>
          el('div', {}, `${e.status === 'new' ? t('新增') : t('差异')} · ${titleOf(e.record)}`),
        ),
    ),
    overwrite.label,
    ...(plan.tagLibrary
      ? [
          el(
            'p',
            { class: 'description' },
            t(
              '标签描述与颜色一起导入。默认保留本机同名标签；勾选更新后，使用备份里的同名标签定义。',
            ),
          ),
        ]
      : []),
    el(
      'p',
      { class: 'description' },
      t(
        '导入只保存到浏览器，不自动上传。相同记录沿用原 ID，Google 登录和文件夹选择不会被备份覆盖。',
      ),
    ),
  );
  footer.append(
    button(t('取消'), () => dialog.close()),
    button(
      t('导入到本机'),
      act(async () => {
        const count = await db.applyImport(plan, overwrite.input.checked);
        await migrateTodos(db);
        dialog.close();
        toast(msg`已导入 ${count} 项变化。需要上传到云端时，请点击同步上传。`);
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
  const initialSort = sortPreference((await chrome.storage.local.get('recordSort')).recordSort);
  state.sortMode = initialSort.mode;
  state.sortDirection = initialSort.direction;
  if (saved && Object.hasOwn(VIEWS, saved.view)) {
    for (const key of [
      'view',
      'query',
      'tag',
      'type',
      'project',
      'projectMembership',
      'limit',
      'examplesExpanded',
      'cardModes',
      'sortMode',
      'sortDirection',
    ])
      if (saved[key] !== undefined) state[key] = saved[key];
    $('search').value = state.query;
  }
  if (!['', 'in-project', 'no-project'].includes(state.projectMembership))
    state.projectMembership = '';
  const checkedSort = sortPreference({ mode: state.sortMode, direction: state.sortDirection });
  state.sortMode = checkedSort.mode;
  state.sortDirection = checkedSort.direction;
  const params = new URLSearchParams(location.search);
  if (!panel && params.size) {
    if (Object.hasOwn(VIEWS, params.get('view'))) state.view = params.get('view');
    if (params.has('project')) {
      state.view = 'all';
      state.project = params.get('project');
      state.tag = '';
    }
    if (Object.hasOwn(TYPES, params.get('type'))) {
      state.view = 'all';
      state.type = params.get('type');
      state.project = '';
      state.tag = '';
    }
  }
  await migrateTodos(db);
  db.onChange((kind) => {
    if (kind !== 'draft') refreshSoon();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.driveAccount) refreshSoon();
  });
  if (await db.getState(EXAMPLES_VISIBLE, true)) await ensureExamplesLoaded();
  await setupPanel();
  await refresh();
  if (!panel && location.hash === '#settings') await openSettings();
  if (!panel && params.get('record')) {
    const row = await db.get(params.get('record'));
    if (row && !row.record.deleted_at && row.record.kind !== 'tombstone') {
      if (params.get('edit') === '1') await openEditor(row.id);
      else await openRecord(row.id);
    }
    history.replaceState(null, '', location.pathname + location.hash);
  }
  if (!panel && params.get('new') === 'list') await openList();
}
initialize().catch((error) => {
  $('records').replaceChildren(
    el('div', { class: 'notice' }, t('无法打开本地数据库：'), error.message),
  );
  toast(error.message, true);
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#settings') act(openSettings)();
});
// Record sync is manual, except saving a record with Drive file attachments.

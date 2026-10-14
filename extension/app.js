import {Database} from './lib/db.js';
import {newRecord, normalizeRecord, TYPES, LIST_ID,upgradeRecord,displayType, matchingProjects, duplicateIds, toMarkdown, safeUrl} from './lib/model.js';
import {captureInto, appendCapture} from './lib/capture.js';
import {readConfig, saveConfig, forgetToken, protectStorage} from './lib/config.js';
import {GitHub, validateConfig} from './lib/github.js';
import {synchronize, withSyncLock} from './lib/sync.js';
import {el, button, field, option, dateLabel, download, markdownPreview} from './lib/dom.js';
import {typedCard} from './lib/card.js';
import {createEditor} from './lib/editor.js';
import {singletonList,migrateTodos,appendWebsites} from './lib/collections.js';
import {droppedWebsites,closeCapturedTabs} from './lib/tabs.js';
import {buildLocalBackup,previewZipImport} from './lib/backup.js';

const db = new Database();
const panel = document.body.dataset.mode === 'panel';
const state = {view: 'inbox', query: '', tag: '', type: '', project: '', keyword: true, limit: panel ? 20 : 60, selected: new Set(), projects: [], captures: [], conflicts: [], items: [], busy: false, progress: '', generation: 0};
const $ = id => document.getElementById(id);
let toastTimer, refreshTimer, activeDialog,panelEditor;
function toast(text, error = false) { const node = $('toast'); node.textContent = text; node.className = `visible${error ? ' error' : ''}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.className = ''; }, error ? 9000 : 4500); }
const act = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(error => toast(error.message || '操作失败，请重试。', true));
function refreshSoon(delay = 100) { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(error => toast(error.message, true)), delay); }
function openDashboard(hash = '') { return chrome.tabs.create({url: chrome.runtime.getURL(`dashboard.html${hash}`)}); }
function modal(title, {wide = false, onClose} = {}) {
  if (activeDialog?.open) activeDialog.close();
  const dialog = el('dialog', {class: wide ? 'wide' : '', 'aria-label': title});
  const body = el('div', {class: 'dialog-body'}), footer = el('div', {class: 'dialog-footer'});
  dialog.append(el('div', {class: 'dialog-header'}, el('h2', {}, title), button('×', () => dialog.close(), 'icon-button')), body, footer);
  dialog.addEventListener('close', () => { onClose?.(); dialog.remove(); if (activeDialog === dialog) activeDialog = null; });
  document.body.append(dialog); dialog.showModal(); activeDialog = dialog;
  return {dialog, body, footer};
}
function splitTags(value) { return [...new Set(value.split(/[,，\n]/).map(v => v.trim()).filter(Boolean))]; }
function textInput(value = '', attrs = {}) { return el('input', {type: 'text', value, ...attrs}); }
function textarea(value = '', attrs = {}) { const node = el('textarea', attrs); node.value = value; return node; }
function check(label, checked = false, attrs = {}) { const input = el('input', {type: 'checkbox', checked, ...attrs}); return {input, label: el('label', {class: 'checkbox-line'}, input, label)}; }
function titleOf(record) { return record.type==='list'?'Todo / Idea':record.kind === 'tombstone' ? '已移除当前正文' : record.title || '未命名记录'; }
const VIEWS = {inbox: ['收件箱', '所有新收集都先留在这里。先保存，稍后整理。', '▣'], all: ['全部记录', '你的文字、链接与想法，保存在自己的数据库中。', '≡'], organized: ['已整理', '已经分类，随时可以再次使用。', '✓'], duplicates: ['重复与相关', '同页或同文的记录集中在这里，包括其他电脑同步来的内容。是否合并由你决定。', '⊕'], pending: ['待同步记录', '这些修改只保存在本机，点击同步后才会上传。', '↥'], trash: ['回收站', '删除与还原也由你决定同步时机。回收站不会自动清空。', '⌫']};

// This template contains no user data; all dynamic text uses textContent / DOM nodes.
$('app').innerHTML = `
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><img class="brand-penguin" src="icons/penguin.png" alt="企鹅"><div><div class="brand-name">PKM Nexus</div><div class="brand-sub">YOUR KNOWLEDGE, YOURS.</div></div></div>
    <p class="sidebar-note">收集当下，留给未来。<br>本地保存 · 手动同步</p>
    <nav id="nav" class="nav" aria-label="记录视图"></nav>
    <div class="section-label"><span>项目与关键词</span><button id="add-project" class="icon-button" aria-label="新增项目">＋</button></div>
    <div id="projects-nav"></div>
    <div class="sidebar-bottom"><div id="repo-summary" class="repo-summary"></div><button id="settings" class="nav-item">⚙　设置与数据管理</button></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="search-wrap"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="搜索标题、正文、标签和来源…" aria-label="搜索记录"></div><div class="topbar-actions"><button id="save-local" class="button">保存到本地</button><button id="sync" class="button">↻ 手动同步</button><button id="new" class="button primary">＋ 新建记录</button></div></header>
    <div class="content">
      <section id="capture-box" class="capture-box"></section>
      <div class="page-eyebrow">PERSONAL KNOWLEDGE INBOX</div>
      <div class="page-heading"><div><h1 id="heading"></h1><p id="description" class="description"></p></div><div id="sync-status" class="sync-status"></div></div>
      <div id="notices"></div>
      <div class="filters"><label class="checkbox-line"><input id="select-all" type="checkbox">选择本页</label><div id="type-filter" class="filter-tabs" role="tablist" aria-label="记录类型"></div><select id="tag-filter" aria-label="标签筛选"></select><span class="spacer"></span><div id="project-actions"></div><small id="result-count" class="muted"></small></div>
      <div id="selection-bar" class="selection-bar" hidden></div>
      <section id="records" class="records" aria-label="记录列表"></section>
      <button id="load-more" class="button load-more" hidden>加载更多</button>
    </div>
    <footer class="panel-footer"><div id="panel-sync-status" class="sync-status"></div><button id="panel-sync" class="button primary">手动同步</button><button id="panel-save-local" class="button">保存到本地</button><button id="open-dashboard" class="button">整理页 ↗</button><button id="panel-settings" class="icon-button" aria-label="打开设置">⚙</button></footer>
  </main>
</div>`;

for (const [key, value] of Object.entries(VIEWS)) $('nav').append(button('', () => setView(key), 'nav-item'));
Object.keys(VIEWS).forEach((key, i) => { const node = $('nav').children[i]; node.dataset.view = key; node.append(el('span', {class: 'nav-symbol'}, VIEWS[key][2]), VIEWS[key][0], el('span', {class: 'count'})); });
$('type-filter').append(...[['','全部'],...Object.entries(TYPES)].map(([type,label])=>{const node=button(label,()=>{state.type=type;state.selected.clear();refreshSoon();},'type-tab');node.dataset.type=type;node.setAttribute('role','tab');return node;}));
$('search').addEventListener('input', () => { state.query = $('search').value; state.limit = 60; state.selected.clear(); refreshSoon(220); });

$('tag-filter').addEventListener('change', () => { state.tag = $('tag-filter').value; state.selected.clear(); refreshSoon(); });
$('select-all').addEventListener('change', () => { if ($('select-all').checked) state.items.filter(m=>m.type!=='list').forEach(m => state.selected.add(m.id)); else state.selected.clear(); renderSelection(); renderCards(); });
$('load-more').addEventListener('click', () => { state.limit += panel ? 20 : 60; refreshSoon(); });
$('new').addEventListener('click', act(() => openEditor()));
$('nav').append(button('☷　清单',act(openList),'nav-item'));
$('settings').addEventListener('click', act(openSettings));
$('panel-settings').addEventListener('click', () => openDashboard('#settings'));
$('add-project').addEventListener('click', act(() => openProject()));
$('open-dashboard').addEventListener('click', () => openDashboard());
$('sync').addEventListener('click', act(() => syncNow()));
$('panel-sync').addEventListener('click', act(() => syncNow()));
$('save-local').addEventListener('click',act(saveLocal));$('panel-save-local').addEventListener('click',act(saveLocal));
async function saveLocal(){if(panelEditor?.recording)throw new Error('请先停止录音，再保存完整本地包。');await panelEditor?.flush();for(const id of ['save-local','panel-save-local'])$(id).disabled=true;try{const blob=await buildLocalBackup(db,{progress:message=>{$('sync-status').textContent=message;$('panel-sync-status').textContent=message;}});download(`PKM-Nexus-data-${new Date().toISOString().slice(0,10)}.zip`,blob,'application/zip');toast('已生成完整本地 ZIP：包含记录、图片、音频和 Markdown。');}finally{for(const id of ['save-local','panel-save-local'])$(id).disabled=false;await refresh();}}
function setView(view, project = '') { state.view = view; state.project = project; state.selected.clear(); state.limit = panel ? 20 : 60; refreshSoon(); }

async function refresh() {
  const generation = ++state.generation;
  const [catalog, captures, conflicts, lastSync, settings, notice] = await Promise.all([db.allCatalog(), db.captures(), db.conflicts(), db.getState('lastSync'), readConfig(), db.getState('notice')]);
  const projects = catalog.filter(m => m.type === 'project' && !m.deleted_at);
  const keywordProject = state.project && state.keyword ? projects.find(p => p.id === state.project) : null;
  const duplicates = duplicateIds(catalog);
  const results = await db.list({view: state.view, query: state.query, tag: state.tag, type: state.type, project: state.project && !state.keyword ? state.project : '', keywordProject, ids: state.view === 'duplicates' ? duplicates : null, limit: state.limit});
  if (generation !== state.generation) return;
  for(const tab of $('type-filter').children){tab.classList.toggle('active',tab.dataset.type===state.type);tab.setAttribute('aria-selected',String(tab.dataset.type===state.type));}
  state.projects = projects; state.captures = captures; state.conflicts = conflicts; state.items = results.items; state.notice = notice;
  const active = catalog.filter(m => !m.deleted_at && m.type !== 'project');
  const counts = {inbox: active.filter(m => m.organization_state === 'inbox').length, all: active.length, organized: active.filter(m => m.organization_state === 'organized').length, duplicates: duplicates.size, pending: active.filter(m => m.dirty).length, trash: catalog.filter(m => m.deleted_at && m.kind !== 'tombstone').length};
  for (const node of [...$('nav').children].filter(n=>n.dataset.view)) { node.classList.toggle('active', node.dataset.view === state.view && !state.project); node.querySelector('.count').textContent = counts[node.dataset.view] || ''; }
  $('projects-nav').replaceChildren(...projects.map(p => el('div', {class: 'project-nav'}, button(`◌  ${p.title}`, () => { state.keyword = true; setView('all', p.id); }, 'link-button'), button('⋯', act(() => openProject(p.id)), 'icon-button'))));
  const p = projects.find(p => p.id === state.project);
  if (state.project && !p) state.project = '';
  $('heading').textContent = p ? p.title : VIEWS[state.view][0];
  $('description').textContent = p ? `关键词：${p.keywords.join('、') || '尚未设置'}。匹配只提供线索，由你确认关联。` : VIEWS[state.view][1];
  const pending = catalog.filter(m => m.dirty && m.scope === 'sync').length;
  const statusNodes = () => [el('span', {class: `dot${pending ? ' pending' : ''}`}), el('span', {}, state.busy ? state.progress : pending ? `${pending} 项本地变更待同步` : '本机没有待上传变更'), ...(!state.busy && lastSync ? [el('span', {}, ` · 上次 ${dateLabel(lastSync)}`)] : [])];
  $('sync-status').replaceChildren(...statusNodes()); $('panel-sync-status').replaceChildren(...statusNodes());
  for (const id of ['sync', 'panel-sync']) { $(id).disabled = state.busy; $(id).textContent = state.busy ? '同步中…' : '↻ 手动同步'; }
  $('repo-summary').replaceChildren(el('span', {}, settings.config.owner && settings.config.repo ? `${settings.config.owner} / ${settings.config.repo}` : '尚未连接 GitHub'), el('small', {}, lastSync ? '本地副本可离线使用；远程新变更需手动拉取。' : '先保存到本机，配置私有仓库后手动同步。'));
  const tags = [...new Set(active.flatMap(m => m.tags))].sort((a, b) => a.localeCompare(b));
  $('tag-filter').replaceChildren(option('', '全部标签'), ...tags.map(tag => option(tag, tag, tag === state.tag)));
  $('result-count').textContent = `${results.items.length}${results.hasMore ? '+' : ''} 条记录`;
  $('load-more').hidden = !results.hasMore;
  $('project-actions').replaceChildren();
  if (p) {
    const mode = check('显示关键词匹配', state.keyword); mode.input.addEventListener('change', () => { state.keyword = mode.input.checked; state.selected.clear(); refreshSoon(); });
    $('project-actions').append(el('div', {class: 'row'}, mode.label, button('预览并关联', act(() => previewRule(p)), 'button small')));
  }
  renderNotices(); renderSelection(); renderCards();await consumeCapture();
}
function renderNotices() {
  const nodes = [];
  if (state.notice?.error) nodes.push(el('div', {class: 'notice'}, state.notice.text, el('div', {class: 'row'}, button('知道了', act(() => db.setState('notice', null)), 'button small'))));
  if (state.captures.length) nodes.push(el('div', {class: 'notice'}, el('h3', {}, `${state.captures.length} 条收集等待处理`), '发现重复或相关内容，原文已保留在本机。', el('div', {class: 'row'}, button('查看重复提示', act(() => openDuplicates()), 'button small'))));
  if (state.conflicts.length) nodes.push(el('div', {class: 'notice'}, el('h3', {}, `${state.conflicts.length} 条同步冲突`), '双方版本都已保留。处理后再次手动同步。', el('div', {class: 'row'}, button('处理冲突', act(() => openConflict()), 'button small'))));
  $('notices').replaceChildren(...nodes);
}
function renderSelection() {
  const ids = [...state.selected]; $('selection-bar').hidden = !ids.length;
  const selectable=state.items.filter(m=>m.type!=='list');$('select-all').checked = !!selectable.length && selectable.every(m => state.selected.has(m.id));
  $('selection-bar').replaceChildren(el('span', {}, `已选 ${ids.length} 条`),
    ...(state.view === 'trash' ? [button('批量还原', act(async () => { for (const id of ids) await db.restore(id); state.selected.clear(); refreshSoon(); toast('已还原到本机，等待手动同步。'); }), 'button small')] : [
      button('标记已整理', act(async () => { for (const id of ids) await db.mutate(id, r => ({...r, organization_state: 'organized', updated_at: new Date().toISOString()})); state.selected.clear(); refreshSoon(); toast('已整理，等待手动同步。'); }), 'button small'),
      button('添加标签', () => bulkTags(ids), 'button small'),
      ids.length === 2 ? button('合并两条', act(() => openMerge(ids[0], ids[1])), 'button small') : null,
      button('移入回收站', () => confirmAction('将所选记录移入回收站？', '记录可以还原，下一次手动同步时才传播删除状态。', async () => { for (const id of ids) await db.trash(id); state.selected.clear(); refreshSoon(); }), 'button small danger')]),
    button('取消选择', () => { state.selected.clear(); renderSelection(); renderCards(); }, 'link-button'));
}
function renderCards() {
  if (!state.items.length) {
    $('records').replaceChildren(el('div', {class: 'empty'}, el('div', {class: 'empty-symbol'}, state.view === 'trash' ? '⌫' : '▣'), el('h2', {}, state.query || state.tag || state.project ? '没有匹配的记录' : state.view === 'inbox' ? '给下一次灵感留个位置' : '这里还没有记录'), el('p', {}, panel ? '选择网页文字，右键或按 Alt + Shift + S。\n也可以在上方直接写一条。' : state.view === 'inbox' ? '选择网页文字，右键保存，或按 Alt + Shift + S。\n每一条新收集都会先来到这里。' : '试试其他筛选条件，或新建一条记录。'), !panel && state.view !== 'trash' ? button('＋ 新建记录', act(() => openEditor()), 'button primary') : null)); return;
  }
  $('records').replaceChildren(...state.items.map(m => {
    const selected = el('input', {type: 'checkbox',disabled:m.type==='list', checked: state.selected.has(m.id), 'aria-label': `选择 ${m.type==='list'?'Todo / Idea':m.title || '未命名记录'}`});
    selected.addEventListener('change', () => { if (selected.checked) state.selected.add(m.id); else state.selected.delete(m.id); renderSelection(); });
    const edit = act(() => m.type === 'project' ? openProject(m.id) : openEditor(m.id));
    const main = el('div', {class: 'record-main', tabindex: '0', role: 'button', 'aria-label': `打开 ${m.type==='list'?'Todo / Idea':m.title || '未命名记录'}`, onclick: edit, onkeydown: event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); edit(); } }},
      el('div', {class: 'record-top'}, el('h2', {}, m.type==='list'?'Todo / Idea':m.title || '未命名记录'), el('span', {class: 'badge'}, displayType(m.type)), m.dirty ? el('span', {class: 'badge pending'}, '待同步') : null, m.task_status ? el('span', {class: 'badge'}, TASK_STATUSES[m.task_status]) : null,...(m.attachments||[]).some(a=>a.kind!=='snapshot')?[el('span',{class:'badge'},`${m.attachments.filter(a=>a.kind==='image').length} 图片 · ${m.attachments.filter(a=>a.kind==='audio').length} 音频`)]:[]),
      m.summary||!['list','snapshot','website_group'].includes(m.type)?el('p', {class: 'record-summary'}, m.summary || (m.type === 'project' ? m.keywords.join('、') : '尚未补充正文')):null,
      el('div', {class: 'record-meta'}, el('span', {}, dateLabel(m.created_at)), ...m.tags.slice(0, 8).map(t => el('span', {class: 'tag'}, t)), ...m.project_ids.map(id => state.projects.find(p => p.id === id)).filter(Boolean).slice(0, 3).map(p => el('span', {class: 'badge'}, `◌ ${p.title}`)), m.sources[0]?.url ? el('a', {href: safeUrl(m.sources[0].url), target: '_blank', rel: 'noopener noreferrer', onclick: event => event.stopPropagation()}, new URL(m.sources[0].url).hostname) : null));
    main.append(typedCard(m,{toggleList:act(async(id,checked)=>db.mutate(m.id,r=>({...r,list:r.list.map(item=>item.id===id?{...item,checked}:item),updated_at:new Date().toISOString()}))),toggleRead:act(async(id,read)=>db.mutate(m.id,r=>({...r,url_list:r.url_list.map(item=>item.id===id?{...item,read_at:read?new Date().toISOString():null}:item),updated_at:new Date().toISOString()})))}));
    const actions = m.type==='list'&&!m.deleted_at?[]:m.deleted_at ? [button('还原', act(async () => { await db.restore(m.id); toast('已还原到本机。'); }), 'button small'), button('移除正文', () => confirmAction('移除当前正文？', '此操作不能从回收站还原。保留最小删除标记防止旧电脑复活；Git 历史和已有备份仍可能保留内容。', async () => { await db.purge(m.id); toast('当前正文已移除，等待手动同步。'); }), 'button small danger')] : [state.view === 'duplicates' ? button('合并…', act(() => openMerge(m.id)), 'button small') : null, button('⌫', act(async () => { await db.trash(m.id); toast('已移入回收站，可还原。'); }), 'icon-button')];
    const card=el('article', {class: `record record-${m.type}`,'data-record-id':m.id}, el('div', {class: 'selection'}, selected), main, el('div', {class: 'record-actions'}, ...actions));
    if(m.type==='website_group'&&!m.deleted_at){card.addEventListener('dragover',e=>{e.preventDefault();card.classList.add('drag-over');});card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));card.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();card.classList.remove('drag-over');const data=Object.fromEntries(['application/x-pkm-tab','text/uri-list','text/plain','text/html'].map(key=>[key,e.dataTransfer.getData(key)]));toast('正在读取网页标题…');act(async()=>{const dropped=await droppedWebsites({getData:key=>data[key]||''});if(!dropped.items.length)return;const saved=await appendWebsites(db,m.id,dropped.items);const close=document.querySelector('[name=close_tabs]');const result=!close||close.checked?await closeCapturedTabs(dropped.tabs,saved.record):{closed:[]};toast(`已加入网页组并关闭 ${result.closed.length} 个标签页。`);})()});}
    return card;
  }));
}

function confirmAction(title, message, fn) {
  const {dialog, body, footer} = modal(title); body.append(el('p', {class: 'description'}, message));
  const submit = button('确认', act(async () => { submit.disabled = true; try { await fn(); dialog.close(); } finally { submit.disabled = false; } }), 'button danger');
  footer.append(button('取消', () => dialog.close()), submit);
}
function bulkTags(ids) {
  const {dialog, body, footer} = modal('批量添加标签'); const input = textInput('', {placeholder: '用逗号分隔，如：学习, 待阅读'}); body.append(field(`添加到 ${ids.length} 条记录`, input, '保留每条记录已有的标签。'));
  footer.append(button('取消', () => dialog.close()), button('添加标签', act(async () => { const tags = splitTags(input.value); if (!tags.length) throw new Error('请填写标签。'); for (const id of ids) await db.mutate(id, r => ({...r, tags: [...new Set([...r.tags, ...tags])], updated_at: new Date().toISOString()})); dialog.close(); state.selected.clear(); refreshSoon(); }), 'button primary'));
}

async function editorData(id,explicitDraft){
 const row=id?await db.get(id):null;if(id&&(!row||row.record.kind==='tombstone'))throw new Error('记录不存在。');
 const key=row?`draft:editor:${id}`:panel?'draft:panel':'draft:editor:new',stored=explicitDraft?.value||await db.getState(key);
 if(stored?.record&&(explicitDraft||stored.expectedRev===(row?.rev||0)))return {row,record:upgradeRecord(stored.record),draftKey:explicitDraft?.key||key,rawUrls:stored.rawUrls};
 if(stored?.record){await db.setState(`${key}:archive-${crypto.randomUUID()}`,stored);await db.setState(key,null);}
 if(!row&&stored?.content!==undefined)return {record:newRecord({type:'note',title:stored.title,content:stored.content,attachments:stored.attachments||[]}),draftKey:key,rawUrls:stored.url};
 return {row,record:row?upgradeRecord(row.record):newRecord(),draftKey:key};
}
async function saveEditorRecord(value,row){if(row?.rev){await db.save(value,{expectedRev:row.rev});return {status:'saved'};}if(value.type==='list'){await db.save(value,{expectedRev:0});return {status:'saved'};}return captureInto(db,value);}
async function openEditor(id,{value,key}={}){
 if(panel){activeDialog?.close();await panelEditor.load(id,{value,key});return;}
 const data=await editorData(id,value?{value,key}:null);let editor;
 const {dialog,body,footer}=modal(data.row?.rev?'编辑记录':'新建记录',{onClose:()=>{editor?.flush().catch(()=>{});editor?.destroy();}});
 async function navigate(type,captured){await editor.flush();dialog.close();if(type==='capture')return openEditor(null,{value:{record:captured,expectedRev:0,rawUrls:captured.sources.map(s=>s.url).join('\n')},key:`draft:editor:new:captured-${captured.id}`});if(type==='list')return openList();return openEditor(null,{value:{record:newRecord({type}),expectedRev:0,rawUrls:''}});}
 editor=createEditor(db,{...data,panel:false,onSave:saveEditorRecord,onNavigate:act(navigate),onCancel:async result=>{if(result?.saved)toast('已保存到本机，等待手动同步。');dialog.close();refreshSoon();}});body.append(editor.root);footer.append(el('span',{class:'hint'},data.row?`原 ID ${data.row.id.slice(0,8)}`:'保存后才进入收件箱'));editor.root.querySelector('[name=title]').focus();
}
async function openList(){const row=await singletonList(db);if(row.rev)return openEditor(row.id);return openEditor(null,{value:{record:row.record,expectedRev:0,rawUrls:''}});}
async function setupPanel(){
 if(!panel)return;let editor;
 async function mount(data){if(editor?.recording)throw new Error('请先停止当前录音。');await editor?.flush();editor?.destroy();editor=createEditor(db,{...data,panel:true,onSave:saveEditorRecord,onNavigate:act(async(type,captured)=>{if(type==='capture')return mount({record:captured,draftKey:`draft:editor:new:captured-${captured.id}`,rawUrls:captured.sources.map(s=>s.url).join('\n')});if(type==='list'){const row=await singletonList(db);return mount(row.rev?await editorData(row.id):{record:row.record,draftKey:`draft:editor:${LIST_ID}`});}return mount({record:newRecord({type}),draftKey:'draft:panel',rawUrls:''});}),onCancel:async result=>{if(result?.saved)toast(result.message?.includes('关闭')?result.message:'已保存到本机，等待手动同步。');editor.destroy();editor=null;await mount({record:newRecord(),draftKey:'draft:panel'});await db.setState('draft:panel',null);refreshSoon();}});$('capture-box').replaceChildren(editor.root);}
 panelEditor={get recording(){return editor?.recording;},flush:()=>editor?.flush(),load:async(id,explicit)=>{const data=await editorData(id,explicit?.value?explicit:null);await mount(data);$('capture-box').scrollIntoView({behavior:'smooth'});}};
 await mount(await editorData());window.addEventListener('pagehide',()=>{editor?.flush().catch(()=>{});editor?.destroy();});
}
async function consumeCapture(){if(!panel||panelEditor?.recording)return;await navigator.locks.request('pkm-nexus:capture-editor',{ifAvailable:true},async lock=>{if(!lock)return;const pending=await db.getState('capture:editor');if(!pending)return;await db.setState('capture:editor',null);await panelEditor.load(null,{value:{record:pending.record,rawUrls:pending.record.sources.map(s=>s.url).join('\n'),expectedRev:0},key:pending.key});toast('网页已放入编辑器，确认后再保存。');});}

async function openDuplicates(captureId) {
  const captures = await db.captures(), capture = captures.find(c => c.id === captureId) || captures[0];
  if (!capture) return;
  const matches = await db.duplicates(capture.record);
  const {dialog, body, footer} = modal('重复与相关内容');
  body.append(el('h3', {}, capture.record.title || '待处理收集'), el('p', {class: 'description'}, capture.record.content.slice(0, 500) || capture.record.sources[0]?.url || '仅链接'), el('p', {class: 'description'}, '你的这次收集已经留在本机。选择追加、另存或取消，系统不会自动合并。'));
  const choices = el('div', {class: 'records'}); let selectedId = matches[0]?.id;
  const labels = {exact: '内容重复', related: '同页不同内容', similar: '不同来源、内容相同'};
  for (const match of matches) {
    const radio = el('input', {type: 'radio', name: 'duplicate-target', value: match.id, checked: match.id === selectedId}); radio.addEventListener('change', () => { selectedId = match.id; });
    choices.append(el('label', {class: 'version'}, el('div', {class: 'row'}, radio, el('strong', {}, match.title || '未命名记录'), el('span', {class: 'badge'}, labels[match.match]), match.deleted_at ? el('span', {class: 'badge pending'}, '在回收站') : null), el('p', {class: 'description'}, match.summary || '只有链接'), button('查看已有记录', act(() => openEditor(match.id)), 'link-button')));
  }
  if (!matches.length) choices.append(el('p', {class: 'description'}, '当前没有重复候选，可以另存为新记录。'));
  body.append(choices);
  const finish = async fn => { await fn(); dialog.close(); chrome.runtime.sendMessage({type: 'refresh-badge'}).catch(() => {}); toast('这条收集已处理。'); };
  footer.append(button('取消这次收集', act(() => finish(() => db.dismissCapture(capture.id))), 'button'),
    matches.length ? button(matches.some(m => m.deleted_at) ? '追加（必要时还原）' : '追加到所选记录', act(() => finish(() => appendCapture(db, selectedId, capture))), 'button') : null,
    button('仍然另存一条', act(() => finish(() => db.finishCapture(capture.id, capture.record, 0, capture.scope || 'sync'))), 'button primary'));
}
async function openMerge(sourceId, selectedTarget) {
  const source = await db.get(sourceId); if (!source) throw new Error('记录不存在。');
  const matches = selectedTarget ? [await db.get(selectedTarget)].filter(Boolean).map(row => ({id: row.id, title: row.record.title, summary: row.record.summary || row.record.content.slice(0, 160)})) : await db.duplicates(source.record);
  if (!matches.length) throw new Error('没有可合并的候选。可在列表选择两条记录手动合并。');
  const {dialog, body, footer} = modal('合并已有记录'); let target = await db.get(matches[0].id);
  body.append(el('p', {class: 'description'}, `将“${source.record.title || '未命名记录'}”合并到所选记录。合并正文、附件、标签、项目和来源；来源记录保留在回收站中，可恢复。目标保留自己的类型与待办状态。`));
  const select = el('select', {}, ...matches.map(m => option(m.id, m.type==='list'?'Todo / Idea':m.title || '未命名记录'))), targetPreview = el('pre', {class: 'preview-list'}), scopeHint = el('p', {class: 'description'});
  function showTarget() { targetPreview.textContent = target.record.content || '（没有正文）'; scopeHint.textContent = target.record.deleted_at ? '目标在回收站：合并时会明确还原到正常记录。' : '合并先保存在本机，等待手动同步。'; }
  select.addEventListener('change', act(async () => { target = await db.get(select.value); if (!target) throw new Error('目标已不存在。'); showTarget(); })); showTarget();
  body.append(field('合并到', select), el('div', {class: 'conflict-columns'}, el('div', {class: 'version'}, el('h4', {}, '来源记录正文'), el('pre', {}, source.record.content || '（没有正文）')), el('div', {class: 'version'}, el('h4', {}, '目标记录正文'), targetPreview)), scopeHint);
  footer.append(button('取消', () => dialog.close()), button('合并并保留来源到回收站', act(async () => { await db.mergeRecords(source.id, target.id, source.rev, target.rev); dialog.close(); state.selected.clear(); toast('已合并到本机，来源记录保留在回收站。'); }), 'button primary'));
}

async function openProject(id) {
  const row = id ? await db.get(id) : null; if (id && !row) throw new Error('项目不存在。');
  const record = row?.record || newRecord({schema_version:2,type: 'project', organization_state: 'organized', keywords: [], match_fields: ['title', 'content', 'tags', 'url']});
  const {dialog, body, footer} = modal(id ? '编辑项目关键词' : '新建项目关键词');
  const name = textInput(record.title, {maxlength: '500', placeholder: '例如：知识插件'}), keywords = textarea((record.keywords || []).join(', '), {rows: '3', placeholder: 'PKM-Nexus, knowledge_extension, 浏览器收集'});
  const fieldLabels = {title: '标题', content: '正文 / 摘要 / 用途', tags: '标签', url: '来源 URL'};
  const fields = Object.entries(fieldLabels).map(([key, label]) => ({key, ...check(label, (record.match_fields || []).includes(key))}));
  body.append(field('项目名称', name), field('关键词', keywords, '逗号或换行分隔，任意一个关键词命中即可。'), el('div', {class: 'field'}, el('span', {class: 'field-label'}, '匹配范围'), el('div', {class: 'chip-options'}, ...fields.map(f => f.label))), el('p', {class: 'description'}, '匹配只形成建议。预览并应用后才添加项目关联，也不会自动移出收件箱。项目规则随手动同步传到其他电脑。'));
  footer.append(id && !record.deleted_at ? button('移入回收站', act(async () => { await db.trash(id); dialog.close(); }), 'button danger') : null,
    button('取消', () => dialog.close()), button('保存规则', act(async () => {
      if (!name.value.trim() || !splitTags(keywords.value).length || !fields.some(f => f.input.checked)) throw new Error('请填写项目名称、至少一个关键词和匹配范围。');
      const next = {...record, schema_version:2, title: name.value.trim(), keywords: splitTags(keywords.value), match_fields: fields.filter(f => f.input.checked).map(f => f.key), updated_at: new Date().toISOString()};
      await db.save(next, {expectedRev: row?.rev || 0}); dialog.close(); toast('项目规则已保存到本机。');
    }), 'button primary'));
}
async function previewRule(project) {
  const result = await db.list({view: 'all', keywordProject: project, limit: 100_000});
  const candidates = result.items.filter(m => !m.project_ids.includes(project.id));
  const {dialog, body, footer} = modal('预览关键词关联');
  body.append(el('p', {class: 'description'}, `“${project.title}”将给 ${candidates.length} 条记录添加关联。保留已有项目关联，不改变未分类状态。`), el('div', {class: 'preview-list'}, ...candidates.slice(0, 100).map(m => el('div', {}, m.type==='list'?'Todo / Idea':m.title || '未命名记录')), candidates.length > 100 ? `…另有 ${candidates.length - 100} 条` : null));
  footer.append(button('取消', () => dialog.close()), button('应用关联', act(async () => {
    for (const m of candidates) await db.mutate(m.id, record => matchingProjects(record, [project]).length ? {...record, project_ids: [...new Set([...record.project_ids, project.id])], updated_at: new Date().toISOString()} : record);
    dialog.close(); toast('关联已保存到本机，等待手动同步。');
  }), 'button primary'));
}

async function syncNow(scan = false) {
  if (state.busy) return;
  state.busy = true; state.progress = '正在连接私有仓库…';
  clearTimeout(toastTimer); $('toast').textContent = ''; $('toast').className = '';
  for (const id of ['sync', 'panel-sync']) { $(id).disabled = true; $(id).textContent = '同步中…'; }
  try {
    const settings = await readConfig();
    if (!settings.token || !settings.config.owner || !settings.config.repo) { if (panel) await openDashboard('#settings'); else await openSettings(); toast('请先配置自己的 GitHub 私有仓库。'); return; }
    await refresh();
    const progress = message => { state.progress = message; $('sync-status').textContent = message; $('panel-sync-status').textContent = message; };
    const api = new GitHub(settings.config, settings.token, {progress});
    const result = await withSyncLock(() => synchronize(db, api, {scan, progress}));
    if (result.status === 'conflicts') { toast(`发现 ${result.count} 条冲突，双方版本已保留。`); await openConflict(); }
    else {await migrateTodos(db);toast(`同步完成：上传 ${result.pushed} 项，拉取 ${result.pulled} 项。新产生的修改仍待同步。`);}
  } finally { state.busy = false; state.progress = ''; for (const id of ['sync', 'panel-sync']) { $(id).disabled = false; $(id).textContent = '↻ 手动同步'; } await refresh(); }
}
async function openConflict(id) {
  const conflicts = await db.conflicts(), conflict = conflicts.find(c => c.id === id) || conflicts[0];
  if (!conflict) return;
  const local = await db.get(conflict.id); if (!local) throw new Error('本地记录不存在，请重新同步。');
  const {dialog, body, footer} = modal(`同步冲突 · ${titleOf(local.record)}`);
  const describe = record => record.kind === 'tombstone' ? '当前正文已移除，仅保留删除标记。' : `${record.deleted_at ? '【在回收站】\n' : ''}${record.title}\n标签：${record.tags.join('、')}\n整理状态：${record.organization_state}\n\n${record.content || '（没有正文）'}`;
  body.append(el('p', {class: 'description'}, '两个版本都被保留。选择一个版本，或编辑合并 JSON；处理后再点击同步。'), el('div', {class: 'conflict-columns'}, el('div', {class: 'version'}, el('h4', {}, '这台电脑的版本'), el('pre', {}, describe(local.record))), el('div', {class: 'version'}, el('h4', {}, 'GitHub 上的版本'), el('pre', {}, describe(conflict.remoteRecord)))));
  const merged = textarea(JSON.stringify(local.record, null, 2), {class: 'editor-text', rows: '10', 'aria-label': '手动合并 JSON'});
  const details = el('details', {}, el('summary', {}, '完整版本与手动合并 JSON'), el('p', {class: 'description'}, '保留原 ID 和 schema_version。下面可编辑本地完整版本。'), merged, el('h4', {}, '远程完整 JSON'), el('pre', {class: 'preview-list'}, JSON.stringify(conflict.remoteRecord, null, 2)), button('采用合并 JSON', act(async () => { await db.resolveConflict(conflict.id, 'merge', JSON.parse(merged.value)); dialog.close(); toast('合并已保存，等待手动同步。'); }), 'button primary'));
  body.append(details);
  const resolve = async choice => { await db.resolveConflict(conflict.id, choice); dialog.close(); toast('冲突已处理，请再次手动同步。'); };
  footer.append(button('稍后处理', () => dialog.close()),
    conflict.remoteRecord.kind !== 'tombstone' || local.record.kind === 'tombstone' ? button('保留本地版本', act(() => resolve('local'))) : button('本地另存，再接受删除', act(async () => {
      const savedVersion=local.record.type==='list'?newRecord({title:'清单删除前的快照',content:toMarkdown(local.record)}):upgradeRecord(local.record);
      const copy = newRecord({...savedVersion, id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null, organization_state: 'inbox'});
      await db.save(copy, {expectedRev: 0}); await resolve('remote');
    })), button('采用远程版本', act(() => resolve('remote')), 'button primary'));
}

async function openSettings() {
  const settings = await readConfig(), bound = await db.getState('repoKey');
  const {dialog, body, footer} = modal('设置与数据管理');
  const owner = textInput(settings.config.owner, {name: 'owner', placeholder: 'GitHub 用户名', autocomplete: 'off'}), repo = textInput(settings.config.repo, {name: 'repo', placeholder: '私有仓库名称', autocomplete: 'off'}), branch = textInput(settings.config.branch, {name: 'branch', placeholder: '留空使用仓库默认分支'}), token = textInput(settings.token, {name: 'token', type: 'password', placeholder: 'Fine-grained personal access token', autocomplete: 'off'}), remember = check('在本机记住 Token（本机存储不做额外加密）', settings.remember);
  const status = el('div', {class: 'success-text', role: 'status'});
  body.append(el('p', {class: 'description'}, '使用自己的 GitHub 私有仓库。Token 只需授权此仓库的 Contents 读写权限，不需要 Actions 或 Workflows 权限。'),
    el('div', {class: 'field-row'}, field('GitHub 用户名 / 组织', owner), field('仓库名', repo)), field('分支', branch), field('Token', token, '未勾选记住时，仅保留到本次浏览器会话结束。Token 不会进入记录、导出文件或仓库。'), remember.label,
    el('div', {class: 'row'}, button('测试连接', act(async () => { status.className = 'success-text'; status.textContent = '正在测试…'; try { const api = new GitHub(values(), token.value); const result = await api.connect(); await db.assertRepo(result.repoKey); status.textContent = `连接成功：私有仓库，分支 ${result.branch}。尚未同步。`; } catch (error) { status.className = 'error-text'; status.textContent = error.message; } })), button('清除已保存 Token', act(async () => { await forgetToken(); token.value = ''; remember.input.checked = false; status.textContent = '已清除本机凭证。'; }), 'link-button')), status,
    bound ? el('small', {class: 'muted'}, `本机数据已绑定 ${bound}。换仓库请先备份并使用独立浏览器配置。`) : null);
  function values() { return validateConfig({owner: owner.value, repo: repo.value, branch: branch.value}); }
  const save = button('保存配置', act(async () => {
    const config = values(); if (!token.value.trim()) throw new Error('请填写 Token，或使用“清除已保存 Token”移除凭证。');
    if (bound) { const prefix = `${config.owner.toLowerCase()}/${config.repo.toLowerCase()}#`; await db.assertRepo(`${prefix}${config.branch || (bound.startsWith(prefix) ? bound.slice(prefix.length) : 'main')}`); }
    await saveConfig(config, token.value, remember.input.checked); dialog.close(); toast('配置已保存；点击手动同步才会传输记录。');
  }), 'button primary');
  const dataSection = el('section', {class: 'settings-section'}, el('h3', {}, '完整本地备份'), el('p', {class: 'description'}, '完整 ZIP 包含 JSON、Markdown、图片、音频、项目规则、回收站与草稿。JSON 单独导出仅包含数据和附件清单，不包含二进制附件。导出不包含 Token。'));
  const file = el('input', {type: 'file', accept: '.zip,.json,application/zip,application/json', hidden: true, 'aria-label': '选择 JSON 或 ZIP 备份'});
  file.addEventListener('change', act(async () => { const selected = file.files[0]; if (!selected) return; if (selected.size > 512*1024*1024) throw new Error('备份超过 512 MB，请拆分后导入。'); const plan=selected.name.toLowerCase().endsWith('.zip')?await previewZipImport(db,selected):await db.previewImport(JSON.parse(await selected.text())); await openImport(plan); }));
  dataSection.append(el('div', {class: 'row'}, button('保存到本地（完整 ZIP）',act(saveLocal)),button('导出 JSON', act(async () => { const data = await db.exportData(); download(`PKM-Nexus-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(data, null, 2)); })), button('导出 Markdown', act(async () => { const data = await db.exportData(); download(`PKM-Nexus-${new Date().toISOString().slice(0,10)}.md`, data.records.map(item => toMarkdown(item.record)).join('\n\n---\n\n'), 'text/markdown'); })), button('导入 JSON / ZIP', () => file.click()), file));
  const storageInfo = el('p', {class: 'description'}, '正在读取本地存储信息…');
  const estimate = await navigator.storage.estimate(); storageInfo.textContent = `本地存储约 ${((estimate.usage || 0) / 1024 / 1024).toFixed(2)} MB（浏览器估算，包含索引）。卸载扩展前请导出备份。`;
  const repair = el('section', {class: 'settings-section'}, el('h3', {}, '索引恢复'), el('p', {class: 'description'}, '索引是派生数据。索引损坏或在仓库中手动修改了 JSON 时，可以主动扫描全部记录并按正常冲突规则同步；不会强制覆盖远程分支。'), button('扫描仓库并同步', act(async () => { dialog.close(); await syncNow(true); })));
  const drafts = await db.drafts(), draftSection = el('section', {class: 'settings-section'}, el('h3', {}, '本机未保存草稿'), el('p', {class: 'description'}, '旧版本编辑草稿不会覆盖最新记录。可继续编辑，或下载原始草稿；JSON 备份也会保留这些内容。'));
  if (!drafts.length) draftSection.append(el('small', {class: 'muted'}, '目前没有未保存草稿。'));
  for (const draft of drafts) draftSection.append(el('div', {class: 'row'}, el('span', {}, draft.value.record?.title || draft.value.title || '未命名草稿'), button(draft.value.record?.type==='list'?'继续编辑清单':'恢复为新记录', act(async () => {
    if(draft.value.record?.type==='list'){await openList();return;}
    const value = draft.value.record ? draft.value : {record: newRecord({type: draft.value.type, title: draft.value.title, content: draft.value.content,attachments:draft.value.attachments||[]}), rawUrls: draft.value.url, expectedRev: 0, scope:'sync'};
    await openEditor(null, {value, key: draft.key});
  }), 'button small'), button('下载', () => download('PKM-Nexus-draft.json', JSON.stringify(draft, null, 2)), 'link-button')));
  const recordings=await db.recordings(),recordingSection=el('section',{class:'settings-section'},el('h3',{},'未完成录音恢复'));
  if(!recordings.some(r=>r.chunks))recordingSection.append(el('small',{class:'muted'},'没有需要恢复的录音。'));
  for(const session of recordings.filter(r=>r.chunks))recordingSection.append(el('div',{class:'row'},el('span',{},`录音 ${dateLabel(session.created_at)}`),button('恢复到收件箱',act(async()=>{const attachment=await db.finishRecording(session.id);await db.save(newRecord({type:'note',title:attachment.name,content:`[${attachment.name}](${attachment.path})`,attachments:[attachment]}),{expectedRev:0});await db.removeRecording(session.id);dialog.close();toast('已恢复录音到收件箱。');}),'button small')));
  body.append(dataSection, draftSection,recordingSection, storageInfo, repair); footer.append(button('关闭', () => dialog.close()), save);
}
async function openImport(plan) {
  const counts = {new: 0, same: 0, changed: 0}; plan.entries.forEach(e => counts[e.status]++);
  const {dialog, body, footer} = modal('导入预览');
  const overwrite = check('更新相同 ID 但内容不同的记录（包含恢复或删除状态变化）', false);
  body.append(el('p', {class: 'description'}, `新增 ${counts.new} 条 · 相同 ${counts.same} 条 · 内容不同 ${counts.changed} 条 · 待处理收集 ${plan.captures.length} 条 · 草稿 ${plan.drafts?.length || 0} 条。默认保留本机已有差异，重复导入不会复制整个数据库。`),
    el('div', {class: 'preview-list'}, ...plan.entries.filter(e => e.status !== 'same').slice(0, 100).map(e => el('div', {}, `${e.status === 'new' ? '新增' : '差异'} · ${titleOf(e.record)}`))), overwrite.label,
    el('p', {class: 'description'}, '导入只修改本机，不自动上传。相同记录沿用原 ID，当前同步仓库和凭证不会被备份覆盖。'));
  footer.append(button('取消', () => dialog.close()), button('导入到本机', act(async () => { const count = await db.applyImport(plan, overwrite.input.checked);await migrateTodos(db); dialog.close(); toast(`已导入 ${count} 项变化，等待你手动同步。`); }), 'button primary'));
}

async function initialize() {
  await protectStorage();await migrateTodos(db); db.onChange(refreshSoon);
  chrome.storage.onChanged.addListener((changes, area) => { if ((area === 'local' && changes.githubConfig) || changes.githubToken) refreshSoon(); });
  await setupPanel(); await refresh();
  if (!panel && location.hash === '#settings') await openSettings();
}
initialize().catch(error => { $('records').replaceChildren(el('div', {class: 'notice'}, '无法打开本地数据库：', error.message)); toast(error.message, true); });
window.addEventListener('hashchange', () => { if (location.hash === '#settings') act(openSettings)(); });
// No fetch, polling, timer-based synchronization, analytics, or AI calls on startup.

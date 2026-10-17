import { TYPES, newRecord, upgradeRecord, normalizeRecord, safeUrl } from './model.js';
import { el, button, field, markdownPreview, assetView } from './dom.js';
import { mediaComposer } from './media.js';
import { loadAsset } from './assets.js';
import { mergeUrls, listMarkdown, listDocument, parseListMarkdown } from './collections.js';
import { icon } from './icons.js';
import { websiteTitle, websiteLink, websiteLabel, isPlaceholderTitle } from './websites.js';
import { openWebsiteTabs, websiteItem, droppedWebsites, closeCapturedTabs } from './tabs.js';
import { cacheDraft, clearDraft } from './drafts.js';
import { appendCollected } from './collected.js';

export function createEditor(
  db,
  {
    row,
    record: initial,
    draftKey,
    rawUrls,
    draftUi = {},
    capturedTabs = [],
    recovered = false,
    panel = false,
    simple = false,
    onSave,
    onNavigate,
    onCancel,
    closeSourceKey,
  } = {},
) {
  let record = upgradeRecord(initial || row?.record || newRecord()),
    items = structuredClone(record.list || []),
    urls = structuredClone(record.url_list || []),
    snapshot = record.snapshot || null,
    pendingTabs = structuredClone(capturedTabs),
    timer,
    disposed = false,
    saving = false,
    dirty = !!recovered,
    previewing = false;
  const selectedTabIds = new Set(draftUi.selectedTabs || []);
  const collectedIds = new Set(draftUi.collectedIds || []);
  draftKey ||= row ? `draft:editor:${row.id}` : panel ? 'draft:panel' : 'draft:editor:new';
  const root = el('form', { id: panel ? 'capture-form' : 'editor-form' }),
    tabs = el('div', { class: 'type-tabs', role: 'tablist', 'aria-label': '收集方式' }),
    heading = el(
      'strong',
      {},
      row?.rev
        ? '编辑原记录'
        : record.sources.length || record.snapshot
          ? '编辑捕获记录'
          : '随手收集',
    );
  const title = el('input', {
      name: 'title',
      type: 'text',
      value: record.title,
      placeholder: '标题（可选）',
      maxlength: 500,
    }),
    content = el('textarea', {
      name: 'content',
      maxlength: 1000000,
      rows: panel ? 5 : 9,
      placeholder: '写下想法，或粘贴图片…',
    });
  content.value = record.content;
  const source = el('textarea', {
    name: panel ? 'url' : 'urls',
    placeholder: '来源链接（可选）',
    rows: 2,
  });
  source.value = rawUrls ?? record.sources.map((s) => s.url).join('\n');
  const tags = el('input', {
      name: 'tags',
      type: 'text',
      value: record.tags.join(', '),
      placeholder: '用逗号分隔',
    }),
    summary = el('textarea', { name: 'summary', maxlength: 2000, rows: 2 });
  summary.value = record.summary;
  const organization = el('input', {
      name: 'organized',
      type: 'checkbox',
      checked: record.organization_state === 'organized',
    }),
    status = el('small', { class: 'muted' }, row?.rev ? '修改保留原 ID' : '输入自动保存为本机草稿'),
    error = el('div', { class: 'error-text', role: 'alert' });
  const preview = el('div', { hidden: true }),
    media = mediaComposer(db, content, {
      attachments: record.attachments,
      onChange: () => {
        dirty = true;
        return flush();
      },
    }),
    notePane = el('section', { 'data-pane': 'note' }),
    snapshotPane = el('section', { 'data-pane': 'snapshot' }),
    listPane = el('section', { 'data-pane': 'list' }),
    groupPane = el('section', { 'data-pane': 'website_group' });
  const save = el(
    'button',
    { type: 'submit', class: 'button primary' },
    row?.rev
      ? '保存修改'
      : record.type === 'list'
        ? '保存清单'
        : panel
          ? '保存到收件箱'
          : '保存到本机',
  );
  const previewButton = button(
    '预览',
    () => {
      previewing = !previewing;
      content.hidden = previewing;
      preview.hidden = !previewing;
      media.root.querySelector('.media-gallery').hidden = previewing;
      preview.querySelector('.markdown')?.dispose?.();
      if (previewing) preview.replaceChildren(markdownPreview(content.value, media.preview()));
      previewButton.textContent = previewing ? '编辑' : '预览';
      changed();
    },
    'link-button',
  );
  let pendingAccess;
  const accessDescription = el('p', { class: 'description' }),
    accessButton = button('允许访问此网站并重试', async () => {
      const access = pendingAccess;
      if (!access || disposed) return;
      error.textContent = '';
      accessButton.disabled = true;
      captureButton.disabled = true;
      try {
        // Request directly in the click handler, before any asynchronous draft work.
        const granted = await chrome.permissions.request({ origins: access.origins });
        if (disposed) return;
        if (!granted) {
          error.textContent = '未获得网站授权。可再次点击授权，也可以手动粘贴内容。';
          return;
        }
        await capturePage(access);
      } catch (e) {
        error.textContent = `网站授权失败：${e.message}。可以手动粘贴内容。`;
      } finally {
        accessButton.disabled = false;
        captureButton.disabled = false;
      }
    }),
    accessNotice = el(
      'div',
      { class: 'capture-access', hidden: true, role: 'status' },
      accessDescription,
      accessButton,
    ),
    captureButton = button('捕获当前网页', () => capturePage(), 'link-button');
  function resetAccess() {
    pendingAccess = null;
    accessNotice.hidden = true;
  }
  async function capturePage(target) {
    error.textContent = '';
    resetAccess();
    captureButton.disabled = true;
    try {
      if (media.recording) throw new Error('请先停止录音，再捕获网页。');
      await flush();
      const response = await chrome.runtime.sendMessage({
        type: 'capture-active',
        snapshot: target ? target.snapshot : record.type === 'snapshot',
        ...(target ? { target: { tabId: target.tabId, url: target.url } } : {}),
      });
      if (disposed) return;
      if (!response?.ok) {
        if (response?.access) {
          pendingAccess = response.access;
          accessDescription.textContent = pendingAccess.snapshot
            ? 'Chrome 的页面截图接口需要所有网站访问权限，或通过点击工具栏扩展图标取得当前页临时权限。授权只用于你主动触发的捕获；也可回到网页点击扩展图标后重试。'
            : `读取 ${pendingAccess.site} 的选中文字需要访问该网站。点击下方按钮，在 Chrome 中确认后自动重试。也可回到网页点击工具栏扩展图标后重试。`;
          accessButton.textContent = pendingAccess.snapshot
            ? '允许所有网站访问并重试截图'
            : '允许访问此网站并重试';
          accessNotice.hidden = false;
        }
        throw new Error(response?.error || '捕获失败。');
      }
      await onNavigate('capture', response.result.record);
    } catch (e) {
      error.textContent = e.message;
    } finally {
      captureButton.disabled = false;
    }
  }
  notePane.append(
    el(
      'div',
      { class: 'editor-toolbar' },
      el('span', { class: 'field-label' }, '内容 · Markdown'),
      previewButton,
    ),
    content,
    preview,
    media.root,
    field('来源', source),
  );
  const snapshotDisplay = el('div', { class: 'snapshot-display' });
  snapshotPane.append(
    el('p', { class: 'description' }, '截取当前网页可见区域的页面图片，并保留来源链接。'),
    snapshotDisplay,
  );
  function renderSnapshot() {
    snapshotDisplay.querySelectorAll('.asset-view').forEach((v) => v.dispose?.());
    snapshotDisplay.replaceChildren();
    if (snapshot) {
      const descriptor = media.attachments.find((a) => a.id === snapshot.asset_id);
      if (snapshot.format === 'mhtml')
        snapshotDisplay.append(
          el('small', { class: 'muted' }, '旧版网页文件已保留，新快照使用页面图片。'),
        );
      snapshotDisplay.append(
        el(
          'a',
          { href: safeUrl(snapshot.url), target: '_blank', rel: 'noopener noreferrer' },
          snapshot.title || snapshot.url,
        ),
        el('p', { class: 'muted' }, snapshot.url),
        assetView(descriptor, {
          local: async (d) => (await db.getAsset(d.id))?.blob,
          load: (d) => loadAsset(db, d),
        }),
      );
    } else
      snapshotDisplay.append(
        el('p', { class: 'muted' }, '尚未捕获快照，请打开目标网页后点击“捕获当前网页”。'),
      );
  }
  function changed() {
    dirty = true;
    cacheDraft(draftKey, draftValue());
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch((e) => (status.textContent = e.message)), 300);
  }
  let listMode = draftUi.listMode !== false;
  const pendingEntries = { true: draftUi.listEntryTodo || '', false: draftUi.listEntryIdea || '' };
  const listRows = el('div', { class: 'list-composer-rows' });
  const listEntry = el('input', {
    type: 'text',
    maxlength: 5000,
    'aria-label': '添加清单项',
    placeholder: '写一项，按 Enter 添加；输入 --- 添加分隔线',
  });
  listEntry.addEventListener('input', () => {
    pendingEntries[listMode] = listEntry.value;
  });
  function commitEntry() {
    const text = listEntry.value.trim();
    if (!text) return;
    const incoming = parseListMarkdown(text, listMode);
    items.push(...incoming);
    pendingEntries[listMode] = '';
    listEntry.value = '';
    renderList();
    changed();
  }
  listEntry.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      commitEntry();
    }
  });
  const listMd = el('textarea', {
    name: 'list_markdown',
    rows: 10,
    'aria-label': '清单 Markdown',
    placeholder: '- [ ] 写下一项待办\n- [x] 已完成\n---',
  });
  const listModes = el(
    'div',
    { class: 'list-modes', role: 'tablist', 'aria-label': '清单模式' },
    ...[
      [true, 'Todo'],
      [false, 'Idea'],
    ].map(([mode, label]) => {
      const node = button(
        label,
        () => {
          listMode = mode;
          renderList();
          changed();
        },
        'type-tab',
      );
      node.dataset.mode = String(mode);
      node.setAttribute('role', 'tab');
      return node;
    }),
  );
  function renderList() {
    for (const node of listModes.children) {
      node.classList.toggle('active', node.dataset.mode === String(listMode));
      node.setAttribute('aria-selected', String(node.dataset.mode === String(listMode)));
    }
    listMd.value = listMarkdown(items, listMode);
    listEntry.value = pendingEntries[listMode];
    listEntry.placeholder = listMode
      ? '写一项，按 Enter 生成待办；--- 添加分隔线'
      : '写一个想法，按 Enter 添加；--- 添加分隔线';
    listRows.replaceChildren(
      ...items
        .filter((item) => item.is_checkbox === listMode)
        .map((item) => {
          const remove = button(
            icon('trash'),
            () => {
              items = items.filter((i) => i.id !== item.id);
              renderList();
              changed();
            },
            'icon-button',
          );
          remove.setAttribute('aria-label', `删除清单项 ${item.text || '分隔线'}`);
          if (item.kind === 'divider')
            return el('div', { class: 'list-composer-row' }, el('hr'), remove);
          const text = el('input', {
            type: 'text',
            value: item.text,
            maxlength: 5000,
            'aria-label': `清单内容 ${item.text}`,
          });
          text.addEventListener('input', () => {
            item.text = text.value;
            listMd.value = listMarkdown(items, listMode);
          });
          text.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              listEntry.focus();
            }
          });
          const check = listMode
            ? el('input', {
                type: 'checkbox',
                checked: item.checked,
                'aria-label': `完成 ${item.text}`,
                onchange: (e) => {
                  item.checked = e.target.checked;
                  text.classList.toggle('completed', item.checked);
                  listMd.value = listMarkdown(items, listMode);
                  changed();
                },
              })
            : el('span', {}, '•');
          text.classList.toggle('completed', item.checked);
          return el('div', { class: 'list-composer-row' }, check, text, remove);
        }),
    );
    listMd.placeholder = listMode
      ? '- [ ] 写下一项待办\n- [x] 已完成\n---'
      : '- 写下一条想法\n- 另一条想法\n---';
  }
  listMd.addEventListener('input', () => {
    items = parseListMarkdown(listMd.value, listMode, items);
    const selection = [listMd.selectionStart, listMd.selectionEnd];
    renderList();
    listMd.setSelectionRange(...selection);
    changed();
  });
  listPane.append(
    listModes,
    el(
      'p',
      { class: 'description' },
      '逐行输入，按 Enter 添加。Todo 自动生成复选框，Idea 生成条目；--- 生成分隔线。内容保存为 Markdown。',
    ),
    listRows,
    listEntry,
    el('details', { class: 'list-source' }, el('summary', {}, 'Markdown 源码'), listMd),
  );
  const urlRows = el('div', { class: 'url-editor' }),
    urlInput = el('input', { type: 'url', name: 'website_url', placeholder: '粘贴网页链接' }),
    urlTitle = el('input', {
      type: 'text',
      name: 'website_title',
      placeholder: '网页标题（可选）',
    }),
    closeTabs = el('input', {
      type: 'checkbox',
      checked: draftUi.closeTabs !== false,
      name: 'close_tabs',
    }),
    dropZone = el(
      'div',
      { class: 'website-drop-zone', tabindex: 0 },
      '拖入网页中的链接，或从插件列表拖入',
    ),
    tabDrawer = el('div', { class: 'tab-drawer', hidden: true });
  function renderUrls() {
    urlRows.replaceChildren(
      ...urls.map((item) => {
        const remove = button(
          item.removed_at ? '恢复' : icon('trash'),
          () => {
            item.removed_at = item.removed_at ? null : new Date().toISOString();
            renderUrls();
            changed();
          },
          'icon-button',
        );
        remove.setAttribute(
          'aria-label',
          `${item.removed_at ? '恢复' : '删除'}网页 ${item.title || '网页'}`,
        );
        return el(
          'div',
          {
            class: `url-row browser-tab${item.read_at ? ' completed' : ''}${item.removed_at ? ' removed' : ''}`,
          },
          el('input', {
            type: 'checkbox',
            checked: !!item.read_at,
            'aria-label': `已读 ${item.title || item.url}`,
            onchange: (e) => {
              item.read_at = e.target.checked ? new Date().toISOString() : null;
              changed();
            },
          }),
          websiteLink(item),
          remove,
        );
      }),
    );
  }
  function addUrls(values, tabs = []) {
    error.textContent = '';
    urls = mergeUrls(urls, values);
    pendingTabs.push(...tabs);
    renderUrls();
    changed();
    status.textContent = `已加入 ${values.length} 个网页，保存成功后才关闭标签页。`;
  }
  async function chooseTabs(persist = true) {
    tabDrawer.hidden = false;
    if (persist) changed();
    tabDrawer.replaceChildren(el('small', { class: 'muted' }, '读取已打开网页…'));
    const values = await openWebsiteTabs(),
      selected = selectedTabIds,
      all = el('input', { type: 'checkbox', 'aria-label': '选择全部标签页' }),
      rows = [];
    if (disposed) return;
    for (const id of selected) if (!values.some((tab) => tab.id === id)) selected.delete(id);
    all.checked = !!values.length && selected.size === values.length;
    const master = el('label', { class: 'checkbox-line' }, all, '选择全部（固定标签页保留）');
    for (const tab of values) {
      const input = el('input', {
          type: 'checkbox',
          checked: selected.has(tab.id),
          'aria-label': `选择标签页 ${tab.title}`,
          onchange: () => {
            input.checked ? selected.add(tab.id) : selected.delete(tab.id);
            all.checked = selected.size === values.length;
            changed();
          },
        }),
        node = el(
          'div',
          { class: 'tab-row', draggable: true, 'data-tab-id': tab.id },
          input,
          websiteLabel(tab),
          el('span', {}, '拖入 ↘'),
        );
      node.addEventListener('dragstart', (e) => {
        const dragged = selected.has(tab.id) ? values.filter((v) => selected.has(v.id)) : [tab];
        e.dataTransfer.setData('application/x-pkm-tab', JSON.stringify(dragged));
        e.dataTransfer.setData('text/uri-list', dragged.map((t) => t.url).join('\n'));
        e.dataTransfer.effectAllowed = 'copy';
      });
      rows.push({ node, input, tab });
    }
    all.addEventListener('change', () => {
      selected.clear();
      rows.forEach(({ input, tab }) => {
        input.checked = all.checked;
        if (all.checked) selected.add(tab.id);
      });
      changed();
    });
    const addSelected = button(
      '加入所选网页',
      () => {
        const chosen = values.filter((t) => selected.has(t.id));
        if (!chosen.length) {
          status.textContent = '请先选择网页。';
          return;
        }
        tabDrawer.hidden = true;
        selected.clear();
        addUrls(chosen.map(websiteItem), chosen);
      },
      'button primary small',
    );
    tabDrawer.replaceChildren(
      el('div', { class: 'tab-drawer-actions' }, addSelected, master),
      ...rows.map((r) => r.node),
      ...(!values.length ? [el('p', {}, '这个窗口没有可归类的网页。')] : []),
    );
  }
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    status.textContent = '正在读取链接标题…';
    try {
      const result = await droppedWebsites(e.dataTransfer);
      if (!result.items.length)
        throw new Error('没有识别到网页链接。请从网页中拖动链接，或使用“选择已打开网页”。');
      addUrls(result.items, result.tabs);
    } catch (err) {
      error.textContent = err.message;
    }
  });
  groupPane.append(
    el(
      'p',
      { class: 'description' },
      '多选已打开网页批量归组。请勿从浏览器顶部标签栏拖入，那会变成新窗口。未授权读取标题时显示网站域名，链接仍可保存，也可自行填写标题。',
    ),
    el(
      'div',
      { class: 'website-add' },
      urlInput,
      urlTitle,
      button(
        '加入链接',
        async () => {
          try {
            if (!safeUrl(urlInput.value)) throw new Error('请输入 HTTP / HTTPS 链接。');
            status.textContent = '正在读取网页标题…';
            const url = urlInput.value;
            const title = urlTitle.value.trim() || (await websiteTitle(url));
            if (disposed) return;
            addUrls([websiteItem({ url, title })]);
            if (urlInput.value === url) {
              urlInput.value = '';
              urlTitle.value = '';
            }
          } catch (e) {
            error.textContent = e.message;
          }
        },
        'button small',
      ),
    ),
    button(
      '选择已打开网页',
      () => chooseTabs().catch((e) => (error.textContent = e.message)),
      'button small',
    ),
    tabDrawer,
    dropZone,
    el('label', { class: 'checkbox-line' }, closeTabs, '保存后关闭加入的标签页'),
    urlRows,
  );
  const panes = {
    note: notePane,
    snapshot: snapshotPane,
    list: listPane,
    website_group: groupPane,
  };
  for (const [type, label] of Object.entries(TYPES)) {
    const tab = button(
      label,
      async () => {
        if (type === record.type) {
          if (type === 'list') {
            await flush();
            await onNavigate(type);
          }
          return;
        }
        if (media.recording) {
          error.textContent = '请先停止录音。';
          return;
        }
        await flush();
        if (type === 'list' || record.type === 'list' || row?.rev) {
          await onNavigate(type);
          return;
        }
        record = { ...record, type, snapshot: null, list: [], url_list: [] };
        snapshot = null;
        items = [];
        urls = [];
        pendingTabs = [];
        render();
        changed();
      },
      'type-tab',
    );
    tab.setAttribute('role', 'tab');
    tab.dataset.type = type;
    tabs.append(tab);
  }
  const extra = el(
    'div',
    { class: 'editor-extra' },
    field('标签', tags),
    field('人工总结（可选）', summary),
    el('label', { class: 'checkbox-line' }, organization, '已整理'),
  );
  extra.hidden = panel;
  root.classList.toggle('simple-editor', simple);
  root.append(
    tabs,
    el('div', { class: 'editor-toolbar' }, heading, captureButton),
    accessNotice,
    title,
    ...Object.values(panes),
    extra,
    error,
    el(
      'div',
      { class: 'editor-save row' },
      save,
      button(
        panel ? (row?.rev ? '取消编辑' : '清空') : '取消',
        async () => {
          if (media.recording) {
            error.textContent = '请先停止录音。';
            return;
          }
          if (panel) {
            await clearDraft(db, draftKey);
            disposed = true;
          } else await flush();
          await onCancel();
        },
        'button small',
      ),
      status,
    ),
  );
  function values() {
    const now = new Date().toISOString(),
      oldSources = new Map(record.sources.map((s) => [s.url, s])),
      sources = [
        ...new Set(
          source.value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ].map(
        (url) =>
          oldSources.get(url) || { url, title: title.value, captured_at: now, kind: 'manual' },
      );
    return {
      ...record,
      schema_version: urls.some((u) => u.removed_at !== undefined)
        ? 5
        : Math.max(4, record.schema_version),
      title:
        record.type === 'list'
          ? ''
          : title.value.trim() ||
            content.value.trim().slice(0, 60) ||
            (record.type === 'website_group'
              ? '待读网页'
              : record.type === 'list'
                ? ''
                : snapshot?.title || sources[0]?.url || '未命名记录'),
      content:
        record.type === 'list' ? listDocument(items, record.content, record.list) : content.value,
      summary: summary.value,
      tags: [
        ...new Set(
          tags.value
            .split(/[,，\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ],
      sources,
      attachments: media.attachments,
      organization_state: row?.rev && organization.checked ? 'organized' : 'inbox',
      snapshot: record.type === 'snapshot' ? snapshot : null,
      list: record.type === 'list' ? items : [],
      url_list: record.type === 'website_group' ? urls : [],
      updated_at: now,
    };
  }
  function draftValue() {
    const value = values();
    return {
      record: { ...value, title: title.value, sources: record.sources },
      rawUrls: source.value,
      expectedRev: row?.rev || 0,
      pendingTabs,
      savedAt: Date.now(),
      ui: {
        listMode,
        previewing,
        closeTabs: closeTabs.checked,
        urlInput: urlInput.value,
        urlTitle: urlTitle.value,
        tabDrawerOpen: !tabDrawer.hidden,
        selectedTabs: [...selectedTabIds],
        collectedIds: [...collectedIds],
        listEntryTodo: pendingEntries.true,
        listEntryIdea: pendingEntries.false,
      },
    };
  }
  async function flush({ force = false } = {}) {
    clearTimeout(timer);
    if (disposed || saving || (!dirty && !force)) return;
    dirty = false;
    if (
      !panel &&
      !row?.rev &&
      record.type === 'note' &&
      !title.value.trim() &&
      !content.value.trim() &&
      !source.value.trim() &&
      !items.length &&
      !urls.length &&
      !media.attachments.length
    ) {
      await clearDraft(db, draftKey);
      return;
    }
    const value = draftValue();
    cacheDraft(draftKey, value);
    try {
      await db.setState(draftKey, value);
    } catch (error) {
      dirty = true;
      throw error;
    }
    status.textContent = '草稿已保存到本机';
  }
  root.addEventListener('input', changed);
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    save.disabled = true;
    clearTimeout(timer);
    try {
      if (media.recording) throw new Error('请先停止录音。');
      if (record.type === 'list') commitEntry();
      const value = normalizeRecord(values());
      if (value.type === 'snapshot' && !value.snapshot) throw new Error('请先捕获网页快照。');
      if (value.type === 'website_group' && !value.url_list.length)
        throw new Error('请先加入网页。');
      if (
        value.type === 'note' &&
        !content.value.trim() &&
        !title.value.trim() &&
        !value.sources.length &&
        !value.attachments.length
      )
        throw new Error('请填写记录或添加图片、录音。');
      saving = true;
      const result = await onSave(value, row);
      if (result?.status === 'duplicate') {
        status.textContent = '发现相关记录，已保留到待处理收集；标签页没有关闭。';
        pendingTabs = [];
      } else if (closeTabs.checked && pendingTabs.length) {
        const closed = await closeCapturedTabs(pendingTabs, value);
        status.textContent = `已保存并关闭 ${closed.closed.length} 个标签页${closed.skipped.length ? '；导航变化或无法关闭的标签页已保留' : ''}`;
      } else status.textContent = '已保存到本机，等待同步。';
      await clearDraft(db, draftKey);
      if (closeSourceKey) await db.setState(closeSourceKey, null);
      disposed = true;
      await onCancel({ saved: true, message: status.textContent });
    } catch (err) {
      error.textContent = err.message;
    } finally {
      saving = false;
      save.disabled = false;
    }
  });
  function render() {
    resetAccess();
    for (const [type, pane] of Object.entries(panes)) pane.hidden = type !== record.type;
    for (const tab of tabs.children) {
      tab.classList.toggle('active', tab.dataset.type === record.type);
      tab.setAttribute('aria-selected', String(tab.dataset.type === record.type));
    }
    title.hidden = record.type === 'list' || simple;
    heading.hidden = record.type === 'list';
    captureButton.hidden = !['note', 'snapshot'].includes(record.type);
    captureButton.textContent = record.type === 'snapshot' ? '捕获网页快照' : '捕获当前网页';
    renderSnapshot();
    renderList();
    renderUrls();
  }
  const unsubscribeTags = db.onChange((_kind, detail) => {
    if (!detail?.tagRename) return;
    const { from, to } = detail.tagRename;
    tags.value = [
      ...new Set(
        tags.value
          .split(/[,，\n]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
          .map((tag) => (tag === from ? to : tag)),
      ),
    ].join(', ');
  });
  tabs.hidden = !panel && !!row?.rev;
  render();
  urlInput.value = draftUi.urlInput || '';
  urlTitle.value = draftUi.urlTitle || '';
  if (draftUi.previewing) {
    previewButton.click();
    clearTimeout(timer);
    dirty = !!recovered;
  }
  if (record.type === 'website_group' && draftUi.tabDrawerOpen)
    chooseTabs(false).catch((e) => (error.textContent = e.message));
  if (record.type === 'website_group')
    for (const item of urls.filter((item) => isPlaceholderTitle(item.title, item.url))) {
      websiteTitle(item.url)
        .then((title) => {
          if (disposed || !urls.some((url) => url.id === item.id)) return;
          item.title = title;
          renderUrls();
          changed();
        })
        .catch(() => {});
    }
  return {
    root,
    save,
    flush,
    async collect(incoming, nonce = incoming.id) {
      if (disposed || saving || record.type !== 'note') return false;
      save.disabled = true;
      try {
        if (!collectedIds.has(nonce)) {
          const next = appendCollected({ ...values(), sources: record.sources }, incoming);
          record = next;
          if (!title.value.trim()) title.value = incoming.title;
          content.value = next.content;
          source.value = [
            ...new Set(
              [...source.value.split('\n'), ...incoming.sources.map((s) => s.url)].filter(Boolean),
            ),
          ].join('\n');
          media.setAttachments(next.attachments);
          collectedIds.add(nonce);
          if (previewing) {
            preview.querySelector('.markdown')?.dispose?.();
            preview.replaceChildren(markdownPreview(content.value, media.preview()));
          }
          changed();
        }
        await flush({ force: true });
        return true;
      } finally {
        if (!disposed && !saving) save.disabled = false;
      }
    },
    get preferences() {
      return { closeTabs: closeTabs.checked, listMode };
    },
    get recording() {
      return media.recording;
    },
    destroy() {
      disposed = true;
      clearTimeout(timer);
      media.destroy();
      unsubscribeTags();
      preview.querySelector('.markdown')?.dispose?.();
      snapshotDisplay.querySelectorAll('.asset-view').forEach((v) => v.dispose?.());
    },
    get type() {
      return record.type;
    },
  };
}

const $ = (id) => document.getElementById(id);
let view = 'all',
  offset = 0,
  query = '',
  editing = null,
  status = null,
  queryTimer,
  pollTimer;
let displayedGoogleAccount = null;
const names = {
  note: '普通记录',
  snapshot: '网页快照',
  list: '清单',
  website_group: '网页组',
  project: '项目规则',
  tombstone: '删除标记',
};
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
async function api(command, payload = {}) {
  const response = await fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, payload }),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || '操作失败');
  return result.result;
}
function notice(text, error = false) {
  $('notice').hidden = false;
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
}
const action = (fn) => async () => {
  try {
    await fn();
  } catch (error) {
    notice(error.message, true);
    if ($('settings-dialog').open) $('settings-error').textContent = error.message;
  }
};
async function refreshStatus() {
  status = await api('status');
  if (status.externalRecovery?.length)
    notice(
      `${status.externalRecovery.length} 份尚未导入的外部修改已保留在资料库 .nexus/recovery/external 中。`,
    );
  $('vault-label').textContent = status.vaultPath;
  $('sync-status').textContent = status.lastError
    ? `上次同步失败：${status.lastError.message}`
    : status.lastSync
      ? `上次同步 ${new Date(status.lastSync.at).toLocaleString()} · ${status.lastSync.conflicts} 条冲突`
      : '尚未同步到 Google Drive';
  return status;
}
async function refresh() {
  const result = await api('records.list', { view, query, offset, limit: 30 });
  $('heading').textContent = { all: '全部资料', trash: '回收站', conflicts: '待处理冲突' }[view];
  $('count').textContent = `${result.total} 条资料`;
  $('page').textContent = `第 ${Math.floor(offset / 30) + 1} 页`;
  $('previous').disabled = offset === 0;
  $('next').disabled = !result.hasMore;
  $('records').replaceChildren();
  for (const item of result.items) {
    const card = node('article', undefined, 'card');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `打开 ${item.title || names[item.type] || '记录'}`);
    card.append(
      node(
        'h2',
        item.title || (item.type === 'list' ? 'Todo / Idea' : names[item.type] || '未命名记录'),
      ),
      node('p', item.summary || '打开查看内容'),
    );
    const badges = node('div', undefined, 'badges');
    badges.append(node('span', names[item.type] || '记录', 'badge'));
    if (item.conflict) badges.append(node('span', '需要处理冲突', 'badge conflict'));
    for (const tag of item.tags || []) badges.append(node('span', tag, 'badge'));
    card.append(badges);
    card.addEventListener(
      'click',
      action(() => edit(item.id)),
    );
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') action(() => edit(item.id))();
    });
    $('records').append(card);
  }
  if (!result.items.length)
    $('records').append(
      node(
        'p',
        view === 'all'
          ? '还没有资料。在浏览器扩展中连接本地程序后，已保存的内容会出现在这里。'
          : '这里暂时没有资料。',
        'muted',
      ),
    );
  await refreshStatus();
}
async function edit(id) {
  editing = await api('records.get', { id });
  if (!editing) return;
  $('edit-error').textContent = '';
  $('title').value = editing.record.title || '';
  $('title').disabled =
    ['list'].includes(editing.record.type) || editing.record.kind === 'tombstone';
  $('content').value = editing.record.content || '';
  $('tags').value = (editing.record.tags || []).join(', ');
  $('organized').checked = editing.record.organization_state === 'organized';
  $('record-json').textContent = JSON.stringify(editing.record, null, 2);
  $('conflict-versions').replaceChildren();
  $('attachments').replaceChildren();
  $('structured').replaceChildren();
  $('delete').textContent = editing.record.deleted_at ? '还原记录' : '移入回收站';
  $('delete').disabled = editing.record.kind === 'tombstone' || editing.heads.length > 1;
  $('edit-form').querySelector('[type=submit]').disabled = editing.record.kind === 'tombstone';
  if (editing.heads.length > 1) {
    $('edit-heading').textContent = '处理版本冲突';
    for (const version of await api('records.conflicts', { id })) {
      const box = node('div', undefined, 'version');
      box.append(
        node('p', `版本 ${version.revision.slice(0, 12)}`),
        node('pre', JSON.stringify(version.record, null, 2)),
      );
      const choose = node('button', '采用此版本');
      choose.type = 'button';
      choose.addEventListener(
        'click',
        action(async () => {
          await api('records.resolve', { record: version.record, parents: editing.heads });
          $('editor').close();
          await refresh();
          notice('已处理冲突，下一次同步会传播选择。');
        }),
      );
      box.append(choose);
      $('conflict-versions').append(box);
    }
  } else $('edit-heading').textContent = '编辑资料';
  for (const item of editing.record.list || []) {
    if (item.kind === 'divider') {
      $('structured').append(node('hr'));
      continue;
    }
    const row = node('label', undefined, 'structured-row');
    if (item.is_checkbox) {
      const check = node('input');
      check.type = 'checkbox';
      check.checked = item.checked;
      check.addEventListener('change', () => {
        item.checked = check.checked;
      });
      row.append(check);
    }
    row.append(node('span', item.text));
    $('structured').append(row);
  }
  for (const item of editing.record.url_list || []) {
    const row = node('div', undefined, 'structured-row'),
      check = node('input');
    check.type = 'checkbox';
    check.checked = !!item.read_at;
    check.setAttribute('aria-label', `已读 ${item.title}`);
    check.addEventListener('change', () => {
      item.read_at = check.checked ? new Date().toISOString() : null;
    });
    const link = node('a', item.title || item.url);
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.append(check, link);
    $('structured').append(row);
  }
  for (const descriptor of editing.record.attachments || []) {
    const button = node('button', `加载 ${descriptor.name}`);
    button.type = 'button';
    button.addEventListener(
      'click',
      action(async () => {
        button.disabled = true;
        try {
          const chunks = [];
          let position = 0;
          for (;;) {
            const result = await api('assets.read', { descriptor, offset: position });
            chunks.push(Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0)));
            position = result.offset;
            if (result.done) break;
          }
          const url = URL.createObjectURL(new Blob(chunks, { type: descriptor.mime_type }));
          const media = node(
            descriptor.kind === 'image' ? 'img' : descriptor.kind === 'audio' ? 'audio' : 'a',
          );
          if (descriptor.kind === 'image') {
            media.src = url;
            media.alt = descriptor.name;
          } else if (descriptor.kind === 'audio') {
            media.src = url;
            media.controls = true;
          } else {
            media.href = url;
            media.download = descriptor.name;
            media.textContent = '下载 ' + descriptor.name;
          }
          $('attachments').append(media);
          $('editor').addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
          button.remove();
        } finally {
          button.disabled = false;
        }
      }),
    );
    $('attachments').append(button);
  }
  $('editor').showModal();
}
$('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const record = {
      ...editing.record,
      title: editing.record.type === 'list' ? '' : $('title').value,
      content: $('content').value,
      tags: [
        ...new Set(
          $('tags')
            .value.split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ],
      organization_state: $('organized').checked ? 'organized' : 'inbox',
      updated_at: new Date().toISOString(),
    };
    if (editing.heads.length > 1) await api('records.resolve', { record, parents: editing.heads });
    else await api('records.put', { record, parentRevision: editing.revision });
    $('editor').close();
    await refresh();
    notice('修改已保存到本机。');
  } catch (error) {
    $('edit-error').textContent = error.message;
  }
});
$('delete').addEventListener(
  'click',
  action(async () => {
    await api('records.trash', {
      id: editing.record.id,
      revision: editing.revision,
      restore: !!editing.record.deleted_at,
    });
    $('editor').close();
    await refresh();
  }),
);
for (const button of document.querySelectorAll('[data-close]'))
  button.addEventListener('click', () => button.closest('dialog').close());
for (const button of document.querySelectorAll('[data-view]'))
  button.addEventListener(
    'click',
    action(async () => {
      view = button.dataset.view;
      offset = 0;
      document
        .querySelectorAll('[data-view]')
        .forEach((b) => b.classList.toggle('active', b === button));
      await refresh();
    }),
  );
$('search').addEventListener('input', () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(
    action(async () => {
      query = $('search').value;
      offset = 0;
      await refresh();
    }),
    200,
  );
});
$('previous').addEventListener(
  'click',
  action(async () => {
    offset = Math.max(0, offset - 30);
    await refresh();
  }),
);
$('next').addEventListener(
  'click',
  action(async () => {
    offset += 30;
    await refresh();
  }),
);
$('refresh').addEventListener('click', action(refresh));
$('sync').addEventListener(
  'click',
  action(async () => {
    $('sync').disabled = true;
    notice('正在同步…');
    try {
      const result = await api('drive.sync');
      await refresh();
      notice(
        `同步完成：上传 ${result.pushed} 项，拉取 ${result.pulled} 项，${result.conflicts} 条冲突。`,
      );
    } finally {
      $('sync').disabled = false;
    }
  }),
);
async function settingsStatus({ refreshInputs = true } = {}) {
  await refreshStatus();
  if (refreshInputs) $('vault-path').value = status.vaultPath;
  $('registered').textContent = status.origins.length
    ? `已连接 ${status.origins.length} 个扩展`
    : '尚未连接扩展';
  $('google-status').textContent = status.google.pending
    ? '等待浏览器授权…'
    : status.google.result?.message ||
      (status.google.connected
        ? 'Google Drive 已授权'
        : status.google.configured
          ? '应用已配置 Google 登录，请选择自己的账号并授权。'
          : '此开发包尚未配置 Google 登录，需由应用开发者配置一次 OAuth 客户端。普通用户无需创建 Google Cloud 项目。');
  const account = status.google.account;
  $('google-account').textContent = status.google.connected
    ? `当前账号：${account?.email || account?.name || '已授权，请重新登录以显示账号'}。资料同步到此账号自己的 Drive。`
    : '当前账号：尚未登录';
  $('connect-google').textContent = status.google.connected
    ? '切换 / 重新登录 Google 账号'
    : '登录自己的 Google 账号';
  if (!status.google.configured) $('google-app-setup').open = true;
  $('connect-google').disabled = !status.google.configured || status.google.pending;
  $('disconnect-google').disabled = !status.google.connected;
  for (const id of ['load-folders', 'bind-folder', 'create-folder'])
    $(id).disabled = !status.google.connected;
  const identity = account?.id || (status.google.connected ? 'legacy' : null);
  if (identity !== displayedGoogleAccount) $('drive-folders').replaceChildren();
  displayedGoogleAccount = identity;
  $('auto-sync').checked = status.autoSync;
  $('binding').textContent = status.binding
    ? status.binding.accountId && account && status.binding.accountId !== account.id
      ? '当前账号与资料库原绑定账号不同，已停止云端读写。请登录原账号，或选择另一个本地资料库。'
      : `当前远程资料库：${status.binding.name} · ${status.binding.id}${status.binding.accountEmail ? ' · ' + status.binding.accountEmail : ''}`
    : '尚未选择远程资料库';
}
$('settings').addEventListener(
  'click',
  action(async () => {
    $('settings-error').textContent = '';
    await settingsStatus();
    $('settings-dialog').showModal();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if ($('settings-dialog')?.open) action(() => settingsStatus({ refreshInputs: false }))();
    }, 2000);
  }),
);
$('choose-vault').addEventListener(
  'click',
  action(async () => {
    await api('vault.select', { path: $('vault-path').value });
    await settingsStatus();
    await refresh();
  }),
);
$('import-external').addEventListener(
  'click',
  action(async () => {
    const result = await api('records.import-external');
    notice(`已导入 ${result.imported} 条外部修改。`);
    await refresh();
  }),
);
$('register').addEventListener(
  'click',
  action(async () => {
    await api('native.register', { extensionId: $('extension-id').value.trim() });
    await settingsStatus();
    notice('扩展已注册，请返回扩展设置连接本地程序。');
  }),
);
$('oauth-file').addEventListener(
  'change',
  action(async () => {
    const file = $('oauth-file').files[0];
    if (!file) return;
    if (file.size > 65536) throw new Error('OAuth 客户端配置文件过大。');
    await api('google.configure', { client: JSON.parse(await file.text()) });
    $('oauth-file').value = '';
    await settingsStatus();
  }),
);
$('connect-google').addEventListener('click', () => {
  const popup = window.open('about:blank', 'pkm-google-oauth');
  if (popup) popup.opener = null;
  action(async () => {
    try {
      const result = await api('google.connect');
      if (popup) popup.location = result.url;
      else notice('浏览器阻止了授权窗口，请允许此页面弹出窗口后重试。', true);
      await settingsStatus();
    } catch (error) {
      popup?.close();
      throw error;
    }
  })();
});
$('disconnect-google').addEventListener(
  'click',
  action(async () => {
    await api('google.disconnect');
    await settingsStatus();
  }),
);
$('load-folders').addEventListener(
  'click',
  action(async () => {
    const folders = await api('drive.folders');
    $('drive-folders').replaceChildren(
      ...folders.map((folder) => {
        const option = node('option', folder.name);
        option.value = folder.id;
        return option;
      }),
    );
  }),
);
$('bind-folder').addEventListener(
  'click',
  action(async () => {
    await api('drive.bind', { id: $('drive-folders').value });
    await settingsStatus();
  }),
);
$('create-folder').addEventListener(
  'click',
  action(async () => {
    await api('drive.create', { name: $('new-folder').value });
    await settingsStatus();
  }),
);
$('disconnect-system').addEventListener(
  'click',
  action(async () => {
    await api('system.disconnect');
    await settingsStatus();
    notice('已断开扩展连接并关闭自动同步。资料库保留，可从托盘退出助手。');
  }),
);
$('auto-sync').addEventListener(
  'change',
  action(async () => {
    try {
      await api('schedule.set', { enabled: $('auto-sync').checked });
    } finally {
      await settingsStatus();
    }
  }),
);
$('quit').addEventListener(
  'click',
  action(async () => {
    await api('app.quit');
    clearInterval(pollTimer);
    document.body.replaceChildren(
      node('p', '本地管理程序已关闭，可以关闭这个标签页。已启用的 Windows 定时同步任务不受影响。'),
    );
  }),
);
async function start() {
  const showSettings = new URLSearchParams(location.search).get('settings') === '1';
  const bootstrap = location.hash.slice(1);
  if (bootstrap) {
    const response = await fetch('/session', {
      method: 'POST',
      headers: { 'X-PKM-Bootstrap': bootstrap },
    });
    if (!response.ok) throw new Error('管理会话已过期，请从开始菜单重新打开 PKM Nexus。');
    history.replaceState(null, '', '/');
  }
  await refresh();
  if (showSettings) $('settings').click();
}
start().catch((error) => notice(error.message, true));

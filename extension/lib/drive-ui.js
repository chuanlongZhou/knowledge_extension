import { el, button, field, option } from './dom.js';
export async function driveCommand(command, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type: 'drive-command', command, ...payload });
  if (!result?.ok) throw new Error(result?.error || 'Google Drive 操作未完成，浏览器数据仍保留。');
  return result.result;
}
export async function driveSettings(db) {
  const root = el('section', {
    class: 'settings-section drive-settings',
    'aria-label': 'Google Drive 同步',
  });
  const status = el('p', { class: 'description', role: 'status' });
  const controls = el('div', { class: 'drive-settings-controls' });
  const run = (task) => async (event) => {
    const trigger = event.currentTarget;
    trigger.disabled = true;
    try {
      await task();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      trigger.disabled = false;
    }
  };
  async function render() {
    const { driveAccount } = await chrome.storage.local.get('driveAccount');
    const binding = await db.getState('drive:binding');
    controls.replaceChildren();
    status.textContent = driveAccount
      ? `已登录：${driveAccount.email || driveAccount.name}。${binding ? `当前文件夹：${binding.name}` : '请选择或新建数据文件夹。'}`
      : '尚未登录。浏览器里的记录可以继续离线编辑和导出。';
    if (!driveAccount) {
      controls.append(
        button(
          '登录 Google Drive',
          run(async () => {
            status.textContent = '正在打开 Google 登录…';
            await driveCommand('login');
            await render();
          }),
          'button primary',
        ),
      );
      return;
    }
    if (binding) {
      controls.append(
        el(
          'p',
          {},
          el(
            'a',
            {
              href: `https://drive.google.com/drive/folders/${binding.folderId}`,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            `打开 ${binding.name}`,
          ),
        ),
      );
      controls.append(
        el(
          'div',
          { class: 'row' },
          button(
            '↓ 同步下载',
            run(async () => {
              status.textContent = '正在同步下载…';
              const r = await driveCommand('sync', { direction: 'download' });
              status.textContent = `下载 ${r.downloaded} 条记录，${r.conflicts} 条冲突。`;
            }),
          ),
          button(
            '↑ 同步上传',
            run(async () => {
              status.textContent = '正在同步上传…';
              const r = await driveCommand('sync', { direction: 'upload' });
              status.textContent = `上传 ${r.uploaded} 条记录，${r.conflicts} 条冲突。`;
            }),
          ),
        ),
      );
    } else {
      const name = el('input', {
        type: 'text',
        value: 'PKM Nexus',
        maxlength: 120,
        'aria-label': '新文件夹名称',
      });
      controls.append(
        el('h4', {}, '第一次使用'),
        field('新文件夹名称', name),
        button(
          '新建并使用文件夹',
          run(async () => {
            status.textContent = '正在新建文件夹…';
            await driveCommand('create-folder', { name: name.value });
            await render();
          }),
        ),
      );
      const folders = el('div', { class: 'drive-folder-choices' });
      controls.append(
        el('h4', {}, '已有数据，连接新设备'),
        el(
          'p',
          { class: 'description' },
          '选择此简化版在同一 Google 账号下创建的文件夹，然后点击同步下载。',
        ),
        button(
          '选择已有文件夹',
          run(async () => {
            const results = await driveCommand('folders');
            if (!results.length) {
              status.textContent =
                '未找到此简化版的数据文件夹。若来自旧版，请先在旧版导出完整 ZIP，再在这里导入并上传。';
              return;
            }
            const select = el(
              'select',
              { 'aria-label': '已有数据文件夹' },
              ...results.map((f) => option(f.id, f.name)),
            );
            folders.replaceChildren(
              field('已有数据文件夹', select),
              button(
                '使用所选文件夹',
                run(async () => {
                  await driveCommand('select-folder', { folderId: select.value });
                  await render();
                }),
              ),
            );
          }),
        ),
        folders,
      );
    }
    controls.append(
      button(
        '退出 Google 登录',
        run(async () => {
          await driveCommand('logout');
          await render();
        }),
        'link-button',
      ),
    );
  }
  root.append(
    el('h3', {}, 'Google Drive'),
    el(
      'p',
      { class: 'description' },
      '登录自己的 Google 账号，选择一个数据文件夹。同步下载只读取云端；同步上传只发送浏览器里的修改。每条记录一个 JSON 文件，图片与音频分别保存。',
    ),
    status,
    controls,
  );
  await render();
  return root;
}

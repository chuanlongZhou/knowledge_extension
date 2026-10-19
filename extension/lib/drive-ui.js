import { t, msg } from './i18n.js';
import { el, button, field, option } from './dom.js';
import { APP_NAME } from './brand.js';
export function metadataSyncStatus(result, direction) {
  const metadata = direction === 'download' ? result.metadataDownloaded : result.metadataUploaded;
  const shortcuts =
    direction === 'download' ? result.shortcutsDownloaded : result.shortcutsUploaded;
  return `${metadata > (shortcuts || 0) ? t('，已同步标签定义') : ''}${shortcuts ? t('，已同步常用网站') : ''}`;
}
export async function driveCommand(command, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type: 'drive-command', command, ...payload });
  if (!result?.ok)
    throw new Error(result?.error || t('Google Drive 操作未完成，浏览器数据仍保留。'));
  return result.result;
}
export async function driveSettings(db) {
  const root = el('section', {
    class: 'settings-section drive-settings',
    'aria-label': t('Google Drive 同步'),
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
      ? msg`已登录：${driveAccount.email || driveAccount.name}。${binding ? msg`当前文件夹：${binding.name}` : t('请选择或新建数据文件夹。')}`
      : t('尚未登录。浏览器里的记录可以继续离线编辑和导出。');
    if (!driveAccount) {
      controls.append(
        button(
          t('登录 Google Drive'),
          run(async () => {
            status.textContent = t('正在打开 Google 登录…');
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
          'div',
          { class: 'drive-folder-summary' },
          el(
            'div',
            {},
            el('small', { class: 'muted' }, t('当前数据文件夹')),
            el('strong', {}, binding.name),
          ),
          el(
            'a',
            {
              href: `https://drive.google.com/drive/folders/${binding.folderId}`,
              target: '_blank',
              rel: 'noopener noreferrer',
              class: 'button drive-open-folder',
              'aria-label': t('打开 Google Drive 目录'),
              title: msg`打开 ${binding.name}`,
            },
            t('打开 Google Drive 目录 ↗'),
          ),
        ),
      );
      const layoutPreview = el('div', { class: 'drive-layout-preview' });
      controls.append(
        button(
          t('整理云端目录'),
          run(async () => {
            const plan = await driveCommand('preview-layout');
            layoutPreview.replaceChildren(
              el(
                'p',
                { class: 'description' },
                plan.count
                  ? msg`将整理 ${plan.count} 个文件到 records、metadata、assets/images、assets/audio。文件 ID 与内容保留。`
                  : t('云端目录已经整理完成。'),
              ),
            );
            if (!plan.count) return;
            layoutPreview.append(
              el(
                'ul',
                {},
                ...plan.files
                  .slice(0, 8)
                  .map((file) => el('li', {}, `${file.name} → ${file.path}`)),
              ),
              button(
                t('开始整理'),
                run(async () => {
                  status.textContent = t('正在整理云端目录…');
                  const result = await driveCommand('organize-layout');
                  status.textContent = msg`已整理 ${result.moved} 个文件。其他设备请更新扩展后同步下载。`;
                  layoutPreview.replaceChildren();
                }),
              ),
            );
          }),
        ),
        layoutPreview,
        el(
          'small',
          { class: 'muted' },
          t('所有设备请先更新扩展，再上传新文件或整理目录。新版兼容旧平铺文件和新分类目录。'),
        ),
      );
      controls.append(
        el(
          'div',
          { class: 'row' },
          button(
            t('↓ 同步下载'),
            run(async () => {
              status.textContent = t('正在同步下载…');
              const r = await driveCommand('sync', { direction: 'download' });
              status.textContent = msg`下载 ${r.downloaded} 条记录${metadataSyncStatus(r, 'download')}，${r.conflicts} 条冲突。${r.recordsCached ? msg`复用 ${r.recordsCached} 个未变化文件的缓存。` : ''}`;
            }),
          ),
          button(
            t('↑ 同步上传'),
            run(async () => {
              status.textContent = t('正在同步上传…');
              const r = await driveCommand('sync', { direction: 'upload' });
              status.textContent = msg`上传 ${r.uploaded} 条记录${metadataSyncStatus(r, 'upload')}，${r.conflicts} 条冲突。${r.missingRemote ? t('云端有文件被移除，浏览器版本仍保留；请检查所选文件夹。') : ''}`;
            }),
          ),
        ),
      );
    } else {
      const name = el('input', {
        type: 'text',
        value: APP_NAME,
        maxlength: 120,
        'aria-label': t('新文件夹名称'),
      });
      controls.append(
        el('h4', {}, t('第一次使用')),
        field(t('新文件夹名称'), name),
        button(
          t('新建并使用文件夹'),
          run(async () => {
            status.textContent = t('正在新建文件夹…');
            await driveCommand('create-folder', { name: name.value });
            await render();
          }),
        ),
      );
      const folders = el('div', { class: 'drive-folder-choices' });
      controls.append(
        el('h4', {}, t('已有数据，连接新设备')),
        el(
          'p',
          { class: 'description' },
          t('选择此简化版在同一 Google 账号下创建的文件夹，然后点击同步下载。'),
        ),
        button(
          t('选择已有文件夹'),
          run(async () => {
            const results = await driveCommand('folders');
            if (!results.length) {
              status.textContent = t(
                '未找到此简化版的数据文件夹。若来自旧版，请先在旧版导出完整 ZIP，再在这里导入并上传。',
              );
              return;
            }
            const select = el(
              'select',
              { 'aria-label': t('已有数据文件夹') },
              ...results.map((f) => option(f.id, f.name)),
            );
            folders.replaceChildren(
              field(t('已有数据文件夹'), select),
              button(
                t('使用所选文件夹'),
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
        t('退出 Google 登录'),
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
      t(
        '登录自己的 Google 账号，选择一个数据文件夹。同步下载只读取云端；同步上传只发送浏览器里的修改。记录、项目及关系、标签定义和 Dock 常用网站都会同步；图片与音频分别保存。',
      ),
    ),
    status,
    controls,
  );
  await render();
  return root;
}

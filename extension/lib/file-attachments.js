import { t, msg } from './i18n.js';
import { el, button, assetView } from './dom.js';
import { normalizeAttachment, validId } from './model.js';
import { GoogleDrive } from './drive-client.js';
import { ensureDriveLayout } from './drive-layout.js';

export async function uploadFileAttachment(
  db,
  file,
  {
    recordId,
    itemId = null,
    drive = new GoogleDrive(),
    locks = globalThis.navigator?.locks,
    onProgress,
    signal,
  } = {},
) {
  if (
    !validId(recordId) ||
    (itemId !== null && !validId(itemId)) ||
    typeof file?.name !== 'string' ||
    !file.name ||
    file.name.length > 500 ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0
  )
    throw new Error(t('文件信息不正确，请重新选择。'));
  const run = async () => {
    const account = await drive.authorize(false);
    const binding = await db.getState('drive:binding');
    if (!binding)
      throw new Error(t('请先在设置中登录 Google Drive 并选择数据文件夹，再添加文件。'));
    if (binding.accountId !== account.id)
      throw new Error(t('当前 Google 账号与此浏览器的数据文件夹不一致，请登录原账号。'));
    await drive.folder(binding.folderId);
    const files = await drive.files(binding.folderId);
    const layout = await ensureDriveLayout(drive, binding.folderId, files);
    const id = crypto.randomUUID();
    const remote = await drive.uploadAttachment(
      layout.get('assets'),
      file,
      {
        pkm_role: 'attachment',
        attachment_id: id,
        record_id: recordId,
        ...(itemId ? { item_id: itemId } : {}),
      },
      onProgress,
      signal,
    );
    return normalizeAttachment({
      id,
      kind: 'file',
      storage: 'drive',
      name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      created_at: new Date().toISOString(),
      drive_file_id: remote.id,
      drive_account_id: account.id,
      drive_folder_id: binding.folderId,
      item_id: itemId,
    });
  };
  return locks?.request ? locks.request('pkm-direct-drive', { signal }, run) : run();
}

export function fileAttachmentComposer(
  db,
  { recordId, attachments = [], onChange = async () => {}, itemExists = () => true } = {},
) {
  const descriptors = new Map(
    attachments.filter((a) => a.storage === 'drive').map((a) => [a.id, a]),
  );
  const uploads = new Set(),
    views = new Map();
  const controller = new AbortController();
  let destroyed = false;
  function control(itemId = null) {
    const root = el('div', { class: 'file-attachments', 'data-item-id': itemId }),
      gallery = el('div', { class: 'file-attachment-gallery' }),
      status = el('small', { class: 'muted', role: 'status' }),
      input = el('input', {
        type: 'file',
        multiple: true,
        hidden: true,
        'data-attachment-file': itemId || 'record',
      });
    const add = button(t('添加文件'), () => input.click(), 'button small');
    function render() {
      gallery.replaceChildren(
        ...[...descriptors.values()]
          .filter((a) => a.item_id === itemId)
          .map((a) =>
            el(
              'div',
              { class: 'file-attachment-row' },
              assetView(a),
              button(
                t('移除附件'),
                async () => {
                  try {
                    descriptors.delete(a.id);
                    render();
                    await onChange({ added: [], removed: [a.id] });
                  } catch (error) {
                    status.className = 'error-text';
                    status.textContent = error.message;
                  }
                },
                'link-button',
              ),
            ),
          ),
      );
    }
    input.addEventListener('change', () => {
      const selected = [...input.files];
      input.value = ''; // Release the browser's FileList as soon as upload starts.
      if (!selected.length) return;
      add.disabled = true;
      const task = (async () => {
        try {
          while (selected.length) {
            if (destroyed || !itemExists(itemId)) break;
            if (descriptors.size >= 100) throw new Error(t('每条记录最多添加 100 个附件。'));
            let file = selected.shift();
            status.className = 'muted';
            status.textContent = msg`正在上传：${file.name}`;
            const descriptor = await uploadFileAttachment(db, file, {
              recordId,
              itemId,
              signal: controller.signal,
              onProgress: (sent, total) => {
                status.textContent = msg`正在上传：${file.name}（${total ? Math.round((sent / total) * 100) : 100}%）`;
              },
            });
            file = null;
            if (destroyed || !itemExists(itemId)) break;
            descriptors.set(descriptor.id, descriptor);
            render();
            await onChange({ added: [descriptor], removed: [] });
          }
          if (!destroyed) status.textContent = t('文件已上传到 Google Drive。');
        } catch (error) {
          if (!destroyed) {
            status.className = 'error-text';
            status.textContent = msg`上传失败：${error.message} 请重新选择文件重试。`;
          }
        } finally {
          selected.length = 0;
          add.disabled = false;
        }
      })();
      uploads.add(task);
      task.finally(() => uploads.delete(task));
    });
    root.append(el('div', { class: 'row' }, add, status), input, gallery);
    render();
    views.set(itemId, { root, render });
    return root;
  }
  return {
    control(itemId = null) {
      return views.get(itemId)?.root || control(itemId);
    },
    get attachments() {
      return [...descriptors.values()];
    },
    get uploading() {
      return uploads.size > 0;
    },
    async settle() {
      while (uploads.size) await Promise.all([...uploads]);
    },
    removeItem(itemId) {
      for (const a of descriptors.values()) if (a.item_id === itemId) descriptors.delete(a.id);
      views.delete(itemId);
    },
    setAttachments(values) {
      descriptors.clear();
      values.filter((a) => a.storage === 'drive').forEach((a) => descriptors.set(a.id, a));
      views.forEach((view) => view.render());
    },
    destroy() {
      destroyed = true;
      controller.abort();
      views.clear();
    },
  };
}

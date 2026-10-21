import { t, msg } from './i18n.js';
import { GoogleDrive } from './drive-client.js';
import { digestBytes } from './model.js';
import { TAG_LIBRARY_ID, prepareTagLibrary } from './tag-library.js';
import { SHORTCUT_LIBRARY_ID, prepareShortcutLibrary } from './shortcut-library.js';
import { migrateStartShortcuts } from './start-config.js';
import { mapConcurrent } from './concurrency.js';
import { ensureDriveLayout, fileDirectory, driveLayoutPlan } from './drive-layout.js';

const isTags = (id) => id === TAG_LIBRARY_ID;
const isShortcuts = (id) => id === SHORTCUT_LIBRARY_ID;
const isMetadata = (id) => isTags(id) || isShortcuts(id);
const roleOf = (id) =>
  isTags(id) ? 'tag_library' : isShortcuts(id) ? 'shortcut_library' : 'record';
const syncFile = (file) =>
  ['record', 'tag_library', 'shortcut_library'].includes(file.appProperties?.pkm_role);

const recordBlob = (row) =>
  new Blob(
    [
      JSON.stringify({
        format: isTags(row.record.id)
          ? 'guga-tag-library'
          : isShortcuts(row.record.id)
            ? 'guga-shortcut-library'
            : 'pkm-direct-record',
        version: 1,
        hash: row.hash,
        record: row.record,
      }),
    ],
    { type: 'application/json' },
  );
export async function validateRemote(db, entry) {
  const value = entry.value;
  const role = entry.file.appProperties?.pkm_role;
  const tags = role === 'tag_library';
  const shortcuts = role === 'shortcut_library';
  if (
    value?.format !==
      (tags ? 'guga-tag-library' : shortcuts ? 'guga-shortcut-library' : 'pkm-direct-record') ||
    value.version !== 1 ||
    value.record?.id !== entry.file.appProperties?.record_id ||
    roleOf(value.record.id) !== role
  )
    throw new Error(t('云端记录格式或 ID 不正确，未覆盖浏览器数据。'));
  const row = tags
    ? await prepareTagLibrary(value.record)
    : shortcuts
      ? await prepareShortcutLibrary(value.record)
      : await db.prepare(value.record);
  if (row.hash !== value.hash) throw new Error(t('云端记录校验失败，未覆盖浏览器数据。'));
  return { ...entry, record: row.record, hash: row.hash };
}
async function readRemote(db, drive, binding, file, stats) {
  const cached = await db.cachedDriveFile(file.id);
  if (
    file.version &&
    cached?.version === file.version &&
    cached.folderId === binding.folderId &&
    cached.etag
  ) {
    try {
      const remote = await validateRemote(db, { ...cached, file });
      stats.cached++;
      return remote;
    } catch {
      /* A damaged cache is disposable; re-read the authoritative file. */
    }
  }
  const remote = await validateRemote(db, await drive.readRecord(file));
  stats.fetched++;
  // Only use the version observed with this stable body, never an earlier list response.
  if (remote.version)
    await db.cacheDriveFile(file.id, {
      folderId: binding.folderId,
      version: remote.version,
      value: remote.value,
      etag: remote.etag,
    });
  return remote;
}
async function remoteRecords(db, drive, binding, files, stats) {
  const groups = new Map();
  const records = await mapConcurrent(files.filter(syncFile), 4, (file) =>
    readRemote(db, drive, binding, file, stats),
  );
  for (const remote of records) {
    const list = groups.get(remote.record.id) || [];
    list.push(remote);
    groups.set(remote.record.id, list);
  }
  return groups;
}
const signature = (variants) =>
  variants
    .map((v) => `${v.file.id}:${v.hash}`)
    .sort()
    .join('|');
const conflictOf = (id, local, variants) => ({
  id,
  title: local?.record.title || variants[0]?.record.title || id,
  localHash: local?.hash || null,
  signature: signature(variants),
  variants: variants.map((v) => ({ fileId: v.file.id, record: v.record, hash: v.hash })),
});
export async function bindFolder(db, account, folder) {
  const previous = await db.getState('drive:binding');
  if (previous && (previous.accountId !== account.id || previous.folderId !== folder.id))
    throw new Error(
      t(
        '此浏览器已绑定另一个账号或文件夹。为避免资料混用，请在新的 Chrome 配置中连接另一份数据；现有资料可导出备份。',
      ),
    );
  const binding = {
    accountId: account.id,
    email: account.email,
    folderId: folder.id,
    name: folder.name,
  };
  await db.setState('drive:binding', binding);
  return binding;
}
export async function rebindFolder(db, account, folder) {
  const previous = await db.getState('drive:binding');
  if (!previous) throw new Error(t('请先选择或新建 Google Drive 文件夹。'));
  if (previous.accountId !== account.id)
    throw new Error(t('当前 Google 账号与此浏览器的数据文件夹不一致，请登录原账号。'));
  if (previous.folderId === folder.id) return previous;
  return db.changeDriveBinding(previous, {
    accountId: account.id,
    email: account.email,
    folderId: folder.id,
    name: folder.name,
  });
}
async function checkedBinding(db, drive, account) {
  const binding = await db.getState('drive:binding');
  if (!binding) throw new Error(t('请先选择或新建 Google Drive 文件夹。'));
  if (binding.accountId !== account.id)
    throw new Error(t('当前 Google 账号与此浏览器的数据文件夹不一致，请登录原账号。'));
  await drive.folder(binding.folderId);
  return binding;
}
async function pull(db, drive, binding, files, links) {
  const stats = { fetched: 0, cached: 0, assetsDownloaded: 0 };
  const groups = await remoteRecords(db, drive, binding, files, stats);
  const changes = [],
    acknowledgements = new Map(),
    conflicts = [];
  const resolutions = await db.getState('drive:resolutions', {});
  const assets = new Map();
  let pulled = 0,
    metadataDownloaded = 0,
    shortcutsDownloaded = 0;
  for (const [id, variants] of groups) {
    const local = await db.syncRow(id),
      base = links.get(id),
      hashes = new Set(variants.map((v) => v.hash));
    let remote = variants[0];
    const selection = resolutions[id];
    const accepted =
      selection &&
      selection.signature === signature(variants) &&
      selection.localHash === (local?.hash || null);
    if (accepted && selection.choice === 'local' && local) {
      acknowledgements.set(id, {
        hash: remote.hash,
        acceptedHashes: [...hashes],
        fileIds: variants.map((v) => v.file.id),
      });
      for (const descriptor of local.record.attachments || [])
        assets.set(descriptor.id, descriptor);
      continue;
    }
    if (accepted && selection.choice !== 'local')
      remote = variants.find((v) => v.hash === selection.choice) || remote;
    else if (
      hashes.size > 1 ||
      (local &&
        local.hash !== remote.hash &&
        local.hash !== base?.hash &&
        remote.hash !== base?.hash)
    ) {
      conflicts.push(conflictOf(id, local, variants));
      continue;
    }
    if (local?.hash === remote.hash) {
      acknowledgements.set(id, {
        hash: remote.hash,
        fileIds: variants.map((v) => v.file.id),
        ...(hashes.size > 1 ? { acceptedHashes: [...hashes], needsConsolidation: true } : {}),
      });
      for (const descriptor of remote.record.attachments || [])
        assets.set(descriptor.id, descriptor);
      continue;
    }
    if (local && remote.hash === base?.hash && !accepted) {
      for (const descriptor of local.record.attachments || [])
        assets.set(descriptor.id, descriptor);
      continue;
    }
    changes.push({ record: remote.record, expectedRev: local?.rev || 0 });
    acknowledgements.set(id, { hash: remote.hash, fileIds: variants.map((v) => v.file.id) });
    for (const descriptor of remote.record.attachments || []) assets.set(descriptor.id, descriptor);
    // A duplicate-record resolution is uploaded explicitly after downloading the selected version.
    if (hashes.size > 1)
      acknowledgements.set(id, {
        hash: remote.hash,
        acceptedHashes: [...hashes],
        fileIds: variants.map((v) => v.file.id),
        needsConsolidation: true,
      });
    if (isMetadata(id)) metadataDownloaded++;
    else pulled++;
    if (isShortcuts(id)) shortcutsDownloaded++;
  }
  const assetFiles = new Map(
    files
      .filter((file) => file.appProperties?.pkm_role === 'asset')
      .map((file) => [file.appProperties.asset_id, file]),
  );
  await mapConcurrent([...assets.values()], 4, async (descriptor) => {
    if ((await db.getAsset(descriptor.id))?.blob) return;
    const file = assetFiles.get(descriptor.id);
    if (!file) throw new Error(msg`云端缺少附件“${descriptor.name}”，下载未覆盖记录。`);
    await db.putAsset(
      descriptor,
      new Blob([await drive.download(file, descriptor.size_bytes + 1)], {
        type: descriptor.mime_type,
      }),
    );
    stats.assetsDownloaded++;
  });
  try {
    await db.applyDriveChanges(changes, acknowledgements, conflicts);
  } catch (error) {
    if (conflicts.length) await db.setState('drive:conflicts', conflicts);
    throw new Error(
      msg`下载未应用，浏览器记录仍保留：${error.message} 请先处理相关记录或项目的冲突，再同步下载。`,
    );
  }
  await db.setState('drive:resolutions', {});
  return {
    downloaded: pulled,
    uploaded: 0,
    metadataDownloaded,
    shortcutsDownloaded,
    conflicts: conflicts.length,
    recordsFetched: stats.fetched,
    recordsCached: stats.cached,
    assetsDownloaded: stats.assetsDownloaded,
  };
}
async function push(db, drive, binding, files, links) {
  const stats = { fetched: 0, cached: 0 };
  let layout;
  const target = async (file) => {
    layout ||= await ensureDriveLayout(drive, binding.folderId, files);
    return layout.get(fileDirectory(file));
  };
  const conflicts = [],
    pending = await db.syncRows();
  let uploaded = 0,
    skipped = 0,
    metadataUploaded = 0,
    shortcutsUploaded = 0;
  const existing = new Set(
    files.filter((f) => f.appProperties?.pkm_role === 'asset').map((f) => f.appProperties.asset_id),
  );
  for (const local of pending) {
    const id = local.record.id,
      base = links.get(id);
    if (local.hash === base?.hash && !base.needsConsolidation && !base.acceptedHashes) continue;
    const matches = files.filter((f) => syncFile(f) && f.appProperties.record_id === id);
    const variants = [];
    for (const file of matches) variants.push(await readRemote(db, drive, binding, file, stats));
    if (variants.length && variants.every((v) => v.hash === local.hash)) {
      await db.acknowledgeDrive(id, { hash: local.hash, fileIds: matches.map((f) => f.id) });
      continue;
    }
    if (base?.fileIds?.length && !variants.length) {
      skipped++;
      continue;
    }
    if (variants.some((v) => v.hash !== base?.hash && !base?.acceptedHashes?.includes(v.hash))) {
      conflicts.push(conflictOf(id, local, variants));
      continue;
    }
    // Publish attachments before the record that references them.
    for (const descriptor of local.record.attachments || []) {
      if (existing.has(descriptor.id)) continue;
      const blob = (await db.getAsset(descriptor.id))?.blob;
      if (
        !blob ||
        blob.size !== descriptor.size_bytes ||
        (await digestBytes(await blob.arrayBuffer())) !== descriptor.id
      )
        throw new Error(
          msg`附件“${descriptor.name}”未完整保存在浏览器中，请先同步下载或导入完整 ZIP。`,
        );
      const assetId = await drive.generateId();
      await drive.createFile(
        await target({ mimeType: blob.type, appProperties: { pkm_role: 'asset' } }),
        descriptor.path.split('/').pop(),
        blob,
        { pkm_role: 'asset', asset_id: descriptor.id },
        assetId,
      );
      existing.add(descriptor.id);
    }
    try {
      if (variants.length)
        for (const variant of variants)
          await drive.updateRecord(variant.file.id, recordBlob(local), variant.etag);
      else {
        const fileId = await drive.generateId();
        const file = await drive.createFile(
          await target({ appProperties: { pkm_role: roleOf(id) } }),
          isTags(id) ? 'tags.json' : isShortcuts(id) ? 'shortcuts.json' : `${id}.json`,
          recordBlob(local),
          { pkm_role: roleOf(id), record_id: id },
          fileId,
        );
        matches.push(file);
      }
      await db.acknowledgeDrive(id, { hash: local.hash, fileIds: matches.map((f) => f.id) });
      if (isMetadata(id)) metadataUploaded++;
      else uploaded++;
      if (isShortcuts(id)) shortcutsUploaded++;
    } catch (error) {
      if (error.status !== 412) throw error;
      const latest = [];
      for (const file of matches)
        latest.push(await validateRemote(db, await drive.readRecord(file)));
      conflicts.push(conflictOf(id, local, latest));
    }
  }
  // Keep unresolved conflicts for records not modified in this upload pass.
  const old = await db.getState('drive:conflicts', []);
  for (const conflict of old)
    if (!conflicts.some((c) => c.id === conflict.id) && !links.get(conflict.id)?.acceptedHashes)
      conflicts.push(conflict);
  await db.setState('drive:conflicts', conflicts);
  return {
    downloaded: 0,
    uploaded,
    metadataUploaded,
    shortcutsUploaded,
    conflicts: conflicts.length,
    missingRemote: skipped,
    recordsFetched: stats.fetched,
    recordsCached: stats.cached,
  };
}
export async function syncDrive(
  db,
  direction,
  { drive = new GoogleDrive(), locks = globalThis.navigator?.locks } = {},
) {
  if (!['download', 'upload'].includes(direction)) throw new Error(t('同步方向无效。'));
  const run = async () => {
    try {
      await migrateStartShortcuts(db);
      const account = await drive.authorize(false),
        binding = await checkedBinding(db, drive, account);
      const files = await drive.files(binding.folderId),
        links = await db.driveLinks();
      await db.pruneDriveCache(files.filter(syncFile).map((file) => file.id));
      const result =
        direction === 'download'
          ? await pull(db, drive, binding, files, links)
          : await push(db, drive, binding, files, links);
      await db.setState('drive:last', { ...result, direction, at: new Date().toISOString() });
      await db.setState('drive:error', null);
      return result;
    } catch (error) {
      await db.setState('drive:error', error.message);
      throw error;
    }
  };
  return locks?.request
    ? locks.request('pkm-direct-drive', { ifAvailable: true }, (lock) => {
        if (!lock) throw new Error(t('另一个窗口正在同步，请稍后重试。'));
        return run();
      })
    : run();
}
export async function resolveDriveConflict(db, id, choice) {
  const conflict = (await db.getState('drive:conflicts', [])).find((c) => c.id === id);
  if (!conflict || (choice !== 'local' && !conflict.variants.some((v) => v.hash === choice)))
    throw new Error(t('冲突已变化，请重新同步下载。'));
  const local = await db.syncRow(id);
  if ((local?.hash || null) !== conflict.localHash)
    throw new Error(t('浏览器记录已修改，请重新同步下载后选择版本。'));
  const resolutions = await db.getState('drive:resolutions', {});
  resolutions[id] = { choice, signature: conflict.signature, localHash: conflict.localHash };
  await db.setState('drive:resolutions', resolutions);
}

export async function organizeDrive(db, { drive = new GoogleDrive(), preview = true } = {}) {
  const account = await drive.authorize(false),
    binding = await checkedBinding(db, drive, account);
  const files = await drive.files(binding.folderId),
    plan = driveLayoutPlan(binding.folderId, files);
  if (preview) return { count: plan.length, files: plan.slice(0, 30) };
  if (!plan.length) return { moved: 0 };
  const ids = await ensureDriveLayout(drive, binding.folderId, files),
    allowed = new Set([
      binding.folderId,
      ...files
        .filter((file) => file.appProperties?.pkm_role === 'directory')
        .map((file) => file.id),
    ]);
  const byId = new Map(files.map((file) => [file.id, file]));
  const moved = await mapConcurrent(plan, 4, (item) =>
    drive.moveFile(byId.get(item.id), ids.get(item.path), allowed),
  );
  return { moved: moved.filter(Boolean).length };
}

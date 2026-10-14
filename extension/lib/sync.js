import {digest} from './model.js';

export function classifyVersion(localHash, baseHash, remoteHash) {
  if (localHash === remoteHash) return 'same';
  if (localHash === baseHash) return 'remote';
  if (remoteHash === baseHash) return 'local';
  return 'conflict';
}
export async function synchronize(db, api, {scan = false, progress = () => {}} = {}) {
  const connected = await api.connect(); await db.assertRepo(connected.repoKey);
  await db.setState('repoKey', connected.repoKey);
  // Keep the same local snapshot throughout retries; newer edits remain pending.
  const snapshot = await db.snapshot();
  for (let attempt = 0; attempt < 3; attempt++) {
    progress(attempt ? '远程有新提交，正在重新核对版本…' : '正在读取远程索引…');
    const remote = await api.readRemote({scan});
    await db.clearStaging();
    const entries = new Map(remote.entries), writes = [], conflicts = [];
    const ids = new Set([...snapshot.rows.keys(), ...remote.entries.keys()]); let pulled = 0;
    for (const id of ids) {
      api.signal?.throwIfAborted();
      const local = snapshot.rows.get(id), entry = remote.entries.get(id);
      if (local?.scope === 'local') {
        if (entry) throw new Error('仅本地记录与远程 ID 冲突，请先将本地内容另存为新记录。');
        continue;
      }
      if (!entry && local?.baseHash) throw new Error('远程缺少曾同步过的记录或删除标记。为避免数据复活，已停止同步；请先检查仓库历史或主动扫描重建索引。');
      const decision = !local ? 'remote' : !entry ? 'local' : classifyVersion(local.hash, local.baseHash, entry.hash);
      if (decision === 'local') { writes.push({record: local.record, hash: local.hash}); await db.stage(local.record, local.rev); continue; }
      if (decision === 'same') { if (local.dirty) await db.stage(local.record, local.rev); continue; }
      progress(`正在读取远程内容 ${++pulled}…`);
      const remoteRecord = remote.cached.get(id) || await api.readRecord(entry, remote.sha);
      if (decision === 'remote') await db.stage(remoteRecord, local?.rev || 0);
      else conflicts.push({id, repoKey: connected.repoKey, localHash: local.hash, remoteHash: entry.hash, baseHash: local.baseHash, remoteCommit:remote.sha, remoteRecord});
    }
    if (conflicts.length) { await db.setConflicts(conflicts); return {status: 'conflicts', count: conflicts.length}; }
    let syncedCommit=remote.sha;
    if (writes.length || remote.needsIndex) {
      progress(`准备上传 ${writes.length} 项变更…`);
      try { syncedCommit=await api.writeBatch(remote, writes, entries,{readAsset:async descriptor=>{let asset=await db.getAsset(descriptor.id);if(!asset?.blob){const blob=await api.readAsset(descriptor,asset?.remote_commit||remote.sha);await db.putAsset(descriptor,blob,asset?.remote_commit||remote.sha);asset=await db.getAsset(descriptor.id);}return asset;}}); }
      catch (error) { if ([409, 422].includes(error.status) && attempt < 2) continue; throw error; }
    }
    await db.reconcileStaged(connected.repoKey,syncedCommit);
    return {status: 'success', pushed: writes.length, pulled, total: entries.size};
  }
  throw new Error('远程持续发生变更，请稍后重新手动同步。本地数据仍保留。');
}

export async function withSyncLock(action, locks = globalThis.navigator?.locks) {
  if (!locks) throw new Error('当前环境不支持同步锁，请使用受支持版本的 Chrome。');
  return locks.request('pkm-nexus:sync', {mode: 'exclusive', ifAvailable: true}, lock => {
    if (!lock) throw new Error('另一个整理窗口正在同步，请等待完成。');
    return action();
  });
}

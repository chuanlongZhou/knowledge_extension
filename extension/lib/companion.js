import { digestBytes, metadata } from './model.js';
import { validateProjects } from './projects.js';
const HOST = 'com.pkm_nexus.companion',
  CHUNK = 48 * 1024,
  MAX_BYTES = 8 * 1024 * 1024;
export class CompanionClient {
  constructor(runtime = chrome.runtime) {
    this.runtime = runtime;
    this.port = null;
    this.queue = Promise.resolve();
  }
  connect() {
    if (this.port) return;
    this.port = this.runtime.connectNative(HOST);
    this.port.onDisconnect.addListener(() => {
      const error =
        this.runtime.lastError?.message || '本地配套程序已断开。请安装程序并注册当前扩展 ID。';
      this.pending?.reject(new Error(error));
      this.pending = null;
      this.port = null;
    });
    this.port.onMessage.addListener((frame) => {
      const pending = this.pending;
      if (!pending || frame.id !== pending.id) return;
      try {
        if (
          frame.type !== 'response' ||
          frame.index !== pending.parts.length ||
          !Number.isInteger(frame.total) ||
          frame.total < 1 ||
          frame.total > 200 ||
          typeof frame.data !== 'string' ||
          frame.data.length > CHUNK
        )
          throw new Error('本地程序返回了无效消息。');
        pending.size += new TextEncoder().encode(frame.data).length;
        if (pending.size > MAX_BYTES) throw new Error('本地程序返回内容过大。');
        pending.parts.push(frame.data);
        if (pending.parts.length === frame.total) {
          const response = JSON.parse(pending.parts.join(''));
          this.pending = null;
          if (response.ok) pending.resolve(response.result);
          else pending.reject(new Error(response.error || '本地程序操作失败。'));
        }
      } catch (error) {
        this.pending = null;
        pending.reject(error);
      }
    });
  }
  call(command, payload = {}) {
    const task = this.queue
      .catch(() => {})
      .then(
        () =>
          new Promise((resolve, reject) => {
            this.connect();
            const id = crypto.randomUUID(),
              text = JSON.stringify({ command, payload });
            if (new TextEncoder().encode(text).length > MAX_BYTES) {
              reject(new Error('单次本地交接内容过大。'));
              return;
            }
            const timer = setTimeout(() => {
              if (this.pending?.id === id) this.pending = null;
              reject(new Error('本地程序响应超时，浏览器内容仍保留。'));
              this.close();
            }, 600000);
            this.pending = {
              id,
              parts: [],
              size: 0,
              resolve: (value) => {
                clearTimeout(timer);
                resolve(value);
              },
              reject: (error) => {
                clearTimeout(timer);
                reject(error);
              },
            };
            const total = Math.ceil(text.length / CHUNK) || 1;
            try {
              for (let index = 0; index < total; index++)
                this.port.postMessage({
                  type: 'request',
                  id,
                  index,
                  total,
                  data: text.slice(index * CHUNK, (index + 1) * CHUNK),
                });
            } catch (error) {
              this.pending.reject(error);
              this.pending = null;
            }
          }),
      );
    this.queue = task;
    return task;
  }
  close() {
    this.port?.disconnect();
    this.port = null;
  }
}
const base64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
export async function uploadCompanionAsset(client, db, descriptor, { resolveAsset } = {}) {
  if ((await client.call('assets.has', { descriptor })).available) return;
  const blob = (await db.getAsset(descriptor.id))?.blob || (await resolveAsset?.(descriptor));
  if (!blob) throw new Error(`附件“${descriptor.name}”尚未缓存，请先加载附件再连接本地资料库。`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length !== descriptor.size_bytes || (await digestBytes(bytes)) !== descriptor.id)
    throw new Error('本机附件校验失败。');
  const { transferId } = await client.call('assets.begin', { descriptor });
  for (let offset = 0; offset < bytes.length; offset += 192 * 1024)
    await client.call('assets.chunk', {
      transferId,
      offset,
      data: base64(bytes.subarray(offset, offset + 192 * 1024)),
    });
  await client.call('assets.finish', { transferId });
}
export async function downloadCompanionAsset(db, descriptor, client = new CompanionClient()) {
  try {
    const chunks = [];
    let offset = 0;
    for (;;) {
      const result = await client.call('assets.read', { descriptor, offset });
      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      if (result.offset !== offset + bytes.length || result.offset > descriptor.size_bytes)
        throw new Error('本地附件分块不正确。');
      chunks.push(bytes);
      offset = result.offset;
      if (result.done) break;
    }
    const blob = new Blob(chunks, { type: descriptor.mime_type });
    await db.putAsset(descriptor, blob);
    return blob;
  } finally {
    client.close();
  }
}
export async function handoffCompanion(
  db,
  {
    client = new CompanionClient(),
    resolveAsset,
    locks = globalThis.navigator?.locks,
    pullOnly = false,
    waitForLock = false,
  } = {},
) {
  const run = async () => {
    try {
      const status = await client.call('status'),
        bound = await db.getState('companion:vault');
      if (bound && bound !== status.vaultId)
        throw new Error(
          '浏览器已连接另一份本地资料库。请先导出备份，在独立浏览器配置中连接新资料库。',
        );
      await db.setState('companion:vault', status.vaultId);
      let pushed = 0,
        pulled = 0;
      const catalog = pullOnly ? [] : await db.allCatalog();
      for (const item of catalog) {
        const link = await db.getState(`companion:row:${item.id}`);
        if (link?.hash === item.hash) continue;
        const row = await db.get(item.id);
        if (!row) continue;
        for (const descriptor of row.record.attachments || [])
          await uploadCompanionAsset(client, db, descriptor, { resolveAsset });
        const saved = await client.call('records.put', {
          record: row.record,
          parentRevision: link?.revision || null,
        });
        await db.acknowledgeCompanion(item.id, {
          hash: row.hash,
          revision: saved.acceptedRevision,
        });
        pushed++;
      }
      let cursor = await db.getState('companion:cursor', 0);
      const conflicts = new Set(await db.getState('companion:conflicts', []));
      const pending = new Map(),
        links = new Map();
      const accept = async (item) => {
        if (item.heads.length > 1) {
          conflicts.add(item.record.id);
          pending.delete(item.record.id);
          links.delete(item.record.id);
          return;
        }
        conflicts.delete(item.record.id);
        const current = await db.get(item.record.id),
          link = await db.getState(`companion:row:${item.record.id}`);
        if (current?.hash === item.hash) {
          pending.delete(item.record.id);
          links.set(item.record.id, { hash: item.hash, revision: item.revision });
          return;
        }
        if (current && current.hash !== link?.hash) return;
        pending.set(item.record.id, { record: item.record, expectedRev: current?.rev || 0 });
        links.set(item.record.id, { hash: item.hash, revision: item.revision });
      };
      for (const id of await db.getState('companion:deferred', [])) {
        const item = await client.call('records.get', { id });
        if (item) await accept(item);
      }
      for (;;) {
        const page = await client.call('records.changes', { cursor, limit: 1 });
        for (const item of page.items) await accept(item);
        cursor = page.cursor;
        if (!page.hasMore) break;
      }
      const deferred = new Set(),
        baseline = await db.allCatalog();
      // A project can refer to a record whose two versions are awaiting a user
      // decision. Defer only that dependent group and retry it after resolution,
      // while unrelated records and Drive synchronization continue normally.
      while (pending.size) {
        const candidate = new Map(baseline.map((item) => [item.id, item]));
        for (const [id, item] of pending) candidate.set(id, metadata(item.record));
        const records = [...candidate.values()],
          invalid = [];
        try {
          validateProjects(records);
          break;
        } catch {
          // Identify only the dependency groups affected by unresolved conflicts.
        }
        for (const project of records.filter(
          (item) => item.type === 'project' && !item.deleted_at,
        )) {
          try {
            validateProjects(records, { onlyIds: new Set([project.id]) });
          } catch (error) {
            invalid.push({ project, error });
          }
        }
        if (!invalid.length) break;
        const before = pending.size;
        for (const { project, error } of invalid) {
          const group = new Set([
            project.id,
            project.parent_project_id,
            ...(project.graph?.edges || []).flatMap((edge) => [edge.source, edge.target]),
            ...records
              .filter(
                (item) =>
                  item.project_ids?.includes(project.id) || item.parent_project_id === project.id,
              )
              .map((item) => item.id),
          ]);
          if (![...group].some((id) => conflicts.has(id))) throw error;
          for (const id of group)
            if (pending.delete(id)) {
              links.delete(id);
              deferred.add(id);
            }
        }
        if (pending.size === before) throw invalid[0].error;
      }
      await db.applyCompanionChanges(
        [...pending.values()],
        links,
        cursor,
        [...conflicts],
        [...deferred],
      );
      pulled = pending.size;
      const latest = await client.call('status');
      const result = {
        at: new Date().toISOString(),
        pushed,
        pulled,
        conflicts: conflicts.size,
        deferred: deferred.size,
        drivePending: latest.pendingUploads,
        lastDriveSync: latest.lastSync?.at || null,
        driveConnected: latest.google?.connected === true,
        driveBound: !!latest.binding,
        driveError: latest.lastError || null,
      };
      await db.setState('companion:last', result);
      await db.setState('companion:error', null);
      db.changed('companion-result');
      return result;
    } finally {
      client.close();
    }
  };
  if (!locks) return run();
  return locks.request(
    'pkm-nexus:companion',
    waitForLock ? { mode: 'exclusive' } : { ifAvailable: true },
    (lock) => (lock ? run() : { busy: true }),
  );
}

// Local handoff and cloud synchronization are separate durable steps. A cloud
// failure must still return the successful local handoff and refresh its status.
export async function synchronizeCompanion(
  db,
  { remote = false, pullOnly = false, ...options } = {},
) {
  const result = await handoffCompanion(db, { ...options, pullOnly, waitForLock: remote });
  if (result.busy || !remote) return result;
  const client = options.client || new CompanionClient();
  let drive, driveError;
  try {
    drive = await client.call('drive.sync');
  } catch (error) {
    driveError = error.message;
  } finally {
    client.close();
  }
  const refreshed = await handoffCompanion(db, { ...options, pullOnly: true, waitForLock: true });
  if (refreshed.busy) return { ...result, drive, driveError, refreshPending: true };
  return {
    ...refreshed,
    pushed: result.pushed,
    pulled: result.pulled + refreshed.pulled,
    drive,
    driveError,
  };
}

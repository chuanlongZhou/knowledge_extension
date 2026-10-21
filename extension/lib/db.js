import {
  upgradeRecord,
  normalizeRecord,
  normalizeAttachment,
  MIME_EXT,
  MAX_ASSET_BYTES,
  digestBytes,
  metadata,
  digest,
  normalizeText,
  urlKey,
  searchText,
  tombstone,
  canonical,
  LIST_ID,
  validId,
} from './model.js';
import { validateProjects } from './projects.js';
import {
  TAG_LIBRARY_ID,
  TAG_GROUPS,
  TAG_STYLES,
  TAG_REVISION,
  tagLibraryFromState,
  normalizeTagLibrary,
  prepareTagLibrary,
  writeTagLibrary,
} from './tag-library.js';
import {
  SHORTCUT_LIBRARY_ID,
  SHORTCUTS_KEY,
  SHORTCUT_REVISION,
  shortcutLibraryFromState,
  normalizeShortcutLibrary,
  prepareShortcutLibrary,
  writeShortcutLibrary,
} from './shortcut-library.js';
import { t } from './i18n.js';

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const completed = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('本地写入已取消。'));
    tx.onerror = () => {};
  });
export class StaleEditError extends Error {
  constructor() {
    super('这条记录已在其他窗口修改，请重新打开后编辑，当前输入仍保留。');
    this.name = 'StaleEditError';
  }
}

export class Database {
  constructor(name = 'pkm-nexus-v1', { broadcast = true } = {}) {
    this.name = name;
    this.channel =
      broadcast && typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(`${name}:changes`)
        : null;
    this.listeners = new Set();
    if (this.channel)
      this.channel.onmessage = (event) =>
        this.listeners.forEach((fn) => fn(event.data?.kind || 'records', event.data?.detail));
  }
  async open() {
    if (!this.promise) {
      const opening = new Promise((resolve, reject) => {
        let settled = false;
        const req = indexedDB.open(this.name, 5);
        req.onupgradeneeded = (event) => {
          const db = req.result;
          if (!db.objectStoreNames.contains('records')) {
            db.createObjectStore('records', { keyPath: 'id' });
            const catalog = db.createObjectStore('catalog', { keyPath: 'id' });
            catalog.createIndex('updated_at', 'updated_at');
            catalog.createIndex('url_keys', 'url_keys', { multiEntry: true });
            catalog.createIndex('content_key', 'content_key');
            db.createObjectStore('search', { keyPath: 'id' });
            db.createObjectStore('state', { keyPath: 'key' });
            db.createObjectStore('captures', { keyPath: 'id' });
          }
          for (const name of ['staging', 'conflicts'])
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
          for (const key of ['repoKey', 'lastSync', 'lastSyncCommit'])
            req.transaction.objectStore('state').delete(key);
          if (!db.objectStoreNames.contains('assets'))
            db.createObjectStore('assets', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('recordings'))
            db.createObjectStore('recordings', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('recordingChunks'))
            db.createObjectStore('recordingChunks', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('driveCache'))
            db.createObjectStore('driveCache', { keyPath: 'id' });
          // Adding a disposable cache must not rewrite existing records or synchronization baselines.
          if (event.oldVersion >= 4) return;
          const cursorReq = req.transaction.objectStore('records').openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const row = cursor.value;
            delete row.baseHash;
            delete row.scope;
            row.dirty = true;
            cursor.update(row);
            req.transaction.objectStore('catalog').put(
              metadata(row.record, {
                hash: row.hash,
                rev: row.rev,
                dirty: true,
                content_key: row.content_key,
                url_keys: row.url_keys,
              }),
            );
            cursor.continue();
          };
        };
        req.onsuccess = () => {
          if (settled) {
            req.result.close();
            return;
          }
          settled = true;
          req.result.onversionchange = () => {
            req.result.close();
            if (this.promise === opening) this.promise = null;
          };
          resolve(req.result);
        };
        req.onerror = () => {
          settled = true;
          reject(req.error);
        };
        req.onblocked = () => {
          settled = true;
          reject(new Error('请关闭旧版本的整理窗口后重试。'));
        };
      });
      this.promise = opening;
      opening.catch(() => {
        if (this.promise === opening) this.promise = null;
      });
    }
    return this.promise;
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  changed(kind = 'records', detail) {
    this.channel?.postMessage({ kind, detail });
    this.listeners.forEach((fn) => fn(kind, detail));
  }
  async close() {
    try {
      if (this.promise) (await this.promise).close();
    } finally {
      this.promise = null;
      this.channel?.close();
    }
  }
  async get(id) {
    const db = await this.open();
    return request(db.transaction('records').objectStore('records').get(id));
  }
  async getState(key, fallback = null) {
    const db = await this.open();
    return (
      (await request(db.transaction('state').objectStore('state').get(key)))?.value ?? fallback
    );
  }
  async setState(key, value) {
    const db = await this.open();
    const tx = db.transaction('state', 'readwrite');
    const done = completed(tx);
    tx.objectStore('state').put({ key, value });
    if ([TAG_GROUPS, TAG_STYLES].includes(key)) {
      const revision = tx.objectStore('state').get(TAG_REVISION);
      revision.onsuccess = () =>
        tx
          .objectStore('state')
          .put({ key: TAG_REVISION, value: (revision.result?.value || 0) + 1 });
    }
    if (key === SHORTCUTS_KEY) {
      const revision = tx.objectStore('state').get(SHORTCUT_REVISION);
      revision.onsuccess = () =>
        tx
          .objectStore('state')
          .put({ key: SHORTCUT_REVISION, value: (revision.result?.value || 0) + 1 });
    }
    await done;
    this.changed(
      key.startsWith('draft:') ? 'draft' : key.startsWith('companion:') ? 'companion' : 'state',
    );
  }
  async companionLinks() {
    const db = await this.open();
    const rows = await request(
      db
        .transaction('state')
        .objectStore('state')
        .getAll(IDBKeyRange.bound('companion:row:', 'companion:row:\uffff')),
    );
    return new Map(rows.map((r) => [r.key.slice('companion:row:'.length), r.value]));
  }
  async driveLinks() {
    const db = await this.open();
    const rows = await request(
      db
        .transaction('state')
        .objectStore('state')
        .getAll(IDBKeyRange.bound('drive:row:', 'drive:row:\uffff')),
    );
    return new Map(rows.map((r) => [r.key.slice('drive:row:'.length), r.value]));
  }
  async changeDriveBinding(expected, binding) {
    const db = await this.open();
    const tx = db.transaction(['state', 'driveCache'], 'readwrite');
    const done = completed(tx);
    const state = tx.objectStore('state');
    let error;
    const current = state.get('drive:binding');
    current.onsuccess = () => {
      const value = current.result?.value;
      if (
        !value ||
        value.accountId !== expected.accountId ||
        value.folderId !== expected.folderId
      ) {
        error = new Error(t('数据文件夹已在其他窗口改变，请重新打开设置。'));
        tx.abort();
        return;
      }
      state.put({ key: 'drive:binding', value: binding });
      for (const key of ['drive:conflicts', 'drive:resolutions', 'drive:last', 'drive:error'])
        state.delete(key);
      const cursor = state.openCursor(IDBKeyRange.bound('drive:row:', 'drive:row:\uffff'));
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        row.delete();
        row.continue();
      };
      tx.objectStore('driveCache').clear();
    };
    try {
      await done;
    } catch (cause) {
      throw error || cause;
    }
    this.changed('state');
    return binding;
  }
  async cachedDriveFile(id) {
    const db = await this.open();
    return (
      (await request(db.transaction('driveCache').objectStore('driveCache').get(id)))?.value ?? null
    );
  }
  async cacheDriveFile(id, value) {
    const db = await this.open(),
      tx = db.transaction('driveCache', 'readwrite'),
      done = completed(tx);
    tx.objectStore('driveCache').put({ id, value });
    await done;
  }
  async pruneDriveCache(fileIds) {
    const ids = new Set(fileIds),
      db = await this.open(),
      tx = db.transaction('driveCache', 'readwrite'),
      done = completed(tx);
    const cursor = tx.objectStore('driveCache').openCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      if (!ids.has(row.key)) row.delete();
      row.continue();
    };
    await done;
  }
  async acknowledgeDrive(id, link) {
    return this.acknowledgeCompanion(id, link, 'drive');
  }
  async applyDriveChanges(changes, links, conflicts) {
    return this.applyCompanionChanges(changes, links, null, conflicts, [], 'drive');
  }
  async tagLibrary() {
    const db = await this.open(),
      store = db.transaction('state').objectStore('state');
    const [groups, styles, revision] = await Promise.all(
      [TAG_GROUPS, TAG_STYLES, TAG_REVISION].map((key) => request(store.get(key))),
    );
    return {
      ...(await prepareTagLibrary(tagLibraryFromState(groups?.value, styles?.value))),
      rev: revision?.value || 0,
    };
  }
  async shortcutLibrary() {
    const db = await this.open(),
      store = db.transaction('state').objectStore('state');
    const [shortcuts, revision] = await Promise.all(
      [SHORTCUTS_KEY, SHORTCUT_REVISION].map((key) => request(store.get(key))),
    );
    return {
      ...(await prepareShortcutLibrary(shortcutLibraryFromState(shortcuts?.value))),
      rev: revision?.value || 0,
    };
  }
  async setShortcutLibrary(shortcuts, expectedRev) {
    const record = shortcutLibraryFromState(shortcuts);
    const db = await this.open(),
      tx = db.transaction('state', 'readwrite'),
      done = completed(tx);
    let error;
    const revision = tx.objectStore('state').get(SHORTCUT_REVISION);
    revision.onsuccess = () => {
      const current = revision.result?.value || 0;
      if (current !== expectedRev) {
        error = new StaleEditError();
        tx.abort();
        return;
      }
      writeShortcutLibrary(tx.objectStore('state'), record, current + 1);
    };
    try {
      await done;
    } catch (cause) {
      throw error || cause;
    }
    this.changed('state');
  }
  async syncRow(id) {
    if (id === SHORTCUT_LIBRARY_ID) {
      const row = await this.shortcutLibrary();
      return row.record.shortcuts.length || row.rev || (await this.getState(`drive:row:${id}`))
        ? row
        : null;
    }
    if (id !== TAG_LIBRARY_ID) return this.get(id);
    const row = await this.tagLibrary();
    return row.record.definitions.length || row.rev || (await this.getState(`drive:row:${id}`))
      ? row
      : null;
  }
  async syncRows() {
    const rows = await this.allRows(),
      [tags, shortcuts] = await Promise.all([
        this.syncRow(TAG_LIBRARY_ID),
        this.syncRow(SHORTCUT_LIBRARY_ID),
      ]);
    return [...rows, ...[tags, shortcuts].filter(Boolean)];
  }
  async allCatalog() {
    const db = await this.open();
    return request(db.transaction('catalog').objectStore('catalog').getAll());
  }
  async allRows() {
    const db = await this.open();
    return request(db.transaction('records').objectStore('records').getAll());
  }
  async getAsset(id) {
    const db = await this.open();
    return request(db.transaction('assets').objectStore('assets').get(id));
  }
  async allAssets() {
    const db = await this.open();
    return request(db.transaction('assets').objectStore('assets').getAll());
  }
  async storeAsset(blob, name = '附件', duration_ms = null) {
    const mime_type = blob.type.split(';')[0].toLowerCase();
    if (!MIME_EXT[mime_type] || !blob.size || blob.size > MAX_ASSET_BYTES)
      throw new Error('支持 PNG/JPEG/GIF/WebP/AVIF 图片和常用音频；单附件最多 20 MB。');
    const id = await digestBytes(await blob.arrayBuffer());
    const descriptor = normalizeAttachment({
      id,
      sha256: id,
      kind: mime_type.startsWith('image/')
        ? 'image'
        : mime_type === 'application/x-mimearchive'
          ? 'snapshot'
          : 'audio',
      name,
      mime_type,
      size_bytes: blob.size,
      path: `assets/${id}.${MIME_EXT[mime_type]}`,
      created_at: new Date().toISOString(),
      duration_ms,
    });
    await this.putAsset(descriptor, blob);
    return descriptor;
  }
  async putAsset(descriptor, blob) {
    descriptor = normalizeAttachment(descriptor);
    if (
      blob.size !== descriptor.size_bytes ||
      (await digestBytes(await blob.arrayBuffer())) !== descriptor.id
    )
      throw new Error('附件校验失败，未保存。');
    const db = await this.open(),
      tx = db.transaction('assets', 'readwrite'),
      done = completed(tx);
    tx.objectStore('assets').put({ id: descriptor.id, descriptor, blob });
    await done;
  }
  async startRecording(mime_type) {
    const recording = {
      id: crypto.randomUUID(),
      mime_type,
      created_at: new Date().toISOString(),
      chunks: 0,
      size_bytes: 0,
      duration_ms: 0,
    };
    const db = await this.open(),
      tx = db.transaction('recordings', 'readwrite'),
      done = completed(tx);
    tx.objectStore('recordings').put(recording);
    await done;
    return recording;
  }
  async appendRecording(id, blob, elapsedMs) {
    const db = await this.open(),
      tx = db.transaction(['recordings', 'recordingChunks'], 'readwrite'),
      done = completed(tx);
    let updated, error;
    const req = tx.objectStore('recordings').get(id);
    req.onsuccess = () => {
      const recording = req.result;
      if (!recording) {
        error = new Error('录音会话不存在。');
        tx.abort();
        return;
      }
      const duration = elapsedMs ?? Math.max(0, Date.now() - Date.parse(recording.created_at));
      if (!Number.isFinite(duration) || duration < 0) {
        error = new Error('录音片段时长不正确。');
        tx.abort();
        return;
      }
      updated = {
        ...recording,
        chunks: recording.chunks + 1,
        size_bytes: recording.size_bytes + blob.size,
        duration_ms: Math.max(recording.duration_ms || 0, duration),
      };
      tx.objectStore('recordingChunks').put({ key: [id, recording.chunks], blob });
      tx.objectStore('recordings').put(updated);
    };
    try {
      await done;
    } catch (e) {
      throw error || e;
    }
    return updated;
  }
  async recordings() {
    const db = await this.open();
    return request(db.transaction('recordings').objectStore('recordings').getAll());
  }
  async recordingBlob(id) {
    const db = await this.open(),
      tx = db.transaction(['recordings', 'recordingChunks']);
    const [recording, chunks] = await Promise.all([
      request(tx.objectStore('recordings').get(id)),
      request(
        tx
          .objectStore('recordingChunks')
          .getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])),
      ),
    ]);
    if (!recording || !chunks.length) throw new Error('录音尚无可恢复片段。');
    return {
      recording,
      blob: new Blob(
        chunks.map((c) => c.blob),
        { type: recording.mime_type },
      ),
    };
  }
  async finishRecording(id) {
    const { recording, blob } = await this.recordingBlob(id);
    return this.storeAsset(
      blob,
      `录音-${recording.created_at.slice(0, 19).replace(/[:T]/g, '-')}.${MIME_EXT[recording.mime_type.split(';')[0]]}`,
      recording.duration_ms ?? null,
    );
  }
  async removeRecording(id) {
    const db = await this.open(),
      tx = db.transaction(['recordings', 'recordingChunks'], 'readwrite'),
      done = completed(tx);
    tx.objectStore('recordings').delete(id);
    tx.objectStore('recordingChunks').delete(
      IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
    );
    await done;
  }
  async drafts() {
    const db = await this.open();
    const items = await request(db.transaction('state').objectStore('state').getAll());
    return items.filter(
      (item) =>
        item.key.startsWith('draft:') &&
        item.value &&
        (item.value.record?.title ||
          item.value.record?.content ||
          item.value.record?.attachments?.length ||
          item.value.attachments?.length ||
          item.value.rawUrls ||
          item.value.title ||
          item.value.content ||
          item.value.url),
    );
  }
  async prepare(record, fields = {}) {
    record = normalizeRecord(record);
    const content_key =
      record.kind === 'tombstone' || !normalizeText(record.content)
        ? ''
        : await digest(normalizeText(record.content));
    return {
      id: record.id,
      record,
      hash: await digest(record),
      content_key,
      url_keys: record.sources?.map((s) => urlKey(s.url)).filter(Boolean) || [],
      ...fields,
    };
  }
  putRow(tx, row) {
    tx.objectStore('records').put(row);
    tx.objectStore('catalog').put(
      metadata(row.record, {
        hash: row.hash,
        rev: row.rev,
        dirty: row.dirty,
        content_key: row.content_key,
        url_keys: row.url_keys,
      }),
    );
    tx.objectStore('search').put({ id: row.id, text: searchText(row.record) });
  }
  async save(record, { expectedRev } = {}) {
    return (await this.saveMany([{ record, expectedRev }]))[0];
  }
  async saveMany(changes) {
    if (new Set(changes.map((c) => c.record.id)).size !== changes.length)
      throw new Error('重复的记录更新。');
    const prepared = await Promise.all(
      changes.map(async (change) => ({ ...change, prepared: await this.prepare(change.record) })),
    );
    const db = await this.open();
    const tx = db.transaction(['records', 'catalog', 'search'], 'readwrite');
    const done = completed(tx);
    let error;
    const saved = [];
    const req = tx.objectStore('catalog').getAll();
    req.onsuccess = () => {
      try {
        const catalog = new Map(req.result.map((r) => [r.id, r]));
        for (const change of prepared) {
          const old = catalog.get(change.record.id);
          if (change.expectedRev !== undefined && (old?.rev || 0) !== change.expectedRev)
            throw new StaleEditError();
          catalog.set(change.record.id, metadata(change.prepared.record));
        }
        validateProjects([...catalog.values()]);
        for (const change of prepared) {
          const oldReq = tx.objectStore('records').get(change.record.id);
          oldReq.onsuccess = () => {
            const old = oldReq.result;
            if (old && old.hash === change.prepared.hash) {
              saved.push(old);
              return;
            }
            const row = {
              ...change.prepared,
              rev: (old?.rev || 0) + 1,
              dirty: true,
            };
            this.putRow(tx, row);
            saved.push(row);
          };
        }
      } catch (e) {
        error = e;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (e) {
      throw error || e;
    }
    this.changed();
    return saved;
  }
  async renameTag(from, to, color, description) {
    to = to.trim();
    if (!to || to.length > 100 || /[,，\n]/.test(to))
      throw new Error('标签名称需为 1–100 个字，不能包含逗号或换行。');
    const rename = (tags) => [...new Set(tags.map((tag) => (tag === from ? to : tag)))];
    const rows = await this.allRows();
    const changes = await Promise.all(
      rows
        .filter((r) => from !== to && r.record.tags?.includes(from))
        .map(async (row) => ({
          old: row,
          prepared: await this.prepare({
            ...row.record,
            tags: rename(row.record.tags),
            updated_at: new Date().toISOString(),
          }),
        })),
    );
    const db = await this.open(),
      tx = db.transaction(['records', 'catalog', 'search', 'state', 'captures'], 'readwrite'),
      done = completed(tx);
    let error;
    const req = tx.objectStore('records').getAll();
    req.onsuccess = () => {
      const current = req.result.filter((r) => from !== to && r.record.tags?.includes(from));
      if (
        current.length !== changes.length ||
        changes.some(({ old }) => !current.some((r) => r.id === old.id && r.rev === old.rev))
      ) {
        error = new StaleEditError();
        tx.abort();
        return;
      }
      for (const { old, prepared } of changes)
        this.putRow(tx, {
          ...old,
          ...prepared,
          rev: old.rev + 1,
          dirty: true,
        });
      const captures = tx.objectStore('captures').getAll();
      captures.onsuccess = () => {
        for (const capture of captures.result)
          if (capture.record.tags?.includes(from))
            tx.objectStore('captures').put({
              ...capture,
              record: { ...capture.record, tags: rename(capture.record.tags) },
            });
      };
      const states = tx.objectStore('state').getAll();
      states.onsuccess = () => {
        for (const state of states.result) {
          if (state.key.startsWith('draft:') && state.value?.record?.tags?.includes(from)) {
            state.value.record.tags = rename(state.value.record.tags);
            tx.objectStore('state').put(state);
          }
        }
        const groups = states.result.find((s) => s.key === 'ui:tag-groups')?.value || [];
        const styles = states.result.find((s) => s.key === 'ui:tag-styles')?.value || {};
        const previous = styles[from] || {};
        if (from !== to) delete styles[from];
        Object.defineProperty(styles, to, {
          value: {
            color,
            ...(description !== undefined || previous.description !== undefined
              ? { description: description ?? previous.description }
              : {}),
          },
          enumerable: true,
          configurable: true,
          writable: true,
        });
        try {
          tagLibraryFromState(rename([...groups, from]), styles);
        } catch (e) {
          error = e;
          tx.abort();
          return;
        }
        tx.objectStore('state').put({ key: 'ui:tag-groups', value: rename([...groups, from]) });
        tx.objectStore('state').put({ key: 'ui:tag-styles', value: styles });
        tx.objectStore('state').put({
          key: TAG_REVISION,
          value: (states.result.find((s) => s.key === TAG_REVISION)?.value || 0) + 1,
        });
      };
    };
    try {
      await done;
    } catch (e) {
      throw error || e;
    }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key.startsWith('pkm:recovery:')) continue;
        const value = JSON.parse(localStorage.getItem(key));
        if (value?.record?.tags?.includes(from)) {
          value.record.tags = rename(value.record.tags);
          localStorage.setItem(key, JSON.stringify(value));
        }
      }
    } catch {
      /* IndexedDB is the durable copy. */
    }
    this.changed('records', { tagRename: { from, to } });
  }
  async mutate(id, fn) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const old = await this.get(id);
      if (!old) throw new Error('记录不存在。');
      const next = fn(structuredClone(old.record));
      try {
        return await this.save(next, { expectedRev: old.rev });
      } catch (e) {
        if (!(e instanceof StaleEditError)) throw e;
      }
    }
    throw new StaleEditError();
  }
  async trash(id) {
    const rows = await this.allRows(),
      row = rows.find((r) => r.id === id);
    if (!row || row.record.kind === 'tombstone') throw new Error('当前内容已经移除。');
    const now = new Date().toISOString();
    const changes = [
      { record: { ...row.record, deleted_at: now, updated_at: now }, expectedRev: row.rev },
    ];
    for (const project of rows) {
      if (!project.record.graph || project.id === id) continue;
      const edges = project.record.graph.edges.filter((e) => e.source !== id && e.target !== id);
      if (edges.length !== project.record.graph.edges.length)
        changes.push({
          record: { ...project.record, graph: { ...project.record.graph, edges }, updated_at: now },
          expectedRev: project.rev,
        });
    }
    return (await this.saveMany(changes))[0];
  }
  restore(id) {
    return this.mutate(id, (record) => {
      if (record.kind === 'tombstone') throw new Error('当前正文已移除，不能从回收站还原。');
      record.deleted_at = null;
      record.updated_at = new Date().toISOString();
      return record;
    });
  }
  purge(id) {
    return this.mutate(id, (record) => {
      if (!record.deleted_at) throw new Error('请先将记录移入回收站。');
      return tombstone(record);
    });
  }
  async searchIds(words) {
    const db = await this.open(),
      result = new Set();
    let lastKey;
    // Bounded batches reduce IPC overhead without reading every body into memory.
    for (;;) {
      const range = lastKey === undefined ? null : IDBKeyRange.lowerBound(lastKey, true);
      const batch = await request(
        db.transaction('search').objectStore('search').getAll(range, 256),
      );
      for (const item of batch)
        if (words.every((word) => item.text.includes(word))) result.add(item.id);
      if (batch.length < 256) break;
      lastKey = batch[batch.length - 1].id;
    }
    return result;
  }
  async list({
    view = 'inbox',
    query = '',
    tag = '',
    project = '',
    projectMembership = '',
    keywordProject = null,
    ids = null,
    pendingIds = null,
    pinnedIds = [],
    orderedIds = null,
    type = '',
    limit = 60,
    offset = 0,
  } = {}) {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const matches = await this.searchIds(words);
      if (ids) for (const id of matches) if (!ids.has(id)) matches.delete(id);
      return this.list({
        view,
        tag,
        project,
        projectMembership,
        keywordProject,
        ids: matches,
        pendingIds,
        pinnedIds,
        orderedIds,
        type,
        limit,
        offset,
      });
    }
    const filterMembership =
      view === 'organized' && ['in-project', 'no-project'].includes(projectMembership);
    const activeProjectIds = filterMembership
      ? new Set(
          (await this.allCatalog())
            .filter((m) => m.type === 'project' && !m.deleted_at)
            .map((m) => m.id),
        )
      : null;
    const db = await this.open();
    const tx = db.transaction(['catalog', 'search', 'records']);
    const result = [];
    let matched = 0;
    const priority = [
      ...new Set([...(view === 'trash' ? [] : [LIST_ID, ...pinnedIds]), ...(orderedIds || [])]),
    ];
    const prioritized = new Set(priority);
    return new Promise((resolve, reject) => {
      tx.onabort = () => reject(tx.error);
      const finish = () =>
        resolve({ items: result.slice(0, limit), hasMore: result.length > limit });
      const consider = (m, next) => {
        if (
          (m.kind === 'tombstone' && view !== 'pending') ||
          (m.type === 'project' && !['trash', 'pending'].includes(view)) ||
          (view !== 'pending' && (view === 'trash' ? !m.deleted_at : !!m.deleted_at)) ||
          (view === 'inbox' && m.organization_state !== 'inbox') ||
          (view === 'organized' && m.organization_state !== 'organized') ||
          (view === 'pending' && (pendingIds ? !pendingIds.has(m.id) : !m.dirty)) ||
          (ids && !ids.has(m.id)) ||
          (tag && !(m.tags || []).includes(tag)) ||
          (view === 'favorites' && !m.favorite) ||
          (project && !(m.project_ids || []).includes(project)) ||
          (filterMembership &&
            (m.project_ids || []).some((id) => activeProjectIds.has(id)) !==
              (projectMembership === 'in-project')) ||
          (type && m.type !== type)
        ) {
          next();
          return;
        }
        const accept = () => {
          if (matched++ >= offset) result.push(m);
          next();
        };
        const checkKeywords = () => {
          if (!keywordProject) {
            accept();
            return;
          }
          const recordReq = tx.objectStore('records').get(m.id);
          recordReq.onsuccess = () => {
            const r = recordReq.result?.record;
            const values = r && {
              title: r.title,
              content: `${r.content}\n${r.summary}\n${(r.list || []).map((i) => i.text).join('\n')}\n${r.purpose || ''}`,
              tags: r.tags.join(' '),
              url: [...r.sources.map((s) => s.url), ...(r.url_list || []).map((u) => u.url)].join(
                ' ',
              ),
            };
            if (
              values &&
              keywordProject.keywords.some((k) =>
                keywordProject.match_fields.some((f) =>
                  (values[f] || '').toLocaleLowerCase().includes(k.toLocaleLowerCase()),
                ),
              )
            )
              accept();
            else next();
          };
        };
        checkKeywords();
      };
      const scan = () => {
        const req = tx.objectStore('catalog').index('updated_at').openCursor(null, 'prev');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || result.length > limit) return finish();
          if (prioritized.has(cursor.value.id)) cursor.continue();
          else consider(cursor.value, () => cursor.continue());
        };
      };
      const readPriority = () => {
        if (result.length > limit) return finish();
        if (!priority.length) return orderedIds ? finish() : scan();
        const req = tx.objectStore('catalog').get(priority.shift());
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          if (req.result) consider(req.result, readPriority);
          else readPriority();
        };
      };
      readPriority();
    });
  }
  async duplicates(record) {
    const contentKey = record.content.trim() ? await digest(normalizeText(record.content)) : '';
    const urls = record.sources.map((s) => urlKey(s.url)).filter(Boolean);
    const db = await this.open();
    const tx = db.transaction('catalog');
    const store = tx.objectStore('catalog');
    const lists = await Promise.all([
      ...urls.map((url) => request(store.index('url_keys').getAll(url))),
      ...(contentKey ? [request(store.index('content_key').getAll(contentKey))] : []),
    ]);
    const matches = new Map();
    for (const m of lists.flat()) {
      if (m.id === record.id || m.kind === 'tombstone' || m.type === 'project') continue;
      const sameUrl = m.url_keys.some((url) => urls.includes(url));
      const sameContent = m.content_key === contentKey;
      matches.set(m.id, {
        ...m,
        match: sameUrl && sameContent ? 'exact' : sameUrl ? 'related' : 'similar',
      });
    }
    const order = { exact: 0, related: 1, similar: 2 };
    return [...matches.values()]
      .sort(
        (a, b) =>
          Number(!!a.deleted_at) - Number(!!b.deleted_at) || order[a.match] - order[b.match],
      )
      .slice(0, 12);
  }
  async mergeRecords(sourceId, targetId, sourceRev, targetRev) {
    if (sourceId === targetId) throw new Error('请选择两条不同记录。');
    const [source, target] = await Promise.all([this.get(sourceId), this.get(targetId)]);
    if (
      !source ||
      !target ||
      source.record.kind === 'tombstone' ||
      target.record.kind === 'tombstone' ||
      source.record.type === 'project' ||
      target.record.type === 'project'
    )
      throw new Error('只能合并仍保留正文的知识记录。');
    if (source.rev !== sourceRev || target.rev !== targetRev) throw new StaleEditError();
    if (
      ['list', 'website_group'].includes(source.record.type) ||
      ['list', 'website_group'].includes(target.record.type)
    )
      throw new Error('清单和网页组请在专用编辑器中追加项目，不合并整条记录。');
    const now = new Date().toISOString(),
      merged = upgradeRecord(target.record),
      trashed = { ...source.record, deleted_at: now, updated_at: now };
    if (
      normalizeText(source.record.content) !== normalizeText(merged.content) &&
      source.record.content
    )
      merged.content += `${merged.content ? '\n\n---\n\n' : ''}## ${source.record.title || '合并记录'}\n\n${source.record.content}`;
    merged.tags = [...new Set([...merged.tags, ...source.record.tags])];
    merged.project_ids = [...new Set([...merged.project_ids, ...source.record.project_ids])];
    merged.schema_version = Math.max(4, merged.schema_version);
    merged.attachments = [
      ...new Map(
        [...(merged.attachments || []), ...(source.record.attachments || [])].map((a) => [a.id, a]),
      ).values(),
    ];
    const urls = new Set(merged.sources.map((s) => s.url));
    source.record.sources.forEach((s) => {
      if (!urls.has(s.url)) {
        merged.sources.push(s);
        urls.add(s.url);
      }
    });
    if (
      merged.schema_version < 3 &&
      source.record.purpose &&
      !(merged.purpose || '').includes(source.record.purpose)
    )
      merged.purpose += `${merged.purpose ? '\n' : ''}${source.record.purpose}`;
    if (
      source.record.summary &&
      source.record.summary !== merged.summary &&
      !merged.content.includes(source.record.summary)
    )
      merged.content += `\n\n合并记录摘要：${source.record.summary}`;
    merged.updated_at = now;
    merged.deleted_at = null;
    const changes = [
      { record: trashed, expectedRev: source.rev },
      { record: merged, expectedRev: target.rev },
    ];
    for (const project of await this.allRows()) {
      if (!project.record.graph) continue;
      const edges = project.record.graph.edges.filter(
        (e) => e.source !== sourceId && e.target !== sourceId,
      );
      if (edges.length !== project.record.graph.edges.length)
        changes.push({
          record: { ...project.record, graph: { ...project.record.graph, edges }, updated_at: now },
          expectedRev: project.rev,
        });
    }
    await this.saveMany(changes);
  }
  async enqueueCapture(record, matches) {
    const db = await this.open();
    const tx = db.transaction('captures', 'readwrite');
    const done = completed(tx);
    tx.objectStore('captures').put({
      id: record.id,
      record: normalizeRecord(record),
      matches,
      created_at: record.created_at,
    });
    await done;
    this.changed();
  }
  async finishCapture(captureId, record, expectedRev) {
    const prepared = await this.prepare(record);
    const db = await this.open();
    const tx = db.transaction(['records', 'catalog', 'search', 'captures'], 'readwrite');
    const done = completed(tx);
    let error;
    const captureReq = tx.objectStore('captures').get(captureId);
    captureReq.onsuccess = () => {
      if (!captureReq.result) {
        error = new Error('这条收集已在另一窗口处理。');
        tx.abort();
        return;
      }
      const req = tx.objectStore('records').get(record.id);
      req.onsuccess = () => {
        const old = req.result;
        if ((old?.rev || 0) !== expectedRev) {
          error = new StaleEditError();
          tx.abort();
          return;
        }
        this.putRow(tx, {
          ...prepared,
          rev: (old?.rev || 0) + 1,
          dirty: true,
        });
        tx.objectStore('captures').delete(captureId);
      };
    };
    try {
      await done;
    } catch (e) {
      throw error || e;
    }
    this.changed();
  }
  async captures() {
    const db = await this.open();
    return request(db.transaction('captures').objectStore('captures').getAll());
  }
  async dismissCapture(id) {
    const db = await this.open();
    const tx = db.transaction('captures', 'readwrite');
    const done = completed(tx);
    tx.objectStore('captures').delete(id);
    await done;
    this.changed();
  }
  guardProjects(tx, fail) {
    const req = tx.objectStore('catalog').getAll();
    req.onsuccess = () => {
      try {
        validateProjects(req.result);
      } catch (error) {
        fail(error);
        tx.abort();
      }
    };
  }
  async acknowledgeCompanion(id, link, namespace = 'companion') {
    const db = await this.open();
    const tx = db.transaction(['records', 'catalog', 'search', 'state'], 'readwrite');
    const done = completed(tx);
    tx.objectStore('state').put({ key: `${namespace}:row:${id}`, value: link });
    const req = tx.objectStore('records').get(id);
    req.onsuccess = () => {
      if (req.result) this.putRow(tx, { ...req.result, dirty: req.result.hash !== link.hash });
    };
    await done;
  }
  async applyCompanionChanges(
    changes,
    links,
    cursor,
    conflicts,
    deferred = [],
    namespace = 'companion',
  ) {
    const changedIds = new Set(changes.map((change) => change.record.id));
    const prepared = await Promise.all(
      changes
        .filter((change) => ![TAG_LIBRARY_ID, SHORTCUT_LIBRARY_ID].includes(change.record.id))
        .map(async (change) => ({
          ...change,
          prepared: await this.prepare(change.record),
        })),
    );
    const db = await this.open();
    const tx = db.transaction(['records', 'catalog', 'search', 'state', 'assets'], 'readwrite');
    const done = completed(tx);
    let error;
    const tagChange = changes.find((change) => change.record.id === TAG_LIBRARY_ID);
    if (tagChange) {
      const record = normalizeTagLibrary(tagChange.record);
      const revision = tx.objectStore('state').get(TAG_REVISION);
      revision.onsuccess = () => {
        const current = revision.result?.value || 0;
        if (current !== tagChange.expectedRev) {
          error = new StaleEditError();
          tx.abort();
          return;
        }
        writeTagLibrary(tx.objectStore('state'), record, current + 1);
      };
    }
    const shortcutChange = changes.find((change) => change.record.id === SHORTCUT_LIBRARY_ID);
    if (shortcutChange) {
      const record = normalizeShortcutLibrary(shortcutChange.record);
      const revision = tx.objectStore('state').get(SHORTCUT_REVISION);
      revision.onsuccess = () => {
        const current = revision.result?.value || 0;
        if (current !== shortcutChange.expectedRev) {
          error = new StaleEditError();
          tx.abort();
          return;
        }
        writeShortcutLibrary(tx.objectStore('state'), record, current + 1);
      };
    }
    for (const change of prepared) {
      const req = tx.objectStore('records').get(change.record.id);
      req.onsuccess = () => {
        const current = req.result;
        if ((current?.rev || 0) !== change.expectedRev) {
          error = new StaleEditError();
          tx.abort();
          return;
        }
        this.putRow(tx, { ...change.prepared, rev: (current?.rev || 0) + 1, dirty: false });
        for (const descriptor of change.record.attachments || []) {
          const asset = tx.objectStore('assets').get(descriptor.id);
          asset.onsuccess = () =>
            tx.objectStore('assets').put({ ...asset.result, id: descriptor.id, descriptor });
        }
      };
    }
    for (const [id, link] of links) {
      tx.objectStore('state').put({ key: `${namespace}:row:${id}`, value: link });
      if (!changedIds.has(id)) {
        const req = tx.objectStore('records').get(id);
        req.onsuccess = () => {
          if (req.result) this.putRow(tx, { ...req.result, dirty: req.result.hash !== link.hash });
        };
      }
    }
    tx.objectStore('state').put({ key: `${namespace}:cursor`, value: cursor });
    tx.objectStore('state').put({ key: `${namespace}:conflicts`, value: conflicts });
    tx.objectStore('state').put({ key: `${namespace}:deferred`, value: deferred });
    // Read validation after all queued record writes, in this same transaction.
    const barrier = tx.objectStore('state').get(`${namespace}:cursor`);
    barrier.onsuccess = () =>
      this.guardProjects(tx, (e) => {
        error = e;
      });
    try {
      await done;
    } catch (e) {
      throw error || e;
    }
    this.changed(`${namespace}-result`);
  }
  async exportData() {
    const [rows, captures, drafts, assets, tags, shortcuts] = await Promise.all([
      this.allRows(),
      this.captures(),
      this.drafts(),
      this.allAssets(),
      this.tagLibrary(),
      this.shortcutLibrary(),
    ]);
    return {
      format: 'pkm-nexus-backup',
      schema_version: 5,
      exported_at: new Date().toISOString(),
      records: rows.map((row) => ({ record: row.record })),
      pending_captures: captures.map((c) => ({ record: c.record })),
      drafts,
      asset_catalog: assets.map((a) => a.descriptor),
      tag_library: tags.record,
      shortcut_library: shortcuts.record,
    };
  }
  async previewImport(data) {
    if (
      data?.format !== 'pkm-nexus-backup' ||
      ![1, 2, 3, 4, 5].includes(data.schema_version) ||
      !Array.isArray(data.records) ||
      data.records.length > 100_000
    )
      throw new Error('请选择 GUGA Knowledge JSON 或完整 ZIP 备份。');
    const ids = new Set(),
      entries = [];
    for (const item of data.records) {
      const record = normalizeRecord(item.record);
      if (ids.has(record.id)) throw new Error('备份包含重复 ID，未进行导入。');
      ids.add(record.id);
      const row = await this.prepare(record);
      const existing = await this.get(record.id);
      entries.push({
        record,
        existingRev: existing?.rev || 0,
        status: !existing ? 'new' : existing.hash === row.hash ? 'same' : 'changed',
      });
    }
    if (data.pending_captures != null && !Array.isArray(data.pending_captures))
      throw new Error('待处理收集格式不正确。');
    const captures = (data.pending_captures || []).map((item) => {
      return { record: normalizeRecord(item.record) };
    });
    if (captures.length > 10_000) throw new Error('待处理收集条数过多。');
    const captureIds = new Set();
    for (const { record } of captures) {
      if (captureIds.has(record.id)) throw new Error('备份中的待处理收集包含重复 ID。');
      captureIds.add(record.id);
    }
    if (data.drafts != null && (!Array.isArray(data.drafts) || data.drafts.length > 10_000))
      throw new Error('草稿格式不正确。');
    const drafts = [];
    for (const item of data.drafts || []) {
      if (
        !/^draft:(?:panel|editor:(?:new|[a-zA-Z0-9_-]+))(?::[a-zA-Z0-9_-]+)?$/.test(item.key) ||
        !item.value ||
        typeof item.value !== 'object' ||
        Array.isArray(item.value)
      )
        throw new Error('草稿格式不正确。');
      const value = structuredClone(item.value);
      if (value.record) {
        value.record = normalizeRecord(value.record);
        delete value.scope;
        if (
          value.record.type === 'project' ||
          value.record.kind === 'tombstone' ||
          !Number.isSafeInteger(value.expectedRev) ||
          value.expectedRev < 0 ||
          (value.rawUrls !== undefined &&
            (typeof value.rawUrls !== 'string' || value.rawUrls.length > 800_000)) ||
          (value.savedAt !== undefined &&
            (!Number.isSafeInteger(value.savedAt) || value.savedAt < 0)) ||
          (value.pendingTabs !== undefined &&
            (!Array.isArray(value.pendingTabs) || value.pendingTabs.length > 10000)) ||
          Object.keys(value).some(
            (k) =>
              !['record', 'expectedRev', 'rawUrls', 'savedAt', 'pendingTabs', 'ui'].includes(k),
          )
        )
          throw new Error('编辑草稿格式不正确。');
        if (value.ui !== undefined) {
          const ui = value.ui;
          if (
            !ui ||
            typeof ui !== 'object' ||
            Array.isArray(ui) ||
            Object.keys(ui).some(
              (key) =>
                ![
                  'listMode',
                  'previewing',
                  'closeTabs',
                  'urlInput',
                  'urlTitle',
                  'tabDrawerOpen',
                  'selectedTabs',
                  'collectedIds',
                  'listEntryTodo',
                  'listEntryIdea',
                ].includes(key),
            ) ||
            ['listMode', 'previewing', 'closeTabs', 'tabDrawerOpen'].some(
              (key) => ui[key] !== undefined && typeof ui[key] !== 'boolean',
            ) ||
            ['urlInput', 'urlTitle', 'listEntryTodo', 'listEntryIdea'].some(
              (key) =>
                ui[key] !== undefined && (typeof ui[key] !== 'string' || ui[key].length > 800000),
            ) ||
            (ui.selectedTabs !== undefined &&
              (!Array.isArray(ui.selectedTabs) ||
                ui.selectedTabs.length > 10000 ||
                ui.selectedTabs.some((id) => !Number.isSafeInteger(id)))) ||
            (ui.collectedIds !== undefined &&
              (!Array.isArray(ui.collectedIds) ||
                ui.collectedIds.length > 10000 ||
                ui.collectedIds.some((id) => !validId(id))))
          )
            throw new Error('编辑草稿控件状态不正确。');
          // Browser tab handles belong to the original live session, never to an imported backup.
          ui.selectedTabs = [];
          ui.tabDrawerOpen = false;
        }
        if (value.pendingTabs) value.pendingTabs = [];
      } else {
        if (
          Object.keys(value).some(
            (k) => !['title', 'content', 'url', 'type', 'local', 'attachments'].includes(k),
          ) ||
          ![
            'note',
            'snapshot',
            'list',
            'website_group',
            'web',
            'image',
            'audio',
            'web_chat',
            'artifact',
            'todo',
          ].includes(value.type) ||
          (value.local != null && typeof value.local !== 'boolean') ||
          ['title', 'content', 'url'].some((k) => typeof value[k] !== 'string') ||
          value.title.length > 500 ||
          value.content.length > 1_000_000 ||
          value.url.length > 8000
        )
          throw new Error('收集草稿格式不正确。');
        delete value.local;
        if (value.attachments) value.attachments = value.attachments.map(normalizeAttachment);
      }
      let key = item.key;
      const current = await this.getState(key);
      if (current && canonical(current) === canonical(value)) continue;
      if (current)
        key = `${key.replace(/:(?:archive|backup)-[a-zA-Z0-9_-]+$/, '')}:backup-${(await digest(value)).slice(0, 12)}`;
      drafts.push({ key, value });
    }
    const tagLibrary =
      data.tag_library === undefined ? null : normalizeTagLibrary(data.tag_library);
    const shortcutLibrary =
      data.shortcut_library === undefined ? null : normalizeShortcutLibrary(data.shortcut_library);
    return { entries, captures, drafts, tagLibrary, shortcutLibrary };
  }
  async applyImport(plan, overwrite = false) {
    const selected = plan.entries.filter(
      (e) => e.status === 'new' || (overwrite && e.status === 'changed'),
    );
    const rows = await Promise.all(
      selected.map(async (item) => ({ item, prepared: await this.prepare(item.record) })),
    );
    const db = await this.open();
    const tx = db.transaction(
      ['records', 'catalog', 'search', 'captures', 'state', 'assets'],
      'readwrite',
    );
    const done = completed(tx);
    let error;
    if (plan.tagLibrary) {
      const keys = [TAG_GROUPS, TAG_STYLES, TAG_REVISION];
      const values = {};
      for (const key of keys) {
        const req = tx.objectStore('state').get(key);
        req.onsuccess = () => {
          values[key] = req.result?.value;
          if (key !== TAG_REVISION) return;
          const local = tagLibraryFromState(values[TAG_GROUPS], values[TAG_STYLES]);
          const definitions = new Map(local.definitions.map((item) => [item.name, item]));
          for (const item of normalizeTagLibrary(plan.tagLibrary).definitions)
            if (overwrite || !definitions.has(item.name)) definitions.set(item.name, item);
          writeTagLibrary(
            tx.objectStore('state'),
            { ...local, definitions: [...definitions.values()] },
            (values[TAG_REVISION] || 0) + 1,
          );
        };
      }
    }
    if (plan.shortcutLibrary) {
      const shortcuts = normalizeShortcutLibrary(plan.shortcutLibrary).shortcuts;
      const existing = tx.objectStore('state').get(SHORTCUTS_KEY);
      existing.onsuccess = () => {
        const current = shortcutLibraryFromState(existing.result?.value).shortcuts;
        const merged = overwrite
          ? shortcuts
          : [
              ...current,
              ...shortcuts.filter((item) => !current.some((old) => old.id === item.id)),
            ].slice(0, 12);
        const revision = tx.objectStore('state').get(SHORTCUT_REVISION);
        revision.onsuccess = () =>
          writeShortcutLibrary(
            tx.objectStore('state'),
            shortcutLibraryFromState(merged),
            (revision.result?.value || 0) + 1,
          );
      };
    }
    let remaining = rows.length;
    for (const { item, prepared } of rows) {
      const req = tx.objectStore('records').get(item.record.id);
      req.onsuccess = () => {
        const old = req.result;
        if ((old?.rev || 0) !== item.existingRev) {
          error = new StaleEditError();
          tx.abort();
          return;
        }
        this.putRow(tx, {
          ...prepared,
          rev: (old?.rev || 0) + 1,
          dirty: true,
        });
        if (--remaining === 0)
          this.guardProjects(tx, (e) => {
            error = e;
          });
      };
    }
    for (const { record } of plan.captures) {
      const recordReq = tx.objectStore('records').get(record.id);
      recordReq.onsuccess = () => {
        if (recordReq.result) {
          if (canonical(recordReq.result.record) !== canonical(record)) {
            error = new Error('备份的待处理收集与已保存记录发生 ID 冲突，已取消整批导入。');
            tx.abort();
          }
          return;
        }
        const captureReq = tx.objectStore('captures').get(record.id);
        captureReq.onsuccess = () => {
          if (captureReq.result) {
            if (canonical(captureReq.result.record) !== canonical(record)) {
              error = new Error('待处理收集的同一 ID 内容不同，已取消导入以保留双方数据。');
              tx.abort();
            }
            return;
          }
          tx.objectStore('captures').put({
            id: record.id,
            record,
            matches: [],
            created_at: record.created_at,
          });
        };
      };
    }
    for (const draft of plan.drafts || []) {
      const req = tx.objectStore('state').get(draft.key);
      req.onsuccess = () => {
        if (!req.result?.value) tx.objectStore('state').put(draft);
      };
    }
    for (const asset of plan.assets || []) tx.objectStore('assets').put(asset);
    try {
      await done;
    } catch (e) {
      throw error || e;
    }
    this.changed();
    return selected.length;
  }
}

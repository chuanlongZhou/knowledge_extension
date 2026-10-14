import {upgradeRecord, normalizeRecord, normalizeAttachment, MIME_EXT, MAX_ASSET_BYTES, digestBytes, metadata, digest, normalizeText, urlKey, searchText, tombstone, canonical} from './model.js';

const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('本地写入已取消。')); tx.onerror = () => {}; });
export class StaleEditError extends Error { constructor() { super('这条记录已在其他窗口修改，请重新打开后编辑，当前输入仍保留。'); this.name = 'StaleEditError'; } }

export class Database {
  constructor(name = 'pkm-nexus-v1', {broadcast = true} = {}) {
    this.name = name;
    this.channel = broadcast && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`${name}:changes`) : null;
    this.listeners = new Set();
    if (this.channel) this.channel.onmessage = () => this.listeners.forEach(fn => fn());
  }
  async open() {
    if (!this.promise) this.promise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) {
        db.createObjectStore('records', {keyPath: 'id'});
        const catalog = db.createObjectStore('catalog', {keyPath: 'id'});
        catalog.createIndex('updated_at', 'updated_at');
        catalog.createIndex('url_keys', 'url_keys', {multiEntry: true});
        catalog.createIndex('content_key', 'content_key');
        db.createObjectStore('search', {keyPath: 'id'});
        db.createObjectStore('state', {keyPath: 'key'});
        db.createObjectStore('captures', {keyPath: 'id'});
        db.createObjectStore('conflicts', {keyPath: 'id'});
        }
        if (!db.objectStoreNames.contains('staging')) db.createObjectStore('staging', {keyPath: 'id'});
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', {keyPath:'id'});
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', {keyPath:'id'});
        if (!db.objectStoreNames.contains('recordingChunks')) db.createObjectStore('recordingChunks', {keyPath:'key'});
        const cursorReq=req.transaction.objectStore('records').openCursor();
        cursorReq.onsuccess=()=>{const cursor=cursorReq.result;if(!cursor)return;const row=cursor.value;if(row.scope!=='sync'){row.scope='sync';row.dirty=row.hash!==row.baseHash;cursor.update(row);const catalogReq=req.transaction.objectStore('catalog').get(row.id);catalogReq.onsuccess=()=>{if(catalogReq.result) req.transaction.objectStore('catalog').put({...catalogReq.result,scope:'sync',dirty:row.dirty});};}cursor.continue();};
      };
      req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('请关闭旧版本的整理窗口后重试。'));
    });
    return this.promise;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { this.channel?.postMessage('changed'); this.listeners.forEach(fn => fn()); }
  async close() { if (this.promise) (await this.promise).close(); this.channel?.close(); }
  async get(id) { const db = await this.open(); return request(db.transaction('records').objectStore('records').get(id)); }
  async getState(key, fallback = null) { const db = await this.open(); return (await request(db.transaction('state').objectStore('state').get(key)))?.value ?? fallback; }
  async setState(key, value) { const db = await this.open(); const tx = db.transaction('state', 'readwrite'); const done = completed(tx); tx.objectStore('state').put({key, value}); await done; this.changed(); }
  async allCatalog() { const db = await this.open(); return request(db.transaction('catalog').objectStore('catalog').getAll()); }
  async allRows() { const db = await this.open(); return request(db.transaction('records').objectStore('records').getAll()); }
  async getAsset(id) {const db=await this.open();return request(db.transaction('assets').objectStore('assets').get(id));}
  async allAssets() {const db=await this.open();return request(db.transaction('assets').objectStore('assets').getAll());}
  async storeAsset(blob, name='附件', duration_ms=null) {
    const mime_type=blob.type.split(';')[0].toLowerCase();
    if(!MIME_EXT[mime_type] || !blob.size || blob.size>MAX_ASSET_BYTES)throw new Error('支持 PNG/JPEG/GIF/WebP/AVIF 图片和常用音频；单附件最多 20 MB。');
    const id=await digestBytes(await blob.arrayBuffer());
    const descriptor=normalizeAttachment({id,sha256:id,kind:mime_type.startsWith('image/')?'image':mime_type==='application/x-mimearchive'?'snapshot':'audio',name,mime_type,size_bytes:blob.size,path:`assets/${id}.${MIME_EXT[mime_type]}`,created_at:new Date().toISOString(),duration_ms});
    await this.putAsset(descriptor,blob);return descriptor;
  }
  async putAsset(descriptor,blob,remote_commit=null) {
    descriptor=normalizeAttachment(descriptor);
    if(blob.size!==descriptor.size_bytes || await digestBytes(await blob.arrayBuffer())!==descriptor.id)throw new Error('附件校验失败，未保存。');
    const db=await this.open(),tx=db.transaction('assets','readwrite'),done=completed(tx);tx.objectStore('assets').put({id:descriptor.id,descriptor,blob,remote_commit});await done;
  }
  async startRecording(mime_type) {
    const recording={id:crypto.randomUUID(),mime_type,created_at:new Date().toISOString(),chunks:0,size_bytes:0};
    const db=await this.open(),tx=db.transaction('recordings','readwrite'),done=completed(tx);tx.objectStore('recordings').put(recording);await done;return recording;
  }
  async appendRecording(id,blob) {
    const db=await this.open(),tx=db.transaction(['recordings','recordingChunks'],'readwrite'),done=completed(tx);let updated,error;
    const req=tx.objectStore('recordings').get(id);req.onsuccess=()=>{const recording=req.result;if(!recording){error=new Error('录音会话不存在。');tx.abort();return;}updated={...recording,chunks:recording.chunks+1,size_bytes:recording.size_bytes+blob.size};tx.objectStore('recordingChunks').put({key:[id,recording.chunks],blob});tx.objectStore('recordings').put(updated);};try{await done;}catch(e){throw error||e;}return updated;
  }
  async recordings() {const db=await this.open();return request(db.transaction('recordings').objectStore('recordings').getAll());}
  async recordingBlob(id) {
    const db=await this.open(),tx=db.transaction(['recordings','recordingChunks']);const [recording,chunks]=await Promise.all([request(tx.objectStore('recordings').get(id)),request(tx.objectStore('recordingChunks').getAll(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER])))]);
    if(!recording||!chunks.length)throw new Error('录音尚无可恢复片段。');return {recording,blob:new Blob(chunks.map(c=>c.blob),{type:recording.mime_type})};
  }
  async finishRecording(id) {const {recording,blob}=await this.recordingBlob(id);return this.storeAsset(blob,`录音-${recording.created_at.slice(0,19).replace(/[:T]/g,'-')}.${MIME_EXT[recording.mime_type.split(';')[0]]}`,Date.now()-Date.parse(recording.created_at));}
  async removeRecording(id) {const db=await this.open(),tx=db.transaction(['recordings','recordingChunks'],'readwrite'),done=completed(tx);tx.objectStore('recordings').delete(id);tx.objectStore('recordingChunks').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));await done;}
  async drafts() { const db = await this.open(); const items = await request(db.transaction('state').objectStore('state').getAll()); return items.filter(item => item.key.startsWith('draft:') && item.value && (item.value.record?.title || item.value.record?.content || item.value.record?.attachments?.length || item.value.attachments?.length || item.value.rawUrls || item.value.title || item.value.content || item.value.url)); }
  async snapshot() {
    const db = await this.open(); const tx = db.transaction(['records', 'catalog', 'state']);
    return new Promise((resolve, reject) => {
      const catalogReq = tx.objectStore('catalog').getAll(), repoReq = tx.objectStore('state').get('repoKey');
      const rows = new Map(); let repoKey = null;
      catalogReq.onsuccess = () => { for (const entry of catalogReq.result) {
        rows.set(entry.id, entry);
        // Only dirty bodies are needed for an outgoing batch; clean records stay on disk.
        if (entry.scope === 'sync' && entry.dirty) { const req = tx.objectStore('records').get(entry.id); req.onsuccess = () => rows.set(entry.id, req.result); }
      } };
      repoReq.onsuccess = () => { repoKey = repoReq.result?.value || null; };
      tx.oncomplete = () => resolve({rows, repoKey}); tx.onabort = () => reject(tx.error); tx.onerror = () => {};
    });
  }
  async assertRepo(repoKey) {
    const bound = await this.getState('repoKey');
    if (bound && bound !== repoKey) throw new Error('本机数据已绑定另一仓库或分支。请先导出备份，并在独立浏览器配置中连接新仓库，避免混合两套数据。');
  }
  async prepare(record, fields = {}) {
    record = normalizeRecord(record);
    const content_key = record.kind === 'tombstone' || !normalizeText(record.content) ? '' : await digest(normalizeText(record.content));
    return {id: record.id, record, hash: await digest(record), content_key, url_keys: record.sources?.map(s => urlKey(s.url)).filter(Boolean) || [], ...fields};
  }
  putRow(tx, row) {
    tx.objectStore('records').put(row);
    tx.objectStore('catalog').put(metadata(row.record, {hash: row.hash, rev: row.rev, baseHash: row.baseHash, dirty: row.dirty, scope: row.scope, content_key: row.content_key, url_keys: row.url_keys}));
    tx.objectStore('search').put({id: row.id, text: searchText(row.record)});
  }
  async save(record, {expectedRev, scope} = {}) {
    const prepared = await this.prepare(record);
    const db = await this.open(); const tx = db.transaction(['records', 'catalog', 'search'], 'readwrite'); const done = completed(tx);
    let error, saved;
    const req = tx.objectStore('records').get(record.id);
    req.onsuccess = () => {
      const old = req.result;
      if (expectedRev !== undefined && (old?.rev || 0) !== expectedRev) { error = new StaleEditError(); tx.abort(); return; }
      const nextScope = 'sync';
      if (old && old.hash === prepared.hash && old.scope === nextScope) { saved = old; return; }
      const baseHash = old?.baseHash ?? null;
      saved = {...prepared, rev: (old?.rev || 0) + 1, scope: nextScope, baseHash, dirty: nextScope === 'sync' && prepared.hash !== baseHash};
      this.putRow(tx, saved);
    };
    try { await done; } catch (e) { throw error || e; }
    this.changed(); return saved;
  }
  async mutate(id, fn) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const old = await this.get(id); if (!old) throw new Error('记录不存在。');
      const next = fn(structuredClone(old.record));
      try { return await this.save(next, {expectedRev: old.rev}); } catch (e) { if (!(e instanceof StaleEditError)) throw e; }
    }
    throw new StaleEditError();
  }
  trash(id) { return this.mutate(id, record => { if (record.kind === 'tombstone') throw new Error('当前内容已经移除。'); record.deleted_at = new Date().toISOString(); record.updated_at = record.deleted_at; return record; }); }
  restore(id) { return this.mutate(id, record => { if (record.kind === 'tombstone') throw new Error('当前正文已移除，不能从回收站还原。'); record.deleted_at = null; record.updated_at = new Date().toISOString(); return record; }); }
  purge(id) { return this.mutate(id, record => { if (!record.deleted_at) throw new Error('请先将记录移入回收站。'); return tombstone(record); }); }
  async searchIds(words) {
    const db = await this.open(), result = new Set(); let lastKey;
    // Bounded batches reduce IPC overhead without reading every body into memory.
    for (;;) {
      const range = lastKey === undefined ? null : IDBKeyRange.lowerBound(lastKey, true);
      const batch = await request(db.transaction('search').objectStore('search').getAll(range, 256));
      for (const item of batch) if (words.every(word => item.text.includes(word))) result.add(item.id);
      if (batch.length < 256) break;
      lastKey = batch[batch.length - 1].id;
    }
    return result;
  }
  async list({view = 'inbox', query = '', tag = '', project = '', keywordProject = null, ids = null, type = '', limit = 60, offset = 0} = {}) {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const matches = await this.searchIds(words);
      if (ids) for (const id of matches) if (!ids.has(id)) matches.delete(id);
      return this.list({view, tag, project, keywordProject, ids: matches, type, limit, offset});
    }
    const db = await this.open(); const tx = db.transaction(['catalog', 'search', 'records']);
    const result = []; let matched = 0;
    return new Promise((resolve, reject) => {
      const req = tx.objectStore('catalog').index('updated_at').openCursor(null, 'prev');
      req.onerror = () => reject(req.error); tx.onabort = () => reject(tx.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || result.length > limit) { resolve({items: result.slice(0, limit), hasMore: result.length > limit}); return; }
        const m = cursor.value;
        if (m.kind === 'tombstone' || (m.type === 'project' && view !== 'trash') || (view === 'trash' ? !m.deleted_at : !!m.deleted_at) || (view === 'inbox' && m.organization_state !== 'inbox') || (view === 'organized' && m.organization_state !== 'organized') || (view === 'pending' && !m.dirty) || (ids && !ids.has(m.id)) || (tag && !m.tags.includes(tag)) || (project && !m.project_ids.includes(project)) || (type && m.type !== type)) { cursor.continue(); return; }
        const accept = () => { if (matched++ >= offset) result.push(m); cursor.continue(); };
        const checkKeywords = () => {
          if (!keywordProject) { accept(); return; }
          const recordReq = tx.objectStore('records').get(m.id);
          recordReq.onsuccess = () => { const r = recordReq.result?.record; const values = r && {title: r.title, content: `${r.content}\n${r.summary}\n${(r.list||[]).map(i=>i.text).join('\n')}\n${r.purpose||''}`, tags: r.tags.join(' '), url: [...r.sources.map(s=>s.url),...(r.url_list||[]).map(u=>u.url)].join(' ')};
            if (values && keywordProject.keywords.some(k => keywordProject.match_fields.some(f => (values[f] || '').toLocaleLowerCase().includes(k.toLocaleLowerCase())))) accept(); else cursor.continue();
          };
        };
        checkKeywords();
      };
    });
  }
  async duplicates(record) {
    const contentKey = record.content.trim() ? await digest(normalizeText(record.content)) : '';
    const urls = record.sources.map(s => urlKey(s.url)).filter(Boolean);
    const db = await this.open(); const tx = db.transaction('catalog'); const store = tx.objectStore('catalog');
    const lists = await Promise.all([...urls.map(url => request(store.index('url_keys').getAll(url))), ...(contentKey ? [request(store.index('content_key').getAll(contentKey))] : [])]);
    const matches = new Map();
    for (const m of lists.flat()) {
      if (m.id === record.id || m.kind === 'tombstone' || m.type === 'project') continue;
      const sameUrl = m.url_keys.some(url => urls.includes(url));
      const sameContent = m.content_key === contentKey;
      matches.set(m.id, {...m, match: sameUrl && sameContent ? 'exact' : sameUrl ? 'related' : 'similar'});
    }
    const order = {exact: 0, related: 1, similar: 2};
    return [...matches.values()].sort((a, b) => Number(!!a.deleted_at) - Number(!!b.deleted_at) || order[a.match] - order[b.match]).slice(0, 12);
  }
  async mergeRecords(sourceId, targetId, sourceRev, targetRev) {
    if (sourceId === targetId) throw new Error('请选择两条不同记录。');
    const [source, target] = await Promise.all([this.get(sourceId), this.get(targetId)]);
    if (!source || !target || source.record.kind === 'tombstone' || target.record.kind === 'tombstone' || source.record.type === 'project' || target.record.type === 'project') throw new Error('只能合并仍保留正文的知识记录。');
    if (source.rev !== sourceRev || target.rev !== targetRev) throw new StaleEditError();
    if(['list','website_group'].includes(source.record.type)||['list','website_group'].includes(target.record.type))throw new Error('清单和网页组请在专用编辑器中追加项目，不合并整条记录。');
    const now = new Date().toISOString(), merged = upgradeRecord(target.record), trashed = {...source.record, deleted_at: now, updated_at: now};
    if (normalizeText(source.record.content) !== normalizeText(merged.content) && source.record.content) merged.content += `${merged.content ? '\n\n---\n\n' : ''}## ${source.record.title || '合并记录'}\n\n${source.record.content}`;
    merged.tags = [...new Set([...merged.tags, ...source.record.tags])]; merged.project_ids = [...new Set([...merged.project_ids, ...source.record.project_ids])];
    merged.schema_version=4;merged.attachments=[...new Map([...(merged.attachments||[]),...(source.record.attachments||[])].map(a=>[a.id,a])).values()];
    const urls = new Set(merged.sources.map(s => s.url)); source.record.sources.forEach(s => { if (!urls.has(s.url)) { merged.sources.push(s); urls.add(s.url); } });
    if (merged.schema_version<3 && source.record.purpose && !(merged.purpose||'').includes(source.record.purpose)) merged.purpose += `${merged.purpose ? '\n' : ''}${source.record.purpose}`;
    if (source.record.summary && source.record.summary !== merged.summary && !merged.content.includes(source.record.summary)) merged.content += `\n\n合并记录摘要：${source.record.summary}`;
    merged.updated_at = now; merged.deleted_at = null;
    const prepared = await Promise.all([this.prepare(trashed), this.prepare(merged)]);
    const db = await this.open(), tx = db.transaction(['records', 'catalog', 'search'], 'readwrite'), done = completed(tx); let error;
    for (const [i, previous] of [source, target].entries()) {
      const req = tx.objectStore('records').get(previous.id);
      req.onsuccess = () => { const current = req.result; if (current?.rev !== previous.rev) { error = new StaleEditError(); tx.abort(); return; }
        this.putRow(tx, {...prepared[i], rev: current.rev + 1, scope: current.scope, baseHash: current.baseHash, dirty: current.scope === 'sync' && prepared[i].hash !== current.baseHash});
      };
    }
    try { await done; } catch (e) { throw error || e; } this.changed();
  }
  async enqueueCapture(record, matches, scope = 'sync') {
    const db = await this.open(); const tx = db.transaction('captures', 'readwrite'); const done = completed(tx);
    tx.objectStore('captures').put({id: record.id, record: normalizeRecord(record), scope:'sync', matches, created_at: record.created_at}); await done; this.changed();
  }
  async finishCapture(captureId, record, expectedRev, scope) {
    const prepared = await this.prepare(record);
    const db = await this.open(); const tx = db.transaction(['records', 'catalog', 'search', 'captures'], 'readwrite'); const done = completed(tx); let error;
    const captureReq = tx.objectStore('captures').get(captureId);
    captureReq.onsuccess = () => {
      if (!captureReq.result) { error = new Error('这条收集已在另一窗口处理。'); tx.abort(); return; }
      const req = tx.objectStore('records').get(record.id);
      req.onsuccess = () => {
        const old = req.result;
        if ((old?.rev || 0) !== expectedRev) { error = new StaleEditError(); tx.abort(); return; }
        const nextScope = 'sync';
        this.putRow(tx, {...prepared, rev: (old?.rev || 0) + 1, scope: nextScope, baseHash: old?.baseHash || null, dirty: nextScope === 'sync' && prepared.hash !== old?.baseHash});
        tx.objectStore('captures').delete(captureId);
      };
    };
    try { await done; } catch (e) { throw error || e; } this.changed();
  }
  async captures() { const db = await this.open(); return request(db.transaction('captures').objectStore('captures').getAll()); }
  async dismissCapture(id) { const db = await this.open(); const tx = db.transaction('captures', 'readwrite'); const done = completed(tx); tx.objectStore('captures').delete(id); await done; this.changed(); }
  async setConflicts(conflicts) {
    const db = await this.open(); const tx = db.transaction(['conflicts','assets'], 'readwrite'); const done = completed(tx); const store = tx.objectStore('conflicts'); store.clear();
    for(const conflict of conflicts){store.put(conflict);for(const descriptor of conflict.remoteRecord.attachments||[]){const req=tx.objectStore('assets').get(descriptor.id);req.onsuccess=()=>tx.objectStore('assets').put({...req.result,id:descriptor.id,descriptor,remote_commit:conflict.remoteCommit||req.result?.remote_commit||null});}}
    await done; this.changed();
  }
  async conflicts() { const db = await this.open(); return request(db.transaction('conflicts').objectStore('conflicts').getAll()); }
  async resolveConflict(id, choice, merged) {
    if (!['local', 'remote', 'merge'].includes(choice)) throw new Error('冲突处理选项不正确。');
    const db = await this.open(); const conflict = await request(db.transaction('conflicts').objectStore('conflicts').get(id));
    if (!conflict) throw new Error('冲突已经处理，请重新同步。');
    const local = await this.get(id);
    if (local?.hash !== conflict.localHash) throw new StaleEditError();
    let record = choice === 'remote' ? conflict.remoteRecord : choice === 'merge' ? normalizeRecord(merged) : local.record;
    if (record.id !== id) throw new Error('合并版本不能更换记录 ID。');
    if (choice !== 'remote' && conflict.remoteRecord.kind === 'tombstone' && record.kind !== 'tombstone') throw new Error('远程正文已移除，请先另存本地内容为新记录，再接受远程删除。');
    const prepared = await this.prepare(record);
    const tx = db.transaction(['records', 'catalog', 'search', 'conflicts'], 'readwrite'); const done = completed(tx); let error;
    const req = tx.objectStore('records').get(id);
    req.onsuccess = () => { const current = req.result; if (current?.rev !== local.rev) { error = new StaleEditError(); tx.abort(); return; }
      this.putRow(tx, {...prepared, rev: current.rev + 1, scope: current.scope, baseHash: conflict.remoteHash, dirty: prepared.hash !== conflict.remoteHash}); tx.objectStore('conflicts').delete(id);
    };
    try { await done; } catch (e) { throw error || e; } this.changed();
  }
  async reconcile(snapshot, finalRecords, repoKey) {
    await this.clearStaging();
    for (const record of finalRecords.values()) await this.stage(record, snapshot.rows.get(record.id)?.rev || 0);
    return this.reconcileStaged(repoKey);
  }
  async clearStaging() { const db = await this.open(); const tx = db.transaction('staging', 'readwrite'); const done = completed(tx); tx.objectStore('staging').clear(); await done; }
  async stage(record, expectedRev) {
    const prepared = await this.prepare(record); const db = await this.open(); const tx = db.transaction('staging', 'readwrite'); const done = completed(tx);
    tx.objectStore('staging').put({...prepared, expectedRev}); await done;
  }
  async reconcileStaged(repoKey,commit=null) {
    const db = await this.open(); const tx = db.transaction(['records', 'catalog', 'search', 'state', 'conflicts', 'staging','assets'], 'readwrite'); const done = completed(tx);
    const cursorReq = tx.objectStore('staging').openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result; if (!cursor) { tx.objectStore('staging').clear(); return; }
      const {expectedRev, ...remote} = cursor.value;
      for(const descriptor of remote.record.attachments||[]){const assetReq=tx.objectStore('assets').get(descriptor.id);assetReq.onsuccess=()=>tx.objectStore('assets').put({...assetReq.result,id:descriptor.id,descriptor,remote_commit:commit||assetReq.result?.remote_commit||null});}
      const req = tx.objectStore('records').get(remote.id);
      req.onsuccess = () => {
        const current = req.result;
        if (current?.scope !== 'local') {
          if (current && current.rev !== expectedRev) this.putRow(tx, {...current, baseHash: remote.hash, dirty: current.hash !== remote.hash});
          else this.putRow(tx, {...remote, rev: (current?.rev || 0) + 1, scope: 'sync', baseHash: remote.hash, dirty: false});
        }
        cursor.continue();
      };
    };
    tx.objectStore('state').put({key: 'repoKey', value: repoKey});
    tx.objectStore('state').put({key: 'lastSync', value: new Date().toISOString()});
    if(commit)tx.objectStore('state').put({key:'lastSyncCommit',value:commit});
    tx.objectStore('conflicts').clear(); await done; this.changed();
  }
  async exportData() {
    const [rows, captures, drafts,assets] = await Promise.all([this.allRows(), this.captures(), this.drafts(),this.allAssets()]);
    return {format: 'pkm-nexus-backup', schema_version: 4, exported_at: new Date().toISOString(), records: rows.map(row => ({record: row.record})), pending_captures: captures.map(c => ({record: c.record})), drafts,asset_catalog:assets.map(a=>a.descriptor)};
  }
  async previewImport(data) {
    if (data?.format !== 'pkm-nexus-backup' || ![1,2,3,4].includes(data.schema_version) || !Array.isArray(data.records) || data.records.length > 100_000) throw new Error('请选择 PKM-Nexus JSON 或完整 ZIP 备份。');
    const ids = new Set(), entries = [];
    for (const item of data.records) {
      const record = normalizeRecord(item.record); if (ids.has(record.id)) throw new Error('备份包含重复 ID，未进行导入。'); ids.add(record.id);
      if (item.scope!=null && !['sync', 'local'].includes(item.scope)) throw new Error('备份中的保存范围不正确。');
      const row = await this.prepare(record); const existing = await this.get(record.id);
      entries.push({record, scope:'sync', existingRev: existing?.rev || 0, status: !existing ? 'new' : existing.hash === row.hash ? 'same' : 'changed'});
    }
    if (data.pending_captures != null && !Array.isArray(data.pending_captures)) throw new Error('待处理收集格式不正确。');
    const captures = (data.pending_captures || []).map(item => { if (item.scope!=null && !['sync', 'local'].includes(item.scope)) throw new Error('待处理收集的范围不正确。'); return {record: normalizeRecord(item.record), scope:'sync'}; });
    if (captures.length > 10_000) throw new Error('待处理收集条数过多。');
    const captureIds = new Set();
    for (const {record} of captures) { if (captureIds.has(record.id)) throw new Error('备份中的待处理收集包含重复 ID。'); captureIds.add(record.id); }
    if (data.drafts != null && (!Array.isArray(data.drafts) || data.drafts.length > 10_000)) throw new Error('草稿格式不正确。');
    const drafts = [];
    for (const item of data.drafts || []) {
      if (!/^draft:(?:panel|editor:(?:new|[a-zA-Z0-9_-]+))(?::[a-zA-Z0-9_-]+)?$/.test(item.key) || !item.value || typeof item.value !== 'object' || Array.isArray(item.value)) throw new Error('草稿格式不正确。');
      const value = structuredClone(item.value);
      if (value.record) {
        value.record = normalizeRecord(value.record);value.scope='sync';
        if (value.record.type === 'project' || value.record.kind === 'tombstone' || !['sync', 'local'].includes(value.scope) || !Number.isSafeInteger(value.expectedRev) || value.expectedRev < 0 || (value.rawUrls !== undefined && (typeof value.rawUrls !== 'string' || value.rawUrls.length > 800_000)) || Object.keys(value).some(k => !['record', 'scope', 'expectedRev', 'rawUrls'].includes(k))) throw new Error('编辑草稿格式不正确。');
      } else {
        if (Object.keys(value).some(k => !['title', 'content', 'url', 'type', 'local','attachments'].includes(k)) || !['note','snapshot','list','website_group','web','image','audio', 'web_chat', 'artifact', 'todo'].includes(value.type) || (value.local!=null && typeof value.local !== 'boolean') || ['title', 'content', 'url'].some(k => typeof value[k] !== 'string') || value.title.length > 500 || value.content.length > 1_000_000 || value.url.length > 8000) throw new Error('收集草稿格式不正确。');
        delete value.local;if(value.attachments)value.attachments=value.attachments.map(normalizeAttachment);
      }
      let key = item.key; const current = await this.getState(key);
      if (current && canonical(current) === canonical(value)) continue;
      if (current) key = `${key.replace(/:(?:archive|backup)-[a-zA-Z0-9_-]+$/, '')}:backup-${(await digest(value)).slice(0, 12)}`;
      drafts.push({key, value});
    }
    return {entries, captures, drafts};
  }
  async applyImport(plan, overwrite = false) {
    const selected = plan.entries.filter(e => e.status === 'new' || (overwrite && e.status === 'changed'));
    const rows = await Promise.all(selected.map(async item => ({item, prepared: await this.prepare(item.record)})));
    const db = await this.open(); const tx = db.transaction(['records', 'catalog', 'search', 'captures', 'state','assets'], 'readwrite'); const done = completed(tx); let error;
    for (const {item, prepared} of rows) {
      const req = tx.objectStore('records').get(item.record.id);
      req.onsuccess = () => { const old = req.result; if ((old?.rev || 0) !== item.existingRev) { error = new StaleEditError(); tx.abort(); return; }
        const scope = 'sync';
        this.putRow(tx, {...prepared, rev: (old?.rev || 0) + 1, scope, baseHash: old?.baseHash || null, dirty: scope === 'sync' && prepared.hash !== old?.baseHash});
      };
    }
    for (const {record, scope} of plan.captures) {
      const recordReq = tx.objectStore('records').get(record.id);
      recordReq.onsuccess = () => {
        if (recordReq.result) { if (canonical(recordReq.result.record) !== canonical(record)) { error = new Error('备份的待处理收集与已保存记录发生 ID 冲突，已取消整批导入。'); tx.abort(); } return; }
        const captureReq = tx.objectStore('captures').get(record.id);
        captureReq.onsuccess = () => {
          if (captureReq.result) { if (canonical(captureReq.result.record) !== canonical(record)) { error = new Error('待处理收集的同一 ID 内容不同，已取消导入以保留双方数据。'); tx.abort(); } return; }
          tx.objectStore('captures').put({id: record.id, record, scope, matches: [], created_at: record.created_at});
        };
      };
    }
    for (const draft of plan.drafts || []) { const req = tx.objectStore('state').get(draft.key); req.onsuccess = () => { if (!req.result?.value) tx.objectStore('state').put(draft); }; }
    for(const asset of plan.assets||[])tx.objectStore('assets').put(asset);
    try { await done; } catch (e) { throw error || e; } this.changed(); return selected.length;
  }
}

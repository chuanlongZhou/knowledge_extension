import {normalizeRecord, normalizeAttachment, recordPath, validPath, digest, digestBytes, indexEntry, canonical} from './model.js';

export class GitHubError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'GitHubError'; this.status = status; }
}
export function validateConfig(config) {
  const owner = (config.owner || '').trim(), repo = (config.repo || '').trim(), branch = (config.branch || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo)) throw new Error('请填写正确的 GitHub 用户名和仓库名。');
  if (branch.length > 250 || (branch && (/[\s~^:?*\[\\]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch.split('/').some(s => !s || s.startsWith('.') || s.endsWith('.lock'))))) throw new Error('分支名称格式不正确。');
  return {owner, repo, branch};
}
const encodeBranch = value => value.split('/').map(encodeURIComponent).join('/');
export class GitHub {
  constructor(config, token, {fetchImpl = fetch, signal, progress = () => {}} = {}) {
    this.config = validateConfig(config); this.token = token?.trim(); this.fetchImpl = fetchImpl; this.signal = signal; this.progress = progress;
    if (!this.token) throw new Error('请在设置中填写 GitHub Token。');
    this.root = `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}`;
  }
  async request(path, {method = 'GET', body, raw = false, binary=false, maxBytes = 25_000_000} = {}) {
    if (!path.startsWith(`${this.root}/`) && path !== this.root) throw new Error('禁止访问目标仓库之外的 API。');
    this.signal?.throwIfAborted();
    const controller = new AbortController(); const abort = () => controller.abort();
    this.signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      // Native browser fetch must not receive the GitHub instance as its receiver.
      const fetcher = this.fetchImpl;
      const response = await fetcher(`https://api.github.com${path}`, {
        method, headers: {Authorization: `Bearer ${this.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal, redirect: 'error', cache: 'no-store'
      });
      if (!response.ok) {
        const reason = response.status === 401 ? 'Token 无效或已过期。' : response.status === 403 || response.status === 429 ? '权限不足或 API 额度受限，请检查 Contents 读写权限后稍后重试。' : response.status === 404 ? '找不到仓库、分支或文件，请检查配置和 Token 的仓库访问范围。' : response.status === 409 || response.status === 422 ? '远程版本发生变化，或请求被 GitHub 拒绝。' : `GitHub 请求失败（${response.status}），本地数据仍保留。`;
        throw new GitHubError(reason, response.status);
      }
      if(binary){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>maxBytes)throw new Error('附件超过大小限制。');return bytes;}
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('远程响应超过安全大小，已停止读取，本地数据仍保留。');
      if (!text) return null;
      try { return JSON.parse(text); } catch { throw new Error('远程文件不是有效 JSON，已停止同步。'); }
    } catch (error) {
      if (error.name === 'AbortError') throw new GitHubError(this.signal?.aborted ? '同步已取消，本地数据仍保留。' : '网络请求超时，本地数据仍保留。');
      if (error instanceof TypeError) throw new GitHubError('网络连接失败，请检查网络后重新手动同步。');
      throw error;
    } finally { clearTimeout(timer); this.signal?.removeEventListener('abort', abort); }
  }
  async connect() {
    const repo = await this.request(this.root);
    if (!repo.private) throw new Error('第一版只同步到私有仓库，请先将目标仓库设为 Private。');
    this.branch = this.config.branch || repo.default_branch || 'main';
    this.repoKey = `${this.config.owner.toLowerCase()}/${this.config.repo.toLowerCase()}#${this.branch}`;
    return {repoKey: this.repoKey, branch: this.branch, private: true};
  }
  async head() {
    try {
      const ref = await this.request(`${this.root}/git/ref/heads/${encodeBranch(this.branch)}`);
      const commit = await this.request(`${this.root}/git/commits/${ref.object.sha}`);
      return {sha: ref.object.sha, tree: commit.tree.sha};
    } catch (error) {
      if (error.status !== 404 && error.status !== 409) throw error;
      let refs;
      try { refs = await this.request(`${this.root}/git/matching-refs/heads/`); } catch (e) { if (e.status === 409) refs = []; else throw e; }
      if (refs.length) throw new Error('指定分支不存在。请填写已有分支，或清空分支栏使用仓库默认分支。');
      return {sha: null, tree: null};
    }
  }
  validateIndex(index) {
    if (index?.format !== 'pkm-nexus-index' || ![1,2,3,4].includes(index.schema_version) || !Array.isArray(index.entries) || index.entries.length > 100_000) throw new Error('远程索引格式不受支持，可在设置中主动扫描仓库重建索引。');
    const entries = new Map();
    for (const item of index.entries) {
      if (!validPath(item.path, item.id) || !/^[a-f0-9]{64}$/.test(item.hash) || entries.has(item.id)) throw new Error('远程索引包含无效路径、版本或重复 ID，已停止同步。');
      entries.set(item.id, item);
    }
    return entries;
  }
  async readRemote({scan = false} = {}) {
    const head = await this.head();
    if (!head.sha) return {...head, entries: new Map(), cached: new Map(), needsIndex: false};
    if (!scan) {
      try {
        const index = await this.request(`${this.root}/contents/index/global_index.json?ref=${encodeURIComponent(head.sha)}`, {raw: true});
        return {...head, entries: this.validateIndex(index), cached: new Map(), needsIndex: false};
      } catch (error) { if (error.status !== 404) throw error; }
    }
    this.progress('正在扫描已有记录，重建索引…');
    const tree = await this.request(`${this.root}/git/trees/${head.tree}?recursive=1`);
    if (tree.truncated) throw new Error('仓库目录过大，扫描结果被截断；请使用独立的知识仓库。');
    const entries = new Map(), cached = new Map();
    for (const file of tree.tree) {
      if (file.type !== 'blob' || !/^(data\/|tombstones\/).*\.json$/.test(file.path)) continue;
      const data = await this.request(`${this.root}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(head.sha)}`, {raw: true, maxBytes: 6_000_000});
      const record = normalizeRecord(data);
      if (file.path !== recordPath(record)) throw new Error(`仓库中的记录路径不匹配：${file.path}`);
      const old = cached.get(record.id);
      if (old && old.kind !== 'tombstone' && record.kind !== 'tombstone') throw new Error('仓库存在重复记录 ID，不能自动重建索引。');
      if (old?.kind === 'tombstone') continue;
      cached.set(record.id, record); entries.set(record.id, indexEntry(record, await digest(record)));
    }
    return {...head, entries, cached, needsIndex: true};
  }
  async readRecord(entry, commit) {
    if (!validPath(entry.path, entry.id)) throw new Error('远程记录路径不正确。');
    const raw = await this.request(`${this.root}/contents/${entry.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(commit)}`, {raw: true, maxBytes: 6_000_000});
    const record = normalizeRecord(raw);
    if (record.id !== entry.id || recordPath(record) !== entry.path || await digest(record) !== entry.hash) throw new Error('远程记录与索引不一致，已停止同步以保护数据。');
    return record;
  }
  async readAsset(descriptor,commit) {
    descriptor=normalizeAttachment(descriptor);
    const bytes=await this.request(`${this.root}/contents/${descriptor.path}?ref=${encodeURIComponent(commit||this.branch)}`,{raw:true,binary:true,maxBytes:20*1024*1024});
    if(bytes.byteLength!==descriptor.size_bytes || await digestBytes(bytes)!==descriptor.sha256)throw new Error('远程附件校验失败，文件与记录不一致。');
    return new Blob([bytes],{type:descriptor.mime_type});
  }
  async writeBatch(remote, writes, entries, {readAsset}={}) {
    const tree = [], removed = new Set();
    const remoteAssets=new Map([...remote.entries.values()].flatMap(e=>e.attachments||[]).map(a=>[a.id,normalizeAttachment(a)])),uploaded=new Set();
    for(const {record} of writes)for(const descriptor of record.attachments||[]){
      if(remoteAssets.has(descriptor.id)||uploaded.has(descriptor.id))continue;
      const stored=await readAsset?.(descriptor);if(!stored?.blob)throw new Error(`附件“${descriptor.name}”缺失，请导入包含附件的完整 ZIP。`);
      const bytes=new Uint8Array(await stored.blob.arrayBuffer());if(bytes.byteLength!==descriptor.size_bytes||await digestBytes(bytes)!==descriptor.id)throw new Error('待上传附件校验失败。');
      let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
      this.progress(`正在上传附件：${descriptor.name}…`);
      const blob=await this.request(`${this.root}/git/blobs`,{method:'POST',body:{content:btoa(encoded),encoding:'base64'}});
      tree.push({path:descriptor.path,mode:'100644',type:'blob',sha:blob.sha});uploaded.add(descriptor.id);
    }
    for (const {record, hash} of writes) {
      const path = recordPath(record), old = remote.entries.get(record.id);
      if (old && old.path !== path) removed.add(old.path);
      const blob = await this.request(`${this.root}/git/blobs`, {method: 'POST', body: {content: canonical(record), encoding: 'utf-8'}});
      tree.push({path, mode: '100644', type: 'blob', sha: blob.sha});
      entries.set(record.id, indexEntry(record, hash));
    }
    for (const path of removed) tree.push({path, mode: '100644', type: 'blob', sha: null});
    const referenced=new Set([...entries.values()].flatMap(e=>(e.attachments||[]).map(a=>a.id)));
    for(const [id,descriptor] of remoteAssets)if(!referenced.has(id))removed.add(descriptor.path);
    // Attachment removal is part of the same commit, and only occurs once no record references it.
    for(const path of removed)if(!tree.some(item=>item.path===path))tree.push({path,mode:'100644',type:'blob',sha:null});
    const index = {format: 'pkm-nexus-index', schema_version: 4, entries: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id))};
    const indexBlob = await this.request(`${this.root}/git/blobs`, {method: 'POST', body: {content: canonical(index), encoding: 'utf-8'}});
    tree.push({path: 'index/global_index.json', mode: '100644', type: 'blob', sha: indexBlob.sha});
    const createdTree = await this.request(`${this.root}/git/trees`, {method: 'POST', body: {tree, ...(remote.tree ? {base_tree: remote.tree} : {})}});
    const commit = await this.request(`${this.root}/git/commits`, {method: 'POST', body: {message: `PKM-Nexus: sync ${writes.length} change(s)`, tree: createdTree.sha, parents: remote.sha ? [remote.sha] : []}});
    this.progress('正在提交记录和索引…');
    try {
      if (remote.sha) await this.request(`${this.root}/git/refs/heads/${encodeBranch(this.branch)}`, {method: 'PATCH', body: {sha: commit.sha, force: false}});
      else await this.request(`${this.root}/git/refs`, {method: 'POST', body: {ref: `refs/heads/${this.branch}`, sha: commit.sha}});
    } catch (error) {
      // A successful ref update may lose its response. Verify before retrying.
      try {
        const actual = await this.request(`${this.root}/git/ref/heads/${encodeBranch(this.branch)}`);
        if (actual.object.sha === commit.sha) return commit.sha;
      } catch { /* The next manual synchronization will verify the durable records. */ }
      throw error;
    }
    return commit.sha;
  }
}

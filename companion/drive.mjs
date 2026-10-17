import { randomUUID } from 'node:crypto';
import { normalizeAttachment, MAX_ASSET_BYTES } from '../extension/lib/model.js';
import { sha256, isHash } from './util.mjs';
const API = 'https://www.googleapis.com/drive/v3';
const FIELDS = 'id,name,size,mimeType,parents,appProperties,trashed,ownedByMe';
const folderMime = 'application/vnd.google-apps.folder';
const validId = (id) => typeof id === 'string' && /^[\w-]{1,200}$/.test(id);
export class DriveError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export class DriveClient {
  constructor(
    auth,
    {
      fetchImpl = fetch,
      sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      sessionStore,
    } = {},
  ) {
    this.auth = auth;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.sessionStore = sessionStore;
  }
  async request(
    url,
    {
      method = 'GET',
      body,
      headers = {},
      maxBytes = 8 * 1024 * 1024,
      binary = false,
      allowStatus = [],
    } = {},
  ) {
    const target = new URL(url);
    if (
      target.origin !== 'https://www.googleapis.com' ||
      !/^\/(upload\/)?drive\/v3\//.test(target.pathname)
    )
      throw new Error('Drive request target is not allowed.');
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = await this.auth.token({ expectedAccountId: this.expectedAccountId });
      const response = await this.fetch(url, {
        method,
        body,
        headers: { Authorization: `Bearer ${token}`, ...headers },
        redirect: 'error',
        signal: AbortSignal.timeout(180000),
      });
      if (allowStatus.includes(response.status))
        return { status: response.status, headers: response.headers };
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        const delay = Math.max(
          1000 * 2 ** attempt,
          Number(response.headers.get('retry-after') || 0) * 1000,
        );
        await response.body?.cancel();
        if (delay > 30000)
          throw new DriveError('Google 要求稍后重试，未同步修改已保留。', response.status);
        await this.sleep(delay);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new DriveError(
          response.status === 401
            ? 'Google 授权失效，请重新连接。'
            : response.status === 403
              ? 'Google Drive 权限不足或额度受限，请检查授权后重试。'
              : response.status === 404
                ? '远程资料库或文件不存在，请检查 Drive 中的文件。'
                : `Google Drive 请求失败（${response.status}），本机修改仍保留。`,
          response.status,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) return binary ? Buffer.alloc(0) : null;
      const chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > maxBytes) throw new Error('Drive response exceeds the permitted size.');
          chunks.push(Buffer.from(value));
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      return binary ? bytes : bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
    }
  }
  async list(q) {
    let pageToken,
      files = [];
    do {
      const params = new URLSearchParams({
        q,
        spaces: 'drive',
        pageSize: '1000',
        fields: `nextPageToken,files(${FIELDS})`,
        ...(pageToken ? { pageToken } : {}),
      });
      const result = await this.request(`${API}/files?${params}`);
      files.push(...result.files);
      pageToken = result.nextPageToken;
    } while (pageToken);
    return files;
  }
  async withAccount(accountId, operation) {
    const previous = this.expectedAccountId;
    this.expectedAccountId = accountId;
    try {
      return await operation();
    } finally {
      this.expectedAccountId = previous;
    }
  }
  async folders() {
    return this.list(
      `'me' in owners and trashed = false and mimeType = '${folderMime}' and appProperties has { key='pkm_role' and value='vault' }`,
    );
  }
  async currentUser() {
    const { user } = await this.request(
      `${API}/about?fields=user(permissionId,emailAddress,displayName)`,
    );
    if (
      typeof user?.permissionId !== 'string' ||
      !user.permissionId ||
      user.permissionId.length > 200
    )
      throw new Error('无法确认当前 Google Drive 账号，请重新登录。');
    return { id: user.permissionId, email: user.emailAddress || '', name: user.displayName || '' };
  }
  async createFolder(name = 'PKM Nexus') {
    if (typeof name !== 'string' || !name.trim() || name.length > 200)
      throw new Error('资料库名称不正确。');
    return this.request(`${API}/files?fields=${encodeURIComponent(FIELDS)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: folderMime,
        appProperties: { pkm_role: 'vault', pkm_format: 'nexus-v1', pkm_vault: randomUUID() },
      }),
    });
  }
  async folder(id) {
    if (!validId(id)) throw new Error('Invalid Drive folder ID.');
    const file = await this.request(`${API}/files/${id}?fields=${encodeURIComponent(FIELDS)}`);
    if (
      file.trashed ||
      file.mimeType !== folderMime ||
      file.appProperties?.pkm_role !== 'vault' ||
      file.appProperties?.pkm_format !== 'nexus-v1' ||
      !file.appProperties?.pkm_vault
    )
      throw new Error('请选择由 PKM Nexus 创建的资料库文件夹。');
    if (file.ownedByMe !== true) throw new Error('请选择当前 Google 账号自己拥有的资料库。');
    return file;
  }
  async allocateId() {
    return (await this.request(`${API}/files/generateIds?count=1&space=drive&type=files`)).ids[0];
  }
  async download(id, maxBytes = 8 * 1024 * 1024) {
    if (!validId(id)) throw new Error('Invalid Drive file ID.');
    return this.request(`${API}/files/${id}?alt=media`, { binary: true, maxBytes });
  }
  async upload({ id, parent, name, bytes, role, hash }) {
    if (
      !validId(id) ||
      !validId(parent) ||
      !isHash(hash) ||
      bytes.length > Math.max(MAX_ASSET_BYTES, 8 * 1024 * 1024)
    )
      throw new Error('Invalid upload.');
    const metadata = {
      id,
      name,
      parents: [parent],
      mimeType: role === 'batch' ? 'application/json' : 'application/octet-stream',
      appProperties: { pkm_role: role, pkm_sha256: hash },
    };
    try {
      if (bytes.length <= 5 * 1024 * 1024) {
        const boundary = `pkm-${randomUUID()}`,
          body = Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
            ),
            bytes,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ]);
        await this.request(
          `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`,
          {
            method: 'POST',
            body,
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          },
        );
      } else {
        let location = this.sessionStore?.getState(`drive:upload-session:${id}`),
          offset = 0;
        if (location) {
          const status = await this.request(location, {
            method: 'PUT',
            body: Buffer.alloc(0),
            headers: { 'Content-Length': '0', 'Content-Range': `bytes */${bytes.length}` },
            allowStatus: [200, 201, 308, 404, 410],
          });
          if ([200, 201].includes(status.status)) {
            if (sha256(await this.download(id, bytes.length + 1)) !== hash)
              throw new Error('Completed upload checksum mismatch.');
            this.sessionStore?.setState(`drive:upload-session:${id}`, null);
            return id;
          }
          if (status.status === 308) {
            const match = /^bytes=0-(\d+)$/.exec(status.headers.get('range') || '');
            offset = match ? Number(match[1]) + 1 : 0;
          } else location = null;
        }
        if (!location) {
          const init = await this.request(
            `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id`,
            {
              method: 'POST',
              body: JSON.stringify(metadata),
              headers: {
                'Content-Type': 'application/json',
                'X-Upload-Content-Type': metadata.mimeType,
                'X-Upload-Content-Length': String(bytes.length),
              },
              allowStatus: [200],
            },
          );
          location = init.headers.get('location');
          if (!location) throw new Error('Drive did not provide a resumable upload URL.');
          this.sessionStore?.setState(`drive:upload-session:${id}`, location);
        }
        for (; offset < bytes.length; offset += 8 * 1024 * 1024) {
          const end = Math.min(bytes.length, offset + 8 * 1024 * 1024);
          await this.request(location, {
            method: 'PUT',
            body: bytes.subarray(offset, end),
            headers: {
              'Content-Length': String(end - offset),
              'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}`,
            },
            allowStatus: end < bytes.length ? [308] : [],
          });
        }
        this.sessionStore?.setState(`drive:upload-session:${id}`, null);
      }
    } catch (error) {
      // A completed upload can lose its response. Reuse the allocated ID and verify bytes.
      try {
        if (sha256(await this.download(id, bytes.length + 1)) === hash) return id;
      } catch {
        /* Keep the original actionable error. */
      }
      throw error;
    }
    return id;
  }
  async startToken() {
    return (await this.request(`${API}/changes/startPageToken`)).startPageToken;
  }
  async changes(pageToken) {
    return this.request(
      `${API}/changes?${new URLSearchParams({ pageToken, spaces: 'drive', pageSize: '100', fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))` })}`,
    );
  }
}

export class DriveSync {
  constructor(vault, client) {
    this.vault = vault;
    this.client = client;
  }
  async bind(folderId) {
    const account = await this.assertAccount(),
      folder = await this.client.withAccount(account.id, () => this.client.folder(folderId)),
      previous = this.vault.getState('drive:binding');
    if (previous && previous.id !== folder.id)
      throw new Error('本地资料库已连接另一远程资料库。请使用新的本地资料库，避免混合数据。');
    this.vault.setState('drive:binding', {
      id: folder.id,
      vaultId: folder.appProperties.pkm_vault,
      name: folder.name,
      accountId: account.id,
      accountEmail: account.email,
    });
    return this.vault.getState('drive:binding');
  }
  async assertAccount() {
    const account = await this.client.currentUser(),
      binding = this.vault.getState('drive:binding');
    if (binding?.accountId && binding.accountId !== account.id)
      throw new Error(
        '当前 Google 账号与此本地资料库绑定的账号不同，已停止云端读写。请登录原账号，或在设置中选择另一个本地资料库。',
      );
    return account;
  }
  async consume(file, binding) {
    if (
      file.trashed ||
      file.appProperties?.pkm_role !== 'batch' ||
      !file.parents?.includes(binding.id)
    )
      return 0;
    const seen = this.vault.db.prepare('SELECT 1 FROM cloud_files WHERE id=?').get(file.id);
    if (seen) return 0;
    const bytes = await this.client.download(file.id);
    if (!isHash(file.appProperties.pkm_sha256) || sha256(bytes) !== file.appProperties.pkm_sha256)
      throw new Error('远端同步批次校验失败，本机数据仍保留。');
    const batch = JSON.parse(bytes.toString('utf8'));
    if (
      batch.format !== 'pkm-nexus-batch' ||
      batch.version !== 1 ||
      batch.vaultId !== binding.vaultId ||
      !Array.isArray(batch.entries) ||
      batch.entries.length > 100 ||
      !Array.isArray(batch.assets) ||
      batch.assets.length > 500
    )
      throw new Error('Unsupported Drive synchronization batch.');
    const entries = batch.entries.map((e) => this.vault.validateEnvelope(e));
    const assets = batch.assets.map((item) => {
      const descriptor = normalizeAttachment(item.descriptor);
      if (!validId(item.fileId)) throw new Error('Invalid remote attachment ID.');
      return { descriptor, fileId: item.fileId };
    });
    const available = new Set(assets.map((a) => a.descriptor.id));
    for (const item of entries)
      for (const asset of item.record.attachments || [])
        if (!available.has(asset.id) && !this.vault.assetInfo(asset).remoteId)
          throw new Error('同步批次缺少附件引用。');
    for (const item of assets) this.vault.setRemoteAsset(item.descriptor, item.fileId);
    let count = 0;
    for (const entry of entries) if (await this.vault.apply(entry, { uploaded: true })) count++;
    this.vault.db.prepare('INSERT OR IGNORE INTO cloud_files(id) VALUES(?)').run(file.id);
    return count;
  }
  async run() {
    this.vault.db.exec('CREATE TABLE IF NOT EXISTS cloud_files(id TEXT PRIMARY KEY)');
    const binding = this.vault.getState('drive:binding');
    if (!binding) throw new Error('请先选择或创建 Google Drive 资料库。');
    const account = await this.assertAccount();
    return this.client.withAccount(account.id, () => this.runBound(binding, account));
  }
  async runBound(binding, account) {
    await this.client.folder(binding.id);
    if (!binding.accountId) {
      binding.accountId = account.id;
      binding.accountEmail = account.email;
      this.vault.setState('drive:binding', binding);
    }
    let pulled = 0,
      pushed = 0,
      cursor = this.vault.getState('drive:cursor');
    if (!cursor) {
      const start = await this.client.startToken();
      for (const file of await this.client.list(
        `'${binding.id}' in parents and trashed = false and appProperties has { key='pkm_role' and value='batch' }`,
      ))
        pulled += await this.consume(file, binding);
      this.vault.setState('drive:cursor', start);
      cursor = start;
    }
    for (;;) {
      const page = await this.client.changes(cursor);
      for (const change of page.changes || []) {
        if (change.removed) continue;
        if (change.file) pulled += await this.consume(change.file, binding);
      }
      cursor = page.nextPageToken || page.newStartPageToken;
      if (!cursor) throw new Error('Drive did not return a change cursor.');
      this.vault.setState('drive:cursor', cursor);
      if (!page.nextPageToken) break;
    }
    for (;;) {
      let outbox = this.vault.getState('drive:outbox');
      if (!outbox) {
        const entries = [];
        let length = 0;
        const batchAssets = new Map();
        for (const item of this.vault.pending(50)) {
          const size = Buffer.byteLength(JSON.stringify(item));
          const combined = new Map(batchAssets);
          for (const descriptor of item.record.attachments || [])
            combined.set(descriptor.id, descriptor);
          const referenceBytes = [...combined.values()].reduce(
            (sum, descriptor) => sum + Buffer.byteLength(JSON.stringify(descriptor)) + 250,
            0,
          );
          if (
            entries.length &&
            (length + size + referenceBytes > 6 * 1024 * 1024 || combined.size > 500)
          )
            break;
          if (length + size + referenceBytes > 8 * 1024 * 1024 || combined.size > 500)
            throw new Error('单条记录超过同步批次限制，请拆分记录后重试。');
          entries.push(item);
          length += size;
          for (const [id, descriptor] of combined) batchAssets.set(id, descriptor);
        }
        if (!entries.length) break;
        const assets = [],
          unique = new Map(
            entries.flatMap((e) => e.record.attachments || []).map((a) => [a.id, a]),
          );
        for (const descriptor of unique.values()) {
          let info = this.vault.assetInfo(descriptor);
          if (!info.remoteId) {
            const bytes = await this.vault.assetBytes(descriptor);
            if (!bytes) throw new Error(`附件“${descriptor.name}”尚未交接到本地程序。`);
            const fileId =
              this.vault.getState(`drive:asset-upload:${descriptor.id}`) ||
              (await this.client.allocateId());
            this.vault.setState(`drive:asset-upload:${descriptor.id}`, fileId);
            await this.client.upload({
              id: fileId,
              parent: binding.id,
              name: descriptor.path.split('/').at(-1),
              bytes,
              role: 'asset',
              hash: descriptor.id,
            });
            this.vault.setRemoteAsset(descriptor, fileId);
            this.vault.setState(`drive:asset-upload:${descriptor.id}`, null);
            info = this.vault.assetInfo(descriptor);
          }
          assets.push({ descriptor, fileId: info.remoteId });
        }
        const batch = {
            format: 'pkm-nexus-batch',
            version: 1,
            vaultId: binding.vaultId,
            entries,
            assets,
          },
          bytes = JSON.stringify(batch);
        outbox = {
          id: await this.client.allocateId(),
          body: bytes,
          hash: sha256(bytes),
          revisions: entries.map((e) => e.revision),
        };
        this.vault.setState('drive:outbox', outbox);
      }
      await this.client.upload({
        id: outbox.id,
        parent: binding.id,
        name: `changes-${outbox.hash}.json`,
        bytes: Buffer.from(outbox.body),
        role: 'batch',
        hash: outbox.hash,
      });
      this.vault.acknowledge(outbox.revisions);
      pushed += outbox.revisions.length;
      this.vault.setState('drive:outbox', null);
    }
    const conflicts = this.vault.db
      .prepare('SELECT count(*) AS count FROM catalog WHERE conflict=1')
      .get().count;
    const result = { at: new Date().toISOString(), pushed, pulled, conflicts };
    this.vault.setState('drive:lastSync', result);
    return result;
  }
  async asset(descriptor) {
    const cached = await this.vault.assetBytes(descriptor);
    if (cached) return cached;
    const info = this.vault.assetInfo(descriptor);
    if (!info.remoteId) throw new Error('附件尚未上传或远程引用缺失。');
    const account = await this.assertAccount();
    const bytes = await this.client.withAccount(account.id, () =>
      this.client.download(info.remoteId, MAX_ASSET_BYTES),
    );
    await this.vault.storeAsset(descriptor, bytes);
    return bytes;
  }
}

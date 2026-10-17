export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const fields = 'id,name,mimeType,parents,appProperties,trashed,ownedByMe,size';
const validId = (id) => typeof id === 'string' && /^[\w-]{1,200}$/.test(id);
export class DriveError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export class GoogleDrive {
  constructor({
    identity = globalThis.chrome?.identity,
    runtime = globalThis.chrome?.runtime,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {}) {
    this.identity = identity;
    this.runtime = runtime;
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }
  async authorize(interactive = false) {
    const client = this.runtime?.getManifest().oauth2?.client_id;
    if (!client)
      throw new Error(
        '此扩展尚未配置 Google 登录。请由开发者完成一次 OAuth 配置后重新加载；你的记录仍保存在浏览器中。',
      );
    const result = await this.identity.getAuthToken({ interactive, scopes: [DRIVE_SCOPE] });
    this.accessToken = typeof result === 'string' ? result : result?.token;
    if (!this.accessToken) throw new Error('未取得 Google 授权，请重新登录。');
    return this.account();
  }
  async account() {
    const { user } = await this.json(
      `${API}/about?fields=user(displayName,emailAddress,permissionId)`,
    );
    if (!user?.permissionId) throw new Error('无法确认 Google 账号。');
    return { id: user.permissionId, name: user.displayName || '', email: user.emailAddress || '' };
  }
  async response(url, { method = 'GET', headers = {}, body, maxBytes = 8 * 1024 * 1024 } = {}) {
    const target = new URL(url);
    if (
      target.origin !== 'https://www.googleapis.com' ||
      !/^\/(upload\/)?drive\/v[23]\//.test(target.pathname)
    )
      throw new Error('不允许的 Drive 请求地址。');
    if (!this.accessToken) throw new Error('请先登录 Google Drive。');
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.accessToken}`, ...headers },
        body,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(120000),
      });
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        const delay = Math.max(
          500 * 2 ** attempt,
          Number(response.headers.get('retry-after') || 0) * 1000,
        );
        await response.body?.cancel();
        if (delay > 10000) throw new DriveError('Google 暂时限流，请稍后再同步。', response.status);
        await this.sleep(delay);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401)
          await this.identity?.removeCachedAuthToken({ token: this.accessToken });
        throw new DriveError(
          response.status === 412
            ? '此记录刚被另一设备修改，请先同步下载。'
            : response.status === 401
              ? 'Google 登录已失效，请重新登录。'
              : response.status === 403
                ? 'Google Drive 权限不足或暂时限流。'
                : response.status === 404
                  ? 'Google Drive 文件或文件夹已不存在。'
                  : `Google Drive 请求失败（${response.status}）。`,
          response.status,
        );
      }
      const chunks = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader)
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) {
              await reader.cancel();
              throw new Error('云端文件超出允许大小。');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    }
  }
  async json(url, options) {
    const bytes = await this.response(url, options);
    return bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
  }
  async list(q) {
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q,
        spaces: 'drive',
        pageSize: '1000',
        fields: `nextPageToken,files(${fields})`,
        ...(pageToken ? { pageToken } : {}),
      });
      const data = await this.json(`${API}/files?${params}`);
      files.push(...(data.files || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  }
  folders() {
    return this.list(
      `trashed = false and 'me' in owners and mimeType = '${FOLDER_MIME}' and appProperties has { key='pkm_format' and value='direct-v1' }`,
    );
  }
  async folder(id) {
    if (!validId(id)) throw new Error('文件夹 ID 无效。');
    const folder = await this.json(`${API}/files/${id}?fields=${fields}`);
    if (
      folder.mimeType !== FOLDER_MIME ||
      folder.trashed ||
      !folder.ownedByMe ||
      folder.appProperties?.pkm_format !== 'direct-v1'
    )
      throw new Error('请选择此简化版创建的个人数据文件夹。');
    return folder;
  }
  async createFolder(name) {
    name = name.trim();
    if (!name || name.length > 120) throw new Error('请输入 1–120 字的文件夹名称。');
    const id = await this.generateId();
    return this.json(`${API}/files?fields=${fields}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name,
        mimeType: FOLDER_MIME,
        appProperties: { pkm_format: 'direct-v1' },
      }),
    });
  }
  files(folderId) {
    if (!validId(folderId)) throw new Error('文件夹 ID 无效。');
    return this.list(`'${folderId}' in parents and trashed = false`);
  }
  async createFile(folderId, name, blob, properties, id) {
    if (!validId(folderId)) throw new Error('文件夹 ID 无效。');
    const boundary = `pkm_${crypto.randomUUID()}`;
    const metadata = {
      name,
      parents: [folderId],
      appProperties: properties,
      ...(id ? { id } : {}),
    };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--\r\n`,
    ]);
    return this.json(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${fields}`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
  }
  async generateId() {
    const data = await this.json(`${API}/files/generateIds?count=1&space=drive&type=files`);
    return data.ids[0];
  }
  async download(file, maxBytes = 8 * 1024 * 1024) {
    if (!validId(file.id)) throw new Error('云端文件 ID 无效。');
    return this.response(`${API}/files/${file.id}?alt=media`, { maxBytes });
  }
  async readRecord(file) {
    // Drive v2 exposes a resource ETag. Pair it with a stable read and a conditional media update.
    const meta = () =>
      this.json(`https://www.googleapis.com/drive/v2/files/${file.id}?fields=id,etag`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await meta();
      const bytes = await this.download(file);
      const after = await meta();
      if (!before.etag || before.etag !== after.etag) continue;
      return { value: JSON.parse(new TextDecoder().decode(bytes)), etag: after.etag, file };
    }
    throw new Error('云端记录正在修改，请稍后重试。');
  }
  async updateRecord(id, blob, etag) {
    if (!validId(id) || !etag) throw new Error('缺少云端版本信息，不能覆盖记录。');
    return this.json(
      `https://www.googleapis.com/upload/drive/v2/files/${id}?uploadType=media&fields=id,etag`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': etag },
        body: blob,
      },
    );
  }
  async logout() {
    await this.identity.clearAllCachedAuthTokens();
    this.accessToken = null;
  }
}

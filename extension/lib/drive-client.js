import { t, msg } from './i18n.js';
import { mapConcurrent } from './concurrency.js';
import { libraryDirectory } from './drive-layout.js';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const fields = 'id,name,mimeType,parents,appProperties,trashed,ownedByMe,size,version';
const validId = (id) => typeof id === 'string' && /^[\w-]{1,200}$/.test(id);
async function readBytes(response, maxBytes) {
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
          throw new Error(t('云端文件超出允许大小。'));
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
async function readFailure(response, token) {
  let error;
  try {
    error = JSON.parse(new TextDecoder().decode(await readBytes(response, 64 * 1024)))?.error;
  } catch {
    // Proxies can return HTML; a malformed error body must not hide the HTTP status.
  }
  const details = Array.isArray(error?.details)
    ? error.details.filter((d) => d?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo')
    : [];
  const reasons = [
    ...details.map((d) => d.reason),
    ...(Array.isArray(error?.errors) ? error.errors.map((e) => e?.reason) : []),
  ].filter((r) => typeof r === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(r));
  const disabled = details.find((d) => d.reason === 'SERVICE_DISABLED');
  const project = /^projects\/(\d+)$/.exec(disabled?.metadata?.consumer || '')?.[1];
  const message =
    typeof error?.message === 'string'
      ? error.message.split(token).join('[redacted]').replace(/\s+/g, ' ').slice(0, 400)
      : '';
  return { reasons: [...new Set(reasons)].slice(0, 4), project, message };
}
const isRateLimit = (reasons) =>
  reasons.some((r) =>
    ['rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED'].includes(r),
  );
const insufficientScope = (reasons) =>
  reasons.some((r) => ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(r));
function failureMessage(status, failure) {
  const has = (...values) => failure.reasons.some((r) => values.includes(r));
  let message;
  if (status === 412) message = t('此记录刚被另一设备修改，请先同步下载。');
  else if (status === 401) message = t('Google 登录已失效，请重新登录。');
  else if (status === 404) message = t('Google Drive 文件或文件夹已不存在。');
  else if (status === 403 && has('SERVICE_DISABLED', 'accessNotConfigured'))
    message = msg`Google Drive API 尚未启用。请在 OAuth 客户端所属的 Google Cloud 项目${failure.project ? `（${failure.project}）` : ''}中启用 Google Drive API，等待几分钟后重试。`;
  else if (status === 403 && insufficientScope(failure.reasons))
    message = t(
      'Google 授权缺少 Drive 文件访问权限。请重新登录并允许访问此应用的 Google Drive 文件。',
    );
  else if (status === 403 && has('insufficientFilePermissions', 'appNotAuthorizedToFile'))
    message = t('当前账号无权访问此文件。请确认登录账号，并使用此简化版创建的数据文件夹。');
  else if (status === 403 && has('dailyLimitExceeded', 'QUOTA_EXCEEDED'))
    message = t('Google Cloud 项目的 API 配额已用完，请检查配额或等待恢复后重试。');
  else if (status === 403 && has('storageQuotaExceeded'))
    message = t('此 Google 账号的 Drive 存储空间已满，请释放空间后重试。');
  else if (status === 403 && has('domainPolicy'))
    message = t('此 Google 账号的组织策略禁止应用访问 Drive，请联系组织管理员。');
  else if (status === 429 || (status === 403 && isRateLimit(failure.reasons)))
    message = t('Google Drive 请求过于频繁，请稍后再试。');
  else
    message = msg`Google Drive 请求失败。${failure.message ? msg`Google 返回：${failure.message}` : t('请重试；如仍失败，请提供此完整提示。')}`;
  return `${message}（HTTP ${status}${failure.reasons.length ? `；${failure.reasons.join(', ')}` : ''}）`;
}
export class DriveError extends Error {
  constructor(message, status, reasons = []) {
    super(message);
    this.status = status;
    this.reasons = reasons;
  }
}
export class GoogleDrive {
  constructor({
    identity = globalThis.chrome?.identity,
    runtime = globalThis.chrome?.runtime,
    // Native Worker fetch requires WorkerGlobalScope as its receiver, not this client instance.
    fetchImpl = globalThis.fetch.bind(globalThis),
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
        t(
          '此扩展尚未配置 Google 登录。请由开发者完成一次 OAuth 配置后重新加载；你的记录仍保存在浏览器中。',
        ),
      );
    const result = await this.identity.getAuthToken({ interactive, scopes: [DRIVE_SCOPE] });
    this.accessToken = typeof result === 'string' ? result : result?.token;
    if (!this.accessToken) throw new Error(t('未取得 Google 授权，请重新登录。'));
    return this.account();
  }
  async account() {
    const { user } = await this.json(
      `${API}/about?fields=user(displayName,emailAddress,permissionId)`,
    );
    if (!user?.permissionId) throw new Error(t('无法确认 Google 账号。'));
    return { id: user.permissionId, name: user.displayName || '', email: user.emailAddress || '' };
  }
  async request(url, { method = 'GET', headers = {}, body, acceptedStatuses = [], signal } = {}) {
    const target = new URL(url);
    if (
      target.origin !== 'https://www.googleapis.com' ||
      !/^\/(upload\/)?drive\/v[23]\//.test(target.pathname)
    )
      throw new Error(t('不允许的 Drive 请求地址。'));
    if (!this.accessToken) throw new Error(t('请先登录 Google Drive。'));
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.accessToken}`, ...headers },
        body,
        redirect: 'error',
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
          : AbortSignal.timeout(120000),
      });
      if (!response.ok && !acceptedStatuses.includes(response.status)) {
        const failure = await readFailure(response, this.accessToken);
        const retryable =
          [429, 500, 502, 503, 504].includes(response.status) ||
          (response.status === 403 && isRateLimit(failure.reasons));
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Math.max(
          500 * 2 ** attempt,
          Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
        );
        if (retryable && attempt < 3 && delay <= 10000) {
          await this.sleep(delay);
          continue;
        }
        if (
          response.status === 401 ||
          (response.status === 403 && insufficientScope(failure.reasons))
        )
          await this.identity?.removeCachedAuthToken({ token: this.accessToken });
        throw new DriveError(
          failureMessage(response.status, failure),
          response.status,
          failure.reasons,
        );
      }
      return response;
    }
  }
  async response(url, { maxBytes = 8 * 1024 * 1024, ...options } = {}) {
    return readBytes(await this.request(url, options), maxBytes);
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
    if (!validId(id)) throw new Error(t('文件夹 ID 无效。'));
    const folder = await this.json(`${API}/files/${id}?fields=${fields}`);
    if (
      folder.mimeType !== FOLDER_MIME ||
      folder.trashed ||
      !folder.ownedByMe ||
      folder.appProperties?.pkm_format !== 'direct-v1'
    )
      throw new Error(t('请选择此简化版创建的个人数据文件夹。'));
    return folder;
  }
  async createFolder(name) {
    name = name.trim();
    if (!name || name.length > 120) throw new Error(t('请输入 1–120 字的文件夹名称。'));
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
  async files(folderId) {
    if (!validId(folderId)) throw new Error(t('文件夹 ID 无效。'));
    const found = new Map(),
      seen = new Set([folderId]),
      queue = [{ id: folderId, key: '' }];
    while (queue.length) {
      const batch = queue.splice(0, 4);
      const children = await mapConcurrent(batch, 4, (folder) =>
        this.list(`'${folder.id}' in parents and trashed = false`),
      );
      children.forEach((files, index) => {
        for (const file of files) {
          found.set(file.id, file);
          if (!seen.has(file.id) && libraryDirectory(file, folderId, batch[index].key)) {
            seen.add(file.id);
            if (seen.size > 64) throw new Error(t('云端重复目录过多，请先检查数据文件夹。'));
            queue.push({ id: file.id, key: file.appProperties.pkm_directory });
          }
        }
      });
    }
    return [...found.values()];
  }
  async createDirectory(rootId, parentId, directory) {
    const id = await this.generateId();
    return this.json(`${API}/files?fields=${fields}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name: directory.name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
        appProperties: { pkm_role: 'directory', pkm_root: rootId, pkm_directory: directory.key },
      }),
    });
  }
  async moveFile(file, targetId, allowedParents) {
    if (!validId(file.id) || !validId(targetId)) throw new Error(t('云端文件 ID 无效。'));
    const current = await this.json(`${API}/files/${file.id}?fields=${fields}`);
    if (current.parents?.includes(targetId)) return false;
    if (
      !current.ownedByMe ||
      current.trashed ||
      !current.parents?.length ||
      current.parents.some((id) => !allowedParents.has(id)) ||
      Object.keys(current.appProperties || {}).length !==
        Object.keys(file.appProperties || {}).length ||
      Object.entries(file.appProperties || {}).some(
        ([key, value]) => current.appProperties?.[key] !== value,
      )
    )
      throw new Error(t('云端文件位置或用途已变化，请重新预览整理。'));
    const query = new URLSearchParams({
      addParents: targetId,
      removeParents: current.parents.join(','),
      fields,
    });
    await this.json(`${API}/files/${file.id}?${query}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return true;
  }
  async createFile(folderId, name, blob, properties, id) {
    if (!validId(folderId)) throw new Error(t('文件夹 ID 无效。'));
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
  async uploadAttachment(folderId, file, properties, onProgress = () => {}, signal) {
    if (!validId(folderId)) throw new Error(t('文件夹 ID 无效。'));
    const id = await this.generateId();
    const mimeType = file.type || 'application/octet-stream';
    const session = await this.request(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size',
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify({
          id,
          name: file.name,
          mimeType,
          parents: [folderId],
          appProperties: properties,
        }),
      },
    );
    const location = session.headers.get('Location');
    if (!location) throw new Error(t('Google Drive 未返回上传地址，请重试。'));
    // File.slice() keeps the file disk-backed; never read file bytes into JS memory.
    const chunkSize = 8 * 1024 * 1024;
    let offset = 0;
    do {
      const end = Math.min(offset + chunkSize, file.size);
      const result = await this.request(location, {
        method: 'PUT',
        signal,
        headers: {
          'Content-Type': mimeType,
          'Content-Range': file.size ? `bytes ${offset}-${end - 1}/${file.size}` : 'bytes */0',
        },
        body: file.slice(offset, end),
        acceptedStatuses: [308],
      });
      if (result.status !== 308) {
        const metadata = JSON.parse(new TextDecoder().decode(await readBytes(result, 64 * 1024)));
        if (metadata.id !== id || Number(metadata.size) !== file.size)
          throw new Error(t('Google Drive 上传校验失败，请重试。'));
        onProgress(file.size, file.size);
        return metadata;
      }
      const next = Number(/^bytes=0-(\d+)$/.exec(result.headers.get('Range') || '')?.[1]) + 1;
      if (!Number.isSafeInteger(next) || next <= offset || next > end || next >= file.size)
        throw new Error(t('Google Drive 上传进度异常，请重新选择文件。'));
      offset = next;
      onProgress(offset, file.size);
    } while (offset < file.size);
    throw new Error(t('Google Drive 上传校验失败，请重试。'));
  }
  async download(file, maxBytes = 8 * 1024 * 1024) {
    if (!validId(file.id)) throw new Error(t('云端文件 ID 无效。'));
    return this.response(`${API}/files/${file.id}?alt=media`, { maxBytes });
  }
  async readRecord(file) {
    // Drive v2 exposes a resource ETag. Pair it with a stable read and a conditional media update.
    const meta = () =>
      this.json(`https://www.googleapis.com/drive/v2/files/${file.id}?fields=id,etag,version`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await meta();
      const bytes = await this.download(file);
      const after = await meta();
      if (!before.etag || before.etag !== after.etag) continue;
      return {
        value: JSON.parse(new TextDecoder().decode(bytes)),
        etag: after.etag,
        version: after.version,
        file,
      };
    }
    throw new Error(t('云端记录正在修改，请稍后重试。'));
  }
  async updateRecord(id, blob, etag) {
    if (!validId(id) || !etag) throw new Error(t('缺少云端版本信息，不能覆盖记录。'));
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

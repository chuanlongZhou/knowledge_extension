import { randomUUID } from 'node:crypto';
import { open, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Vault } from './vault.mjs';
import { GoogleAuth } from './oauth.mjs';
import { DriveClient, DriveSync } from './drive.mjs';
import { Settings } from './settings.mjs';
import { SecretStore } from './secrets.mjs';
import { VERSION, sha256 } from './util.mjs';
import {
  normalizeAttachment,
  normalizeRecord,
  canonical,
  MAX_ASSET_BYTES,
} from '../extension/lib/model.js';
import { registerNative, setSchedule, launchUi, removeNativeRegistration } from './windows.mjs';

export class Service {
  constructor({
    settings = new Settings(),
    secrets,
    auth,
    drive,
    windows = { registerNative, setSchedule, launchUi, removeNativeRegistration },
  } = {}) {
    this.settings = settings;
    this.secrets = secrets || new SecretStore(settings.root);
    this.auth = auth || new GoogleAuth(this.secrets);
    this.client = drive;
    this.windows = windows;
    this.transfers = new Map();
    this.assetReads = new Map();
    this.queue = Promise.resolve();
  }
  async open() {
    const cfg = await this.settings.read();
    this.vault = await new Vault(cfg.vaultPath).open();
    this.client ??= new DriveClient(this.auth, { sessionStore: this.vault });
    this.sync = new DriveSync(this.vault, this.client);
    return this;
  }
  async close() {
    this.assetReads.clear();
    this.transfers.clear();
    this.auth.cancel?.();
    this.vault?.close();
  }
  async status() {
    const cfg = await this.settings.read();
    return {
      version: VERSION,
      vaultId: this.vault.info.id,
      vaultPath: this.vault.root,
      autoSync: cfg.autoSync,
      origins: cfg.allowedOrigins,
      google: await this.auth.status(),
      binding: this.vault.getState('drive:binding'),
      lastSync: this.vault.getState('drive:lastSync'),
      lastError: this.vault.getState('drive:lastError'),
      externalRecovery: this.vault.getState('external:recovery', []),
      pendingUploads: this.vault.db
        .prepare('SELECT count(DISTINCT record_id) AS count FROM revisions WHERE uploaded=0')
        .get().count,
      total: this.vault.db.prepare('SELECT count(*) AS count FROM catalog').get().count,
      conflicts: this.vault.db
        .prepare('SELECT count(*) AS count FROM catalog WHERE conflict=1')
        .get().count,
    };
  }
  async synchronize() {
    const file = path.join(this.settings.root, 'sync.lock');
    let lock;
    try {
      lock = await open(file, 'wx', 0o600);
      await lock.writeFile(String(process.pid));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(file, 'utf8').catch(() => ''));
      let alive = false;
      try {
        if (pid > 0) {
          process.kill(pid, 0);
          alive = true;
        }
      } catch {}
      if (alive) throw new Error('另一个本地进程正在同步，请稍后再试。');
      await unlink(file).catch(() => {});
      return this.synchronize();
    }
    try {
      const result = await this.sync.run();
      this.vault.setState('drive:lastError', null);
      return result;
    } catch (error) {
      this.vault.setState('drive:lastError', {
        at: new Date().toISOString(),
        message: error.message,
      });
      throw error;
    } finally {
      await lock.close();
      await unlink(file).catch(() => {});
    }
  }
  handle(command, payload = {}) {
    const task = this.queue.catch(() => {}).then(() => this.dispatch(command, payload));
    this.queue = task;
    return task;
  }
  async dispatch(command, payload) {
    if (
      typeof command !== 'string' ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    )
      throw new Error('Invalid companion request.');
    switch (command) {
      case 'status':
        return this.status();
      case 'records.list':
        return this.vault.list(payload);
      case 'records.get':
        return this.vault.get(payload.id);
      case 'records.put': {
        const record = normalizeRecord(payload.record);
        for (const descriptor of record.attachments || [])
          if (
            !(await this.vault.assetBytes(descriptor)) &&
            !this.vault.assetInfo(descriptor).remoteId
          )
            throw new Error('请先把附件交接到本地程序，再交接记录。');
        const current = this.vault.get(record.id);
        if (current?.hash === sha256(canonical(record)))
          return { ...current, acceptedRevision: current.revision };
        return this.vault.put(record, { parentRevision: payload.parentRevision ?? null });
      }
      case 'records.resolve':
        return this.vault.put(payload.record, { resolveParents: payload.parents });
      case 'records.trash': {
        const current = this.vault.get(payload.id);
        if (!current || current.revision !== payload.revision || current.heads.length !== 1)
          throw new Error('记录已变化，请重新打开。');
        return this.vault.put(
          {
            ...current.record,
            deleted_at: payload.restore ? null : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { parentRevision: current.revision },
        );
      }
      case 'records.conflicts': {
        const current = this.vault.get(payload.id);
        if (!current) return [];
        return current.heads.map((rev) => this.vault.envelope(rev));
      }
      case 'records.changes':
        return this.vault.changes(payload.cursor ?? 0, payload.limit ?? 50);
      case 'records.import-external':
        return { imported: await this.vault.externalEdits() };
      case 'assets.has': {
        const cached = !!(await this.vault.assetBytes(payload.descriptor));
        return { cached, available: cached || !!this.vault.assetInfo(payload.descriptor).remoteId };
      }
      case 'assets.begin': {
        const descriptor = normalizeAttachment(payload.descriptor);
        for (const [id, item] of this.transfers)
          if (Date.now() - item.at > 300000) this.transfers.delete(id);
        if (this.transfers.size >= 2) throw new Error('Too many attachment transfers.');
        const id = randomUUID();
        this.transfers.set(id, { descriptor, chunks: [], size: 0, at: Date.now() });
        return { transferId: id };
      }
      case 'assets.chunk': {
        const transfer = this.transfers.get(payload.transferId);
        if (
          !transfer ||
          typeof payload.data !== 'string' ||
          payload.data.length > 350000 ||
          payload.offset !== transfer.size ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.data)
        )
          throw new Error('Invalid attachment transfer.');
        const bytes = Buffer.from(payload.data, 'base64');
        if (
          transfer.size + bytes.length > transfer.descriptor.size_bytes ||
          transfer.size + bytes.length > MAX_ASSET_BYTES
        )
          throw new Error('Attachment is too large.');
        transfer.chunks.push(bytes);
        transfer.size += bytes.length;
        transfer.at = Date.now();
        return { offset: transfer.size };
      }
      case 'assets.finish': {
        const transfer = this.transfers.get(payload.transferId);
        if (!transfer) throw new Error('Unknown transfer.');
        try {
          await this.vault.storeAsset(transfer.descriptor, Buffer.concat(transfer.chunks));
          return { saved: true };
        } finally {
          this.transfers.delete(payload.transferId);
        }
      }
      case 'assets.read': {
        const descriptor = normalizeAttachment(payload.descriptor);
        if (
          !Number.isSafeInteger(payload.offset) ||
          payload.offset < 0 ||
          payload.offset > descriptor.size_bytes
        )
          throw new Error('Invalid attachment offset.');
        for (const [id, cached] of this.assetReads)
          if (Date.now() - cached.at > 300000) this.assetReads.delete(id);
        let cached = this.assetReads.get(descriptor.id);
        if (!cached) {
          if (this.assetReads.size >= 2)
            this.assetReads.delete(this.assetReads.keys().next().value);
          cached = { bytes: await this.sync.asset(descriptor), at: Date.now() };
          this.assetReads.set(descriptor.id, cached);
        }
        const bytes = cached.bytes,
          end = Math.min(bytes.length, payload.offset + 192 * 1024);
        if (end === bytes.length) this.assetReads.delete(descriptor.id);
        return {
          data: bytes.subarray(payload.offset, end).toString('base64'),
          offset: end,
          done: end === bytes.length,
        };
      }
      case 'drive.sync':
        return this.synchronize();
      case 'drive.folders':
        return this.client.folders();
      case 'drive.create': {
        if (this.vault.getState('drive:binding'))
          throw new Error(
            '此本地资料库已绑定远程资料库。请在设置中选择新的本地资料库，再创建云端资料库。',
          );
        const folder = await this.client.createFolder(payload.name);
        return this.sync.bind(folder.id);
      }
      case 'drive.bind':
        return this.sync.bind(payload.id);
      case 'google.configure':
        if ((await this.settings.read()).autoSync)
          await this.windows.setSchedule(this.settings, false);
        return this.auth.configure(payload.client);
      case 'google.connect':
        if ((await this.settings.read()).autoSync)
          await this.windows.setSchedule(this.settings, false);
        return this.auth.begin();
      case 'google.disconnect':
        if ((await this.settings.read()).autoSync)
          await this.windows.setSchedule(this.settings, false);
        await this.auth.disconnect();
        return { disconnected: true };
      case 'schedule.set': {
        if (typeof payload.enabled !== 'boolean') throw new Error('Invalid schedule value.');
        if (
          payload.enabled &&
          (!(await this.auth.status()).connected || !this.vault.getState('drive:binding'))
        )
          throw new Error('先授权 Google Drive 并选择资料库，再开启每小时同步。');
        return this.windows.setSchedule(this.settings, payload.enabled);
      }
      case 'native.register':
        return this.windows.registerNative(this.settings, payload.extensionId);
      case 'system.disconnect':
        await this.windows.setSchedule(this.settings, false);
        await this.windows.removeNativeRegistration(this.settings);
        return { disconnected: true };
      case 'ui.open':
        return this.windows.launchUi();
      case 'vault.select': {
        if (
          typeof payload.path !== 'string' ||
          !path.isAbsolute(payload.path) ||
          payload.path.length > 2000
        )
          throw new Error('请输入本地资料库的完整路径。');
        if ((await this.settings.read()).autoSync)
          throw new Error('请先关闭自动同步，再切换本地资料库。');
        const next = await new Vault(payload.path).open();
        await this.settings.update({ vaultPath: next.root });
        this.vault.close();
        this.vault = next;
        this.client.sessionStore = next;
        this.sync = new DriveSync(next, this.client);
        return this.status();
      }
      default:
        throw new Error('Unsupported companion command.');
    }
  }
}

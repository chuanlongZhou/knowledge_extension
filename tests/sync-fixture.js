import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Service } from '../companion/service.mjs';
import { Settings } from '../companion/settings.mjs';
import { DriveClient } from '../companion/drive.mjs';
import { synchronizeCompanion, downloadCompanionAsset } from '../extension/lib/companion.js';
import { MockDrive } from './mock-drive.js';

// Exercise browser IndexedDB -> Companion -> Drive HTTP protocol -> a second
// independent Companion and IndexedDB. Only Google's HTTP endpoint is simulated.
export class SyncHarness {
  constructor(t) {
    this.remote = new MockDrive();
    this.devices = new Map();
    this.root = (async () => {
      const output = path.resolve('test-results');
      await mkdir(output, { recursive: true });
      return mkdtemp(path.join(output, 'sync-e2e-'));
    })();
    t.after(async () => {
      for (const item of this.devices.values()) await (await item).service.close();
      const root = await this.root;
      if (!root.startsWith(path.resolve('test-results') + path.sep))
        throw new Error('Unsafe cleanup');
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    });
  }
  async device(db) {
    const deviceIndex = this.devices.size;
    if (!this.devices.has(db))
      this.devices.set(
        db,
        (async () => {
          const settings = new Settings(path.join(await this.root, `device-${deviceIndex}`));
          const auth = {
            token: async () => 'fake-drive-token',
            status: async () => ({ configured: true, connected: true }),
            cancel() {},
          };
          const drive = new DriveClient(auth, {
            fetchImpl: this.remote.fetch.bind(this.remote),
            sleep: async () => {},
          });
          const service = await new Service({ settings, auth, drive }).open();
          drive.sessionStore = service.vault;
          this.folder ??= drive.createFolder('Integration test');
          await service.sync.bind((await this.folder).id);
          return {
            service,
            client: { call: (command, payload) => service.handle(command, payload), close() {} },
          };
        })(),
      );
    return this.devices.get(db);
  }
  async sync(db, options = {}) {
    const { client } = await this.device(db);
    const result = await synchronizeCompanion(db, {
      client,
      locks: null,
      remote: true,
      ...options,
    });
    if (result.driveError) throw new Error(result.driveError);
    return { ...result, status: result.conflicts ? 'conflicts' : 'done' };
  }
  async asset(db, descriptor) {
    return downloadCompanionAsset(db, descriptor, (await this.device(db)).client);
  }
  async versions(db, id) {
    return (await this.device(db)).service.handle('records.conflicts', { id });
  }
  async resolve(db, record) {
    const { service } = await this.device(db);
    const parents = service.vault.get(record.id).heads;
    await service.handle('records.resolve', { record, parents });
    await this.sync(db, { pullOnly: true });
  }
}

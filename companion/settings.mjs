import path from 'node:path';
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
import { atomicWrite, readJson } from './util.mjs';
export function profileHome() {
  return (
    process.env.PKM_NEXUS_HOME || path.join(process.env.LOCALAPPDATA || os.homedir(), 'PKM Nexus')
  );
}
export class Settings {
  constructor(root = profileHome()) {
    this.root = path.resolve(root);
    this.file = path.join(this.root, 'settings.json');
  }
  async read() {
    return {
      vaultPath: path.join(this.root, 'Knowledge'),
      autoSync: false,
      allowedOrigins: [],
      ...(await readJson(this.file, {})),
    };
  }
  async update(patch) {
    const current = await this.read(),
      next = { ...current, ...patch };
    await mkdir(this.root, { recursive: true });
    await atomicWrite(this.file, JSON.stringify(next, null, 2));
    return next;
  }
}

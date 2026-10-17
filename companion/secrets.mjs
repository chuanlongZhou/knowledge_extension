import path from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { atomicWrite } from './util.mjs';
import { platformCall } from './platform.mjs';
function dpapi(input, decrypt = false) {
  return decrypt
    ? platformCall('unprotect', { data: input }).text
    : platformCall('protect', { text: input }).data;
}
export class SecretStore {
  constructor(root) {
    this.file = path.join(root, 'credentials.dpapi');
  }
  async read() {
    try {
      const encrypted = await readFile(this.file, 'utf8');
      if (this.cached?.encrypted === encrypted) return structuredClone(this.cached.value);
      const value = JSON.parse(dpapi(encrypted, true));
      this.cached = { encrypted, value };
      return structuredClone(value);
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
  async write(value) {
    const encrypted = dpapi(JSON.stringify(value));
    await atomicWrite(this.file, encrypted);
    this.cached = { encrypted, value: structuredClone(value) };
  }
  async clear() {
    this.cached = null;
    await unlink(this.file).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

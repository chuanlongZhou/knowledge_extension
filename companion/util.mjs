import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, readFile, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
export const VERSION = '0.4.1';
export const HOST_NAME = 'com.pkm_nexus.companion';
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function inside(root, ...parts) {
  const target = path.resolve(root, ...parts);
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep))
    throw new Error('Path is outside the knowledge vault.');
  return target;
}
export async function atomicWrite(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`,
    handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}
export async function assertNoSymlink(root, target) {
  const resolved = inside(root, path.relative(root, target));
  let current = path.resolve(root);
  for (const part of ['', ...path.relative(root, resolved).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Symbolic links and junctions are not allowed inside the vault.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return resolved;
}
export function requireString(value, name, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Invalid ${name}.`);
  return value.trim();
}

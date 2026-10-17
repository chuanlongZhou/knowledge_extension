import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './util.mjs';

const operations = new Set([
  'protect',
  'unprotect',
  'native.register',
  'native.remove',
  'schedule.set',
  'schedule.get',
  'browser.open',
  'ui.open',
]);
export function applicationDirectory() {
  return process.env.PKM_NEXUS_APP_DIR
    ? path.resolve(process.env.PKM_NEXUS_APP_DIR)
    : fileURLToPath(new URL(`../dist/PKM-Nexus-Companion-${VERSION}-candidate/`, import.meta.url));
}
export function platformCall(command, payload = {}) {
  if (process.platform !== 'win32') throw new Error('This companion requires Windows.');
  if (!operations.has(command)) throw new Error('Unsupported Windows operation.');
  const result = spawnSync(path.join(applicationDirectory(), 'PKM-Nexus-Platform.exe'), [], {
    input: JSON.stringify({ command, payload }),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30000,
  });
  if (result.error || !result.stdout)
    throw new Error('Windows 配套组件不可用。请使用完整应用文件夹。');
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw new Error('Windows 配套组件返回了无效响应。');
  }
  if (result.status !== 0 || !response.ok)
    throw new Error((response.error || 'Windows 操作失败。') + (response.code ? ` (${response.errorType}: ${response.code})` : ''));
  return response.result;
}

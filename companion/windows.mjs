import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HOST_NAME, atomicWrite } from './util.mjs';
import { platformCall, applicationDirectory } from './platform.mjs';

export function desktopExecutable() {
  return path.join(applicationDirectory(), 'PKM-Nexus.exe');
}
export function openBrowser(url) {
  return platformCall('browser.open', { url });
}
export async function registerNative(settings, extensionId) {
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId))
    throw new Error('请输入 chrome://extensions 中显示的 32 位扩展 ID。');
  const current = await settings.read();
  const allowed = [...new Set([...current.allowedOrigins, `chrome-extension://${extensionId}/`])];
  if (
    allowed.some((origin) => !/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin)) ||
    allowed.length > 32
  )
    throw new Error('扩展连接配置无效。');
  const manifest = {
    name: HOST_NAME,
    description: 'PKM Nexus local knowledge companion',
    path: path.join(applicationDirectory(), 'PKM-Nexus-NativeHost.exe'),
    type: 'stdio',
    allowed_origins: allowed,
  };
  const file = path.join(settings.root, 'native-host.json');
  await atomicWrite(file, JSON.stringify(manifest, null, 2));
  platformCall('native.register', { manifest: file });
  await settings.update({ allowedOrigins: allowed });
  return { registered: true, extensionId };
}
export async function setSchedule(settings, enabled, { taskName = 'PKM Nexus Hourly Sync' } = {}) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid schedule value.');
  const result = platformCall('schedule.set', { enabled, taskName });
  await settings.update({ autoSync: enabled });
  return result;
}
export async function launchUi() {
  return platformCall('ui.open');
}
export async function resource(name) {
  if (!['index.html', 'app.js', 'styles.css'].includes(name))
    throw new Error('Unknown UI resource.');
  return readFile(new URL(`./ui/${name}`, import.meta.url));
}
export async function removeNativeRegistration(settings) {
  const file = path.join(settings.root, 'native-host.json');
  platformCall('native.remove', { manifest: file });
  await unlink(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await settings.update({ allowedOrigins: [] });
}

import { Settings } from './settings.mjs';
import { Service } from './service.mjs';
import { nativeHost } from './native.mjs';
import { managementServer } from './server.mjs';
import { openBrowser, launchUi } from './windows.mjs';
import { readFile } from 'node:fs/promises';
import { applicationDirectory } from './platform.mjs';
import path from 'node:path';
import { VERSION } from './util.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--licenses')) {
    process.stdout.write(
      await readFile(path.join(applicationDirectory(), 'NODE-LICENSE.txt'), 'utf8'),
    );
    return;
  }
  if (args.includes('--version')) {
    process.stdout.write(`PKM Nexus Companion ${VERSION}\n`);
    return;
  }
  const settings = new Settings();
  if (
    process.env.PKM_NEXUS_APP_DIR &&
    !args.includes('--serve') &&
    !args.includes('--sync') &&
    !args.includes('--reindex') &&
    !args.some((arg) => arg.startsWith('chrome-extension://'))
  ) {
    await launchUi();
    return;
  }
  const service = await new Service({ settings }).open();
  try {
    if (args.some((arg) => arg.startsWith('chrome-extension://'))) {
      await nativeHost(service);
      return;
    }
    if (args.includes('--sync')) {
      if (args.includes('--scheduled') && !(await settings.read()).autoSync) return;
      if (!(await service.auth.status()).connected) {
        if (args.includes('--scheduled')) return;
        throw new Error('Google Drive 尚未授权。请打开本地管理界面完成配置。');
      }
      const result = await service.synchronize();
      if (!args.includes('--scheduled')) process.stdout.write(JSON.stringify(result) + '\n');
      return;
    }
    if (args.includes('--reindex')) {
      await service.vault.reindex();
      process.stdout.write('Local index rebuilt.\n');
      return;
    }
    const ui = await managementServer(service);
    if (args.includes('--serve')) process.stdout.write(JSON.stringify({ url: ui.url }) + '\n');
    else if (process.platform === 'win32') openBrowser(ui.url);
    else process.stdout.write(ui.url + '\n');
    let stopping = false;
    let parentCheck;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(parentCheck);
      await ui.close();
      await service.close();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const parent = Number(process.env.PKM_NEXUS_DESKTOP_PARENT);
    if (
      args.includes('--serve') &&
      Number.isSafeInteger(parent) &&
      parent > 0 &&
      process.ppid === parent
    ) {
      parentCheck = setInterval(() => {
        try {
          process.kill(parent, 0);
        } catch {
          void stop();
        }
      }, 2000);
      parentCheck.unref();
    }
    await new Promise(() => {});
  } finally {
    await service.close();
  }
}
main().catch((error) => {
  process.stderr.write(`PKM Nexus: ${error.message}\n`);
  process.exitCode = 1;
});

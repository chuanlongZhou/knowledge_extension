import { GoogleDrive } from './drive-client.js';
import { bindFolder, syncDrive, resolveDriveConflict } from './drive-sync.js';
export async function handleDriveCommand(db, message) {
  const drive = new GoogleDrive();
  if (message.command === 'sync') return syncDrive(db, message.direction, { drive });
  const run = async () => {
    if (message.command === 'resolve') return resolveDriveConflict(db, message.id, message.choice);
    if (message.command === 'logout') {
      await drive.logout();
      await chrome.storage.local.remove('driveAccount');
      return { loggedOut: true };
    }
    const account = await drive.authorize(message.command === 'login');
    const binding = await db.getState('drive:binding');
    if (binding && binding.accountId !== account.id) {
      await chrome.storage.local.remove('driveAccount');
      throw new Error(
        '请登录此浏览器原先绑定的 Google 账号，或在新的 Chrome 配置中使用另一个账号。',
      );
    }
    await chrome.storage.local.set({ driveAccount: account });
    switch (message.command) {
      case 'login':
        return account;
      case 'folders':
        return drive.folders();
      case 'create-folder': {
        if (binding) throw new Error('此浏览器已选择数据文件夹。');
        const folder = await drive.createFolder(message.name || '');
        return bindFolder(db, account, folder);
      }
      case 'select-folder':
        return bindFolder(db, account, await drive.folder(message.folderId));
      default:
        throw new Error('不支持的 Google Drive 操作。');
    }
  };
  return navigator.locks.request('pkm-direct-drive', { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error('另一个窗口正在操作 Google Drive，请稍后重试。');
    return run();
  });
}

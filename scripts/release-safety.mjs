import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { VERSION } from '../companion/util.mjs';

export async function assertCompanionReleaseEnabled(root, version = VERSION) {
  let hold;
  try {
    hold = JSON.parse(await readFile(path.join(root, 'COMPANION-RELEASE-HOLD.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (hold.blocked || hold.blockedVersions?.includes(version))
    throw new Error(`本地应用 ${version} 已停用，不能重新分发。请使用经过检查的修复版本。`);
  if (hold.approvedVersion && hold.approvedVersion !== version)
    throw new Error('此版本尚未完成发行检查。');
}

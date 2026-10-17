import { readConfig } from './config.js';
import { downloadCompanionAsset } from './companion.js';
export async function loadAsset(db, descriptor) {
  const asset = await db.getAsset(descriptor.id);
  if (asset?.blob) return asset.blob;
  const settings = await readConfig();
  if (settings.companionEnabled) return downloadCompanionAsset(db, descriptor);
  throw new Error('附件尚未保存在浏览器中，请连接本地资料库后加载，或导入完整 ZIP。');
}

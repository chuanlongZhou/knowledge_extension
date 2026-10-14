import {GitHub} from './github.js';
import {readConfig} from './config.js';
export async function loadAsset(db,descriptor) {
  const asset=await db.getAsset(descriptor.id);if(asset?.blob)return asset.blob;
  const settings=await readConfig();if(!settings.token)throw new Error('附件尚未保存在本机，请配置 GitHub Token 后点击加载，或导入完整 ZIP。');
  const api=new GitHub(settings.config,settings.token);const connected=await api.connect();await db.assertRepo(connected.repoKey);
  const blob=await api.readAsset(descriptor,asset?.remote_commit||await db.getState('lastSyncCommit')||connected.branch);await db.putAsset(descriptor,blob,asset?.remote_commit);return blob;
}

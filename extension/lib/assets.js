export async function loadAsset(db, descriptor) {
  const asset = await db.getAsset(descriptor.id);
  if (asset?.blob) return asset.blob;
  throw new Error('附件尚未下载，请先同步下载 Google Drive 数据，或导入完整 ZIP 备份。');
}

import { canonical, normalizeAttachment, digestBytes, MIME_EXT } from './model.js';
import { writeZip, readZip, MAX_ZIP_BYTES } from './zip.js';
import { loadAsset } from './assets.js';
import { readableExport, EXPORT_GROUPS } from './export-layout.js';
function descriptorsOf(backup) {
  const records = [
    ...backup.records.map((i) => i.record),
    ...backup.pending_captures.map((i) => i.record),
    ...(backup.drafts || []).map(
      (d) => d.value.record || { attachments: d.value.attachments || [] },
    ),
  ];
  return new Map(
    [...(backup.asset_catalog || []), ...records.flatMap((r) => r.attachments || [])].map((a) => [
      a.id,
      normalizeAttachment(a),
    ]),
  );
}
export async function buildMarkdownExport(
  db,
  {
    resolveAsset = (descriptor) => loadAsset(db, descriptor),
    progress = () => {},
    groupBy = 'project',
  } = {},
) {
  const backup = await db.exportData(),
    { records } = backup;
  const { files } = readableExport(backup, groupBy);
  const assets = new Map();
  for (const { record } of records) {
    if (record.kind === 'tombstone') continue;
    for (const attachment of record.attachments) {
      const descriptor = normalizeAttachment(attachment);
      assets.set(descriptor.id, descriptor);
    }
  }
  for (const descriptor of assets.values()) {
    progress(`正在打包附件：${descriptor.name}`);
    const blob = await resolveAsset(descriptor);
    if (
      blob.size !== descriptor.size_bytes ||
      (await digestBytes(await blob.arrayBuffer())) !== descriptor.id
    )
      throw new Error(`附件 ${descriptor.name} 校验失败，未生成不完整 Markdown 包。`);
    files.set(descriptor.path, blob);
  }
  files.set(
    'README.txt',
    `GUGA Knowledge Markdown 导出 · ${EXPORT_GROUPS[groupBy]}\n打开 notes 中以原名称命名的 .md 文件；多项目 / 多标签的记录在各目录提供阅读副本，附件在 assets 只保存一份。export-index.json 对应记录 ID 与阅读路径。\n请保持目录结构与相对位置。在线引用的图片需要联网且原站允许访问。\n本包用于阅读；完整恢复请使用“完整 ZIP”。\n`,
  );
  return writeZip(files);
}
export async function buildLocalBackup(
  db,
  {
    resolveAsset = (descriptor) => loadAsset(db, descriptor),
    progress = () => {},
    groupBy = 'project',
  } = {},
) {
  const backup = await db.exportData(),
    { files } = readableExport(backup, groupBy);
  for (const { record } of backup.records) {
    files.set(`records/${record.id}.json`, canonical(record));
  }
  files.set('backup.json', JSON.stringify(backup, null, 2));
  for (const descriptor of descriptorsOf(backup).values()) {
    progress(`正在打包附件：${descriptor.name}`);
    const blob = await resolveAsset(descriptor);
    if (
      blob.size !== descriptor.size_bytes ||
      (await digestBytes(await blob.arrayBuffer())) !== descriptor.id
    )
      throw new Error(`附件 ${descriptor.name} 校验失败，未生成不完整备份。`);
    files.set(descriptor.path, blob);
  }
  const recordings = [];
  for (const session of await db.recordings()) {
    if (!session.chunks) continue;
    const { blob, recording } = await db.recordingBlob(session.id);
    const path = `recovery/${session.id}.${MIME_EXT[session.mime_type.split(';')[0]] || 'webm'}`;
    files.set(path, blob);
    recordings.push({ ...recording, path });
  }
  if (recordings.length) files.set('recovery/recordings.json', JSON.stringify(recordings));
  files.set(
    'README.txt',
    `GUGA Knowledge 完整本地备份 · ${EXPORT_GROUPS[groupBy]}\nbackup.json 用于恢复数据；records 保存唯一记录，assets 保存原始附件。\nnotes 以原名称提供 Markdown，按选择的项目 / 标签目录整理；同一记录在多个分类中提供阅读副本，恢复时不会重复导入。图片和音频使用相对路径，请保持解压后的目录结构。export-index.json 对应 ID 与 Markdown 路径。\n文件名中的特殊字符会替换，重名添加短 ID；过长项目层级收拢到项目根目录，完整层级保存在备份数据中。\n本包不包含 Google 授权凭证。\nrecovery（如有）保存尚未完成的录音，解压后可通过添加音频恢复。\n`,
  );
  progress('正在生成 ZIP…');
  return writeZip(files);
}
export async function previewZipImport(db, blob) {
  // The aggregate manifest can be larger than any individual record or asset.
  const files = await readZip(blob, { entryLimits: { 'backup.json': MAX_ZIP_BYTES } });
  if (!files.has('backup.json'))
    throw new Error('ZIP 缺少 backup.json，请选择本插件生成的完整备份。');
  const backup = JSON.parse(new TextDecoder().decode(files.get('backup.json'))),
    plan = await db.previewImport(backup);
  plan.assets = [];
  for (const descriptor of descriptorsOf(backup).values()) {
    const bytes = files.get(descriptor.path);
    if (
      !bytes ||
      bytes.byteLength !== descriptor.size_bytes ||
      (await digestBytes(bytes)) !== descriptor.sha256
    )
      throw new Error(`附件 ${descriptor.name} 缺失或校验失败，未进行导入。`);
    plan.assets.push({
      id: descriptor.id,
      descriptor,
      blob: new Blob([bytes], { type: descriptor.mime_type }),
    });
  }
  return plan;
}

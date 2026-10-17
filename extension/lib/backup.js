import { canonical, toMarkdown, normalizeAttachment, digestBytes, MIME_EXT } from './model.js';
import { writeZip, readZip } from './zip.js';
import { loadAsset } from './assets.js';
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
  { resolveAsset = (descriptor) => loadAsset(db, descriptor), progress = () => {} } = {},
) {
  const { records } = await db.exportData();
  const files = new Map();
  const assets = new Map();
  for (const { record } of records) {
    if (record.kind === 'tombstone') continue;
    files.set(`notes/${record.id}.md`, toMarkdown(record).replaceAll('](assets/', '](../assets/'));
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
    '打开 notes 目录中的 .md 文件；图片和音频位于相邻的 assets 目录。请保持两个目录的相对位置。在线引用的图片需要联网且原站允许访问。\n',
  );
  return writeZip(files);
}
export async function buildLocalBackup(
  db,
  { resolveAsset = (descriptor) => loadAsset(db, descriptor), progress = () => {} } = {},
) {
  const backup = await db.exportData(),
    files = new Map();
  for (const { record } of backup.records) {
    files.set(`records/${record.id}.json`, canonical(record));
    if (record.kind !== 'tombstone')
      files.set(
        `notes/${record.id}.md`,
        toMarkdown(record).replaceAll('](assets/', '](../assets/'),
      );
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
    'PKM Nexus 完整本地备份\nbackup.json 用于恢复数据；records 保存记录，assets 保存原始附件。\nnotes 提供可阅读的 Markdown，引用 ../assets 中的图片和音频。\n本包不包含 Google 授权凭证。\nrecovery（如有）保存尚未完成的录音，解压后可通过添加音频恢复。\n本地资料库中的冲突版本由配套程序保留和处理。\n',
  );
  progress('正在生成 ZIP…');
  return writeZip(files);
}
export async function previewZipImport(db, blob) {
  const files = await readZip(blob);
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

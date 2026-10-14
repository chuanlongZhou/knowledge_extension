import {canonical,digest,indexEntry,recordPath,toMarkdown,normalizeAttachment,digestBytes,MIME_EXT} from './model.js';
import {writeZip,readZip} from './zip.js';
import {loadAsset} from './assets.js';
function descriptorsOf(backup){const records=[...backup.records.map(i=>i.record),...backup.pending_captures.map(i=>i.record),...(backup.drafts||[]).map(d=>d.value.record||{attachments:d.value.attachments||[]})];return new Map([...(backup.asset_catalog||[]),...records.flatMap(r=>r.attachments||[])].map(a=>[a.id,normalizeAttachment(a)]));}
export async function buildLocalBackup(db,{resolveAsset=descriptor=>loadAsset(db,descriptor),progress=()=>{}}={}) {
  const backup=await db.exportData(),files=new Map(),entries=[];
  for(const {record} of backup.records){files.set(recordPath(record),canonical(record));entries.push(indexEntry(record,await digest(record)));if(record.kind!=='tombstone')files.set(`notes/${record.id}.md`,toMarkdown(record).replaceAll('](assets/','](../assets/'));}
  files.set('backup.json',JSON.stringify(backup,null,2));files.set('index/global_index.json',canonical({format:'pkm-nexus-index',schema_version:4,entries:entries.sort((a,b)=>a.id.localeCompare(b.id))}));
  for(const conflict of await db.conflicts())files.set(`recovery/conflicts/${conflict.id}.json`,JSON.stringify({id:conflict.id,local_record:backup.records.find(item=>item.record.id===conflict.id)?.record,remote_record:conflict.remoteRecord},null,2));
  for(const descriptor of descriptorsOf(backup).values()){progress(`正在打包附件：${descriptor.name}`);const blob=await resolveAsset(descriptor);if(blob.size!==descriptor.size_bytes||await digestBytes(await blob.arrayBuffer())!==descriptor.id)throw new Error(`附件 ${descriptor.name} 校验失败，未生成不完整备份。`);files.set(descriptor.path,blob);}
  const recordings=[];for(const session of await db.recordings()){if(!session.chunks)continue;const {blob,recording}=await db.recordingBlob(session.id);const path=`recovery/${session.id}.${MIME_EXT[session.mime_type.split(';')[0]]||'webm'}`;files.set(path,blob);recordings.push({...recording,path});}if(recordings.length)files.set('recovery/recordings.json',JSON.stringify(recordings));
  files.set('README.txt','PKM Nexus 完整本地备份\nbackup.json 用于恢复数据；data、assets、tombstones、index 对应仓库数据。\nnotes 提供可阅读的 Markdown，引用 ../assets 中的图片和音频。\n本包不包含 GitHub Token。\nrecovery（如有）保存尚未完成的录音，解压后可通过添加音频恢复。\nrecovery/conflicts 保存待解决冲突的双方快照，导入采用主数据版本；冲突快照供人工核对，不直接覆盖记录。\n');
  progress('正在生成 ZIP…');return writeZip(files);
}
export async function previewZipImport(db,blob) {
  const files=await readZip(blob);if(!files.has('backup.json'))throw new Error('ZIP 缺少 backup.json，请选择本插件生成的完整备份。');
  const backup=JSON.parse(new TextDecoder().decode(files.get('backup.json'))),plan=await db.previewImport(backup);plan.assets=[];
  for(const descriptor of descriptorsOf(backup).values()){const bytes=files.get(descriptor.path);if(!bytes||bytes.byteLength!==descriptor.size_bytes||await digestBytes(bytes)!==descriptor.sha256)throw new Error(`附件 ${descriptor.name} 缺失或校验失败，未进行导入。`);plan.assets.push({id:descriptor.id,descriptor,blob:new Blob([bytes],{type:descriptor.mime_type}),remote_commit:null});}
  return plan;
}

import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Database} from '../extension/lib/db.js';
import {newRecord,normalizeRecord,digest,digestBytes,recordPath} from '../extension/lib/model.js';
import {GitHub} from '../extension/lib/github.js';
import {synchronize} from '../extension/lib/sync.js';
import {buildLocalBackup,previewZipImport} from '../extension/lib/backup.js';
import {readZip,writeZip} from '../extension/lib/zip.js';
import {MockGitHub} from './mock-github.js';
const imageBytes=await readFile(new URL('../extension/icons/penguin.png',import.meta.url));
function database(t){const db=new Database(`media-${crypto.randomUUID()}`,{broadcast:false});t.after(()=>db.close());return db;}
const api=repo=>new GitHub({owner:'test-owner',repo:'knowledge'},'fake-token-only-for-tests',{fetchImpl:repo.fetch.bind(repo)});
const sync=(db,repo)=>synchronize(db,api(repo));
const attach=async db=>db.storeAsset(new Blob([imageBytes],{type:'image/png'}),'企鹅.png');
test('all v4 record types use the same fields and changing type preserves the ID',async t=>{
 const db=database(t),record=newRecord({type:'note',title:'统一记录'});await db.save(record);const initial=await db.get(record.id);
 await db.save({...initial.record,type:'website_group'},{expectedRev:initial.rev});const changed=await db.get(record.id);assert.equal(changed.id,record.id);assert.equal(changed.record.created_at,record.created_at);
 assert.deepEqual(Object.keys(newRecord({type:'snapshot'})).sort(),Object.keys(newRecord({type:'list'})).sort());assert.deepEqual(Object.keys(newRecord({type:'website_group'})).sort(),Object.keys(record).sort());
});
test('attachment bytes are content-addressed; JSON stores metadata and Markdown paths, not Base64',async t=>{
 const db=database(t),image=await attach(db);assert.equal(image.id,await digestBytes(imageBytes));assert.equal(image.size_bytes,imageBytes.length);assert.equal(image.path,`assets/${image.id}.png`);
 const record=newRecord({content:`![企鹅](${image.path})`,attachments:[image]});await db.save(record);assert.equal((await db.get(record.id)).record.attachments[0].kind,'image');assert.ok(!JSON.stringify(record).includes(imageBytes.toString('base64')));
});
test('binary attachments and record metadata commit together; another computer lazily loads binary bytes',async t=>{
 const a=database(t),b=database(t),repo=new MockGitHub(),image=await attach(a),record=newRecord({title:'图片记录',content:`![企鹅](${image.path})`,attachments:[image]});await a.save(record);await sync(a,repo);
 assert.deepEqual(repo.blobs.get(repo.files().get(image.path)),imageBytes);assert.equal(repo.json(recordPath(record)).attachments[0].id,image.id);
 await sync(b,repo);assert.equal((await b.getAsset(image.id)).blob,undefined);assert.equal(repo.calls.filter(c=>c.method==='GET'&&c.path.includes(image.path)).length,0);
 const blob=await api(repo).readAsset(image,(await b.getAsset(image.id)).remote_commit);await b.putAsset(image,blob);assert.equal(await digestBytes(await blob.arrayBuffer()),image.id);
});
test('shared attachment survives until the last referencing record is purged',async t=>{
 const db=database(t),repo=new MockGitHub(),image=await attach(db),one=newRecord({title:'一',attachments:[image]}),two=newRecord({title:'二',attachments:[image]});await db.save(one);await db.save(two);await sync(db,repo);
 await db.trash(one.id);await db.purge(one.id);await sync(db,repo);assert.ok(repo.files().has(image.path));await db.trash(two.id);await db.purge(two.id);await sync(db,repo);assert.ok(!repo.files().has(image.path));
});
test('full local ZIP contains repository data, binary images and readable Markdown, and restores everything offline',async t=>{
 const a=database(t),b=database(t),image=await attach(a),record=newRecord({title:'ZIP roundtrip',content:`![企鹅](${image.path})`,attachments:[image]});await a.save(record);const zip=await buildLocalBackup(a,{resolveAsset:async d=>(await a.getAsset(d.id)).blob});const files=await readZip(zip);
 assert.ok(files.has('backup.json'));assert.ok(files.has(recordPath(record)));assert.ok(files.has('index/global_index.json'));assert.deepEqual(Buffer.from(files.get(image.path)),imageBytes);assert.match(new TextDecoder().decode(files.get(`notes/${record.id}.md`)),/\.\.\/assets\//);
 await b.applyImport(await previewZipImport(b,zip));assert.equal((await b.get(record.id)).record.attachments[0].id,image.id);assert.equal(await digestBytes(await(await b.getAsset(image.id)).blob.arrayBuffer()),image.id);
 await b.applyImport(await previewZipImport(b,zip));assert.equal((await b.allRows()).length,1);
});
test('corrupted or missing ZIP attachment aborts before any import write',async t=>{
 const a=database(t),b=database(t),image=await attach(a),record=newRecord({attachments:[image]});await a.save(record);const files=await readZip(await buildLocalBackup(a,{resolveAsset:async d=>(await a.getAsset(d.id)).blob}));files.delete(image.path);await assert.rejects(previewZipImport(b,await writeZip(files)),/缺失/);assert.equal((await b.allRows()).length,0);
 files.set(image.path,new Uint8Array([1,2,3]));await assert.rejects(previewZipImport(b,await writeZip(files)),/校验/);
});
test('recording chunks persist independently and can be recovered after reopening',async t=>{
 const db=database(t),session=await db.startRecording('audio/webm;codecs=opus');await db.appendRecording(session.id,new Blob(['first']));await db.appendRecording(session.id,new Blob(['second']));const other=new Database(db.name,{broadcast:false});t.after(()=>other.close());
 const {blob}=await other.recordingBlob(session.id);assert.equal(await blob.text(),'firstsecond');const descriptor=await other.finishRecording(session.id);assert.equal(descriptor.kind,'audio');assert.equal(descriptor.mime_type,'audio/webm');assert.ok(descriptor.duration_ms>=0);assert.equal((await other.recordings()).length,1);await other.removeRecording(session.id);assert.equal((await other.recordings()).length,0);
});
test('legacy record hash remains stable on read; editing upgrades schema without changing identity',async t=>{
 const db=database(t),modern=newRecord({title:'旧记录'}),legacy=normalizeRecord({...modern,schema_version:1});await db.save(legacy);const old=await db.get(legacy.id);assert.equal(old.hash,await digest(legacy));assert.equal(normalizeRecord(legacy).schema_version,1);
 await db.save({...legacy,schema_version:2,content:'新的内容',attachments:[]},{expectedRev:old.rev});assert.equal((await db.get(legacy.id)).record.schema_version,2);assert.equal((await db.allRows()).length,1);
});

test('installed v1 database upgrades in place and promotes local-only records without changing their hashes',async t=>{
 const name=`upgrade-${crypto.randomUUID()}`,record=normalizeRecord({...newRecord({title:'升级前的随手记'}),schema_version:1}),hash=await digest(record);
 const old=await new Promise((resolve,reject)=>{const req=indexedDB.open(name,2);req.onupgradeneeded=()=>{for(const [store,keyPath] of [['records','id'],['catalog','id'],['search','id'],['state','key'],['captures','id'],['conflicts','id'],['staging','id']])req.result.createObjectStore(store,{keyPath});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 const row={id:record.id,record,hash,baseHash:null,rev:4,scope:'local',dirty:false};
 await new Promise((resolve,reject)=>{const tx=old.transaction(['records','catalog'],'readwrite');tx.objectStore('records').put(row);tx.objectStore('catalog').put({id:record.id,type:'note',scope:'local',dirty:false,hash});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});old.close();
 const upgraded=new Database(name,{broadcast:false});t.after(()=>upgraded.close());const saved=await upgraded.get(record.id);assert.equal(saved.hash,hash);assert.equal(saved.rev,4);assert.deepEqual(saved.record,record);assert.equal(saved.scope,'sync');assert.equal(saved.dirty,true);assert.equal((await upgraded.allCatalog())[0].scope,'sync');assert.equal((await upgraded.open()).version,3);
});

test('conflicting remote media keeps its exact commit for backup and immediate access after resolution',async t=>{
 const a=database(t),b=database(t),repo=new MockGitHub(),record=newRecord({title:'媒体冲突',content:'共同版本'});await a.save(record);await sync(a,repo);await sync(b,repo);
 const image=await attach(a);await a.mutate(record.id,r=>({...r,content:`![远程图片](${image.path})`,attachments:[image]}));await b.mutate(record.id,r=>({...r,content:'未同步的本机文本'}));await sync(a,repo);assert.equal((await sync(b,repo)).status,'conflicts');
 const remote=(await b.conflicts())[0],cached=await b.getAsset(image.id);assert.equal(cached.remote_commit,remote.remoteCommit);assert.ok(cached.remote_commit);
 const zip=await buildLocalBackup(b,{resolveAsset:d=>api(repo).readAsset(d,cached.remote_commit)}),files=await readZip(zip),versions=JSON.parse(new TextDecoder().decode(files.get(`recovery/conflicts/${record.id}.json`)));assert.equal(versions.local_record.content,'未同步的本机文本');assert.equal(versions.remote_record.attachments[0].id,image.id);assert.deepEqual(Buffer.from(files.get(image.path)),imageBytes);
 await b.resolveConflict(record.id,'remote');const blob=await api(repo).readAsset(image,(await b.getAsset(image.id)).remote_commit);assert.equal(await digestBytes(await blob.arrayBuffer()),image.id);
});

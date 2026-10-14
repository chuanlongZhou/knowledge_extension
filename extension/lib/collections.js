import {LIST_ID,newRecord,upgradeRecord,urlKey} from './model.js';
export async function singletonList(db){let row=await db.get(LIST_ID);if(row?.record.kind==='tombstone')throw new Error('清单已移除，请先处理删除状态。');if(row?.record.deleted_at){await db.restore(LIST_ID);row=await db.get(LIST_ID);}return row||{id:LIST_ID,rev:0,record:newRecord({type:'list'})};}
export async function migrateTodos(db){
 const candidates=(await db.allCatalog()).filter(r=>r.type==='todo'&&!r.deleted_at);if(!candidates.length)return;
 const todos=[];for(const candidate of candidates){const row=await db.get(candidate.id);if(row?.record.type==='todo'&&!row.record.deleted_at)todos.push(row);}if(!todos.length)return;
 const row=await singletonList(db),items=new Map(row.record.list.map(i=>[i.id,i]));
 for(const {record} of todos){const id=`old-${record.id}`;if(!items.has(id))items.set(id,{id,kind:'item',text:[record.title,record.content].filter(Boolean).join(' — ').slice(0,5000),is_checkbox:true,checked:['completed','archived'].includes(record.task_status)});}
 await db.save({...row.record,list:[...items.values()],updated_at:new Date().toISOString()},{expectedRev:row.rev});
 for(const row of todos)await db.save(upgradeRecord(row.record),{expectedRev:row.rev});
}
export function mergeUrls(existing,incoming){const map=new Map(existing.map(u=>[urlKey(u.url),u]));for(const item of incoming)if(!map.has(urlKey(item.url)))map.set(urlKey(item.url),item);return [...map.values()];}
export async function appendWebsites(db,id,items){return db.mutate(id,record=>{if(record.type!=='website_group'||record.deleted_at)throw new Error('请拖入有效的网页组。');return {...record,url_list:mergeUrls(record.url_list,items),updated_at:new Date().toISOString()};});}

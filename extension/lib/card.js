import {el,button,dateLabel} from './dom.js';
import {websiteLink} from './websites.js';
import {safeUrl} from './model.js';
export function typedCard(record,{toggleList,toggleRead}={}){
 const root=el('div',{class:'typed-preview'});
 const stop=action=>event=>{event.stopPropagation();return action(event);};
 if(record.type==='list'){
  let mode=true;const rows=el('div');const modes=el('div',{class:'list-modes row'},...[[true,'Todo'],[false,'Idea']].map(([value,label])=>{const node=button(label,stop(()=>{mode=value;render();}),'type-tab');node.dataset.mode=String(value);return node;}));
  function render(){for(const node of modes.children)node.classList.toggle('active',node.dataset.mode===String(mode));rows.replaceChildren(...(record.list_preview||[]).filter(item=>item.is_checkbox===mode).map(item=>item.kind==='divider'?el('hr',{class:'list-divider'}):el('label',{class:`list-preview-line${item.checked?' completed':''}`,onclick:event=>event.stopPropagation()},mode?el('input',{type:'checkbox',checked:item.checked,'aria-label':`完成 ${item.text}`,onchange:stop(event=>toggleList(item.id,event.target.checked))}):el('span',{},'•'),el('span',{},item.text||'空项目'))));}
  root.append(modes,rows);render();
 }else if(record.type==='website_group'){
  root.append(el('small',{class:'muted'},`${record.url_count||0} 个网页 · ${record.unread_count||0} 个未读`));
  for(const item of record.url_preview||[])root.append(el('div',{class:`website-preview-line${item.read_at?' completed':''}`},el('input',{type:'checkbox',checked:!!item.read_at,'aria-label':`已读 ${item.title||item.url}`,onclick:event=>event.stopPropagation(),onchange:stop(event=>toggleRead(item.id,event.target.checked))}),websiteLink(item)));
  root.append(el('small',{class:'drop-hint'},'多选网页归组，保存成功后再关闭'));
 }else if(record.type==='snapshot')root.append(el('div',{class:'snapshot-card'},el('span',{class:'snapshot-symbol'},'▤'),el('div',{},el('strong',{},record.snapshot?.format==='png'?'页面截图':'旧版网页文件'),el('small',{class:'muted'},record.snapshot?dateLabel(record.snapshot.captured_at):'尚未捕获'))));
 else if(record.attachments?.length)root.append(el('small',{class:'muted'},`${record.attachments.filter(a=>a.kind==='image').length} 张图片 · ${record.attachments.filter(a=>a.kind==='audio').length} 段录音`));
 return root;
}

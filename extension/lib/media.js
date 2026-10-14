import {el,button,assetView} from './dom.js';
import {ensureMicrophonePermission} from './microphone.js';
import {loadAsset} from './assets.js';
export function mediaComposer(db,textarea,{attachments=[],onChange=async()=>{}}={}) {
  const descriptors=new Map(attachments.map(a=>[a.id,a])),root=el('div',{class:'media-composer'}),toolbar=el('div',{class:'media-toolbar row'}),gallery=el('div',{class:'media-gallery'}),status=el('small',{class:'muted'},'可在正文中 Ctrl+V 粘贴图片。录音与图片会写入 Markdown。');
  let recorder,stream,recordingId,timer,startAt,pending=Promise.resolve(),active=false,destroyed=false;const permissionController=new AbortController();
  const local=async descriptor=>(await db.getAsset(descriptor.id))?.blob;
  function changed(){textarea.dispatchEvent(new Event('input',{bubbles:true}));return onChange();}
  function render(){gallery.querySelectorAll('.asset-view').forEach(v=>v.dispose?.());gallery.replaceChildren(...[...descriptors.values()].map(descriptor=>el('div',{class:'media-item'},assetView(descriptor,{local,load:a=>loadAsset(db,a)}),button('移除附件',async()=>{descriptors.delete(descriptor.id);textarea.value=textarea.value.replace(new RegExp(`!?\\[[^\\]]*\\]\\(${descriptor.path.replaceAll('.','\\.')}\\)`,'g'),'');render();await changed();},'link-button'))));}
  async function insert(descriptor){descriptors.set(descriptor.id,descriptor);const label=descriptor.name.replace(/[\[\]\\\r\n]/g,'');const snippet=`${descriptor.kind==='image'?'!':''}[${label}](${descriptor.path})`;const start=textarea.selectionStart??textarea.value.length,end=textarea.selectionEnd??start;textarea.setRangeText(`${start?'\n\n':''}${snippet}\n`,start,end,'end');render();await changed();}
  async function addFiles(files){for(const file of files){const descriptor=await db.storeAsset(file,file.name||`粘贴图片-${Date.now()}.png`);await insert(descriptor);}status.textContent='附件已保存在本机；保存记录后等待手动同步。';}
  function guarded(fn){return async()=>{try{await fn();}catch(e){status.textContent=e.message;status.className='error-text';if(!active){recordButton.disabled=false;stream?.getTracks().forEach(track=>track.stop());}}};}
  const imageInput=el('input',{type:'file',accept:'image/png,image/jpeg,image/gif,image/webp,image/avif',multiple:true,hidden:true,'data-media-file':'image'});
  imageInput.addEventListener('change',guarded(async()=>{await addFiles(imageInput.files);imageInput.value='';}));
  const onPaste=event=>{const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();guarded(()=>addFiles(files))();}};textarea.addEventListener('paste',onPaste);
  const recordButton=button('开始录音',guarded(async()=>{
    if(active){recorder.stop();recordButton.disabled=true;return;}
    recordButton.disabled=true;status.className='muted';status.textContent='正在检查麦克风权限…';
    await ensureMicrophonePermission({signal:permissionController.signal,onStatus:message=>status.textContent=message});
    if(destroyed)throw new Error('录音窗口已关闭。');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('浏览器无法使用麦克风，请在完整整理页录音。');
    try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}catch(e){throw new Error(e.name==='NotAllowedError'?'麦克风权限被阻止，请点击“麦克风设置”打开授权页，并允许浏览器使用麦克风。':e.name==='NotFoundError'?'没有找到麦克风，请连接设备后重试。':'无法打开麦克风，请检查设备是否可用。');}
    const mimeType=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),audioBitsPerSecond:64000});const session=await db.startRecording(recorder.mimeType);recordingId=session.id;startAt=Date.now();active=true;recordButton.textContent='停止录音';status.className='recording-status';status.textContent='● 正在录音 00:00';
    recorder.ondataavailable=event=>{if(!event.data.size)return;pending=pending.then(()=>db.appendRecording(recordingId,event.data)).then(session=>{if(session.size_bytes>=18*1024*1024&&recorder.state==='recording')recorder.stop();}).catch(e=>{status.textContent=e.message;if(recorder.state==='recording')recorder.stop();});};
    recorder.onstop=async()=>{clearInterval(timer);stream.getTracks().forEach(track=>track.stop());active=false;status.className='muted';status.textContent='正在保存录音…';try{await pending;if(destroyed)return;const descriptor=await db.finishRecording(recordingId);await insert(descriptor);if(destroyed)return;await db.removeRecording(recordingId);status.textContent='录音已保存为附件；点击保存记录即可。';}catch(e){status.textContent=`${e.message} 已保存片段可在设置中恢复。`;}finally{recordButton.textContent='开始录音';recordButton.disabled=false;}};
    recorder.onerror=()=>{status.textContent='录音被中断，已保存片段可以从设置中恢复。';if(recorder.state==='recording')recorder.stop();};
    timer=setInterval(()=>{const seconds=Math.floor((Date.now()-startAt)/1000);status.textContent=`● 正在录音 ${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} · 每秒保存片段到本机`;},1000);recorder.start(1000);recordButton.disabled=false;
  }),'button small');
  toolbar.append(button('麦克风设置',()=>chrome.tabs.create({url:chrome.runtime.getURL('microphone.html')}),'link-button'),button('添加图片',()=>imageInput.click(),'button small'),recordButton,imageInput);root.append(toolbar,status,gallery);render();
  return {root,get attachments(){return [...descriptors.values()];},get recording(){return active||recordButton.disabled;},setAttachments(values){descriptors.clear();values.forEach(a=>descriptors.set(a.id,a));render();},preview(text){return {attachments:[...descriptors.values()],local,load:a=>loadAsset(db,a)};},destroy(){destroyed=true;permissionController.abort();textarea.removeEventListener('paste',onPaste);clearInterval(timer);if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(track=>track.stop());gallery.querySelectorAll('.asset-view').forEach(v=>v.dispose?.());}};
}

import {Database} from './lib/db.js';
import {newRecord} from './lib/model.js';
import {protectStorage} from './lib/config.js';

const db = new Database();
protectStorage().catch(() => {});
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({id: 'capture-selection', title: '收集选中文字到 PKM Nexus', contexts: ['selection']});
    chrome.contextMenus.create({id: 'capture-page', title: '收集当前网页到 PKM Nexus', contexts: ['page']});
  });
});
async function badge() {
  const captures = await db.captures();
  await chrome.action.setBadgeText({text: captures.length ? String(captures.length) : ''});
  await chrome.action.setBadgeBackgroundColor({color: '#b56824'});
}
async function preparePage(tab, selectedText = null, pageUrl = null, snapshot = false) {
  let text = selectedText;
  if (text === null && tab?.id) {
    try { const results = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => ({text:window.getSelection()?.toString() || '', url:location.href, title:document.title})}); const captured=results[0]?.result; text=captured?.text || ''; if(captured) { pageUrl=captured.url; tab={...tab,title:captured.title}; } }
    catch {
      if (/^https?:\/\//.test(tab?.url || '')) throw new Error('浏览器未允许读取这个网站，请在扩展的网站访问设置中允许访问，或手动粘贴内容。');
      text = '';
    }
  }
  const url = pageUrl || tab?.url || '';
  if (!url) throw new Error('浏览器尚未授权访问当前网页，请用网页右键或 Alt + Shift + S 收集，也可以手动粘贴链接。');
  if (!/^https?:\/\//.test(url)) throw new Error('这个页面不允许读取，请打开侧边栏手动粘贴内容。');
  const now = new Date().toISOString();
  const record=newRecord({type:snapshot?'snapshot':'note',title:tab?.title||url,content:snapshot?'':text||'',sources:[{url,title:tab?.title||'',captured_at:now,kind:!snapshot&&text?'web_selection':'web_page'}]});
  if(snapshot){
    const before=(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0];if(before?.id!==tab.id)throw new Error('请先切回要截图的网页。');
    const image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
    const current=await chrome.tabs.get(tab.id),after=(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0];if(current.url!==url||current.pendingUrl&&current.pendingUrl!==url||after?.id!==tab.id)throw new Error('截图时网页发生切换或导航，请重新截图。');
    const bytes=Uint8Array.from(atob(image.split(',')[1]),char=>char.charCodeAt(0));
    const descriptor=await db.storeAsset(new Blob([bytes],{type:'image/png'}),`${(tab.title||'页面截图').replace(/[\\/:*?"<>|]/g,'-').slice(0,100)}.png`);
    record.attachments=[descriptor];record.snapshot={url,title:tab.title||url,captured_at:now,format:'png',asset_id:descriptor.id};
  }
  return {record};
}
async function queueEditor(result){const key=`draft:editor:new:captured-${result.record.id}`;await db.setState(key,{record:result.record,rawUrls:result.record.sources.map(s=>s.url).join('\n'),expectedRev:0,scope:'sync'});await db.setState('capture:editor',{key,record:result.record,nonce:crypto.randomUUID()});}
function openPanel(tab) { if (tab?.windowId !== undefined) chrome.sidePanel.open({windowId: tab.windowId}).catch(() => {}); }
function handleError(error) { return db.setState('notice', {text: error.message || '操作失败，请重试。', error: true, at: new Date().toISOString()}); }
chrome.contextMenus.onClicked.addListener((info, tab) => {
  openPanel(tab);
  preparePage(tab, info.menuItemId === 'capture-selection' ? info.selectionText || '' : '', info.frameUrl || info.pageUrl).then(queueEditor).catch(handleError);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'dashboard') { chrome.tabs.create({url: chrome.runtime.getURL('dashboard.html')}); return; }
  if (command === 'capture') {
    openPanel(tab);
    (tab ? Promise.resolve(tab) : chrome.tabs.query({active: true, currentWindow: true}).then(tabs => tabs[0])).then(t => preparePage(t)).then(queueEditor).catch(handleError);
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'capture-active') { chrome.tabs.query({active: true, lastFocusedWindow: true}).then(tabs => preparePage(tabs[0],null,null,message.snapshot===true)).then(result => respond({ok: true, result})).catch(error => respond({ok: false, error: error.message})); return true; }
  if (message?.type === 'refresh-badge') { badge().then(() => respond({ok: true})); return true; }
});

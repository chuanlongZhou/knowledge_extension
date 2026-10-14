import {safeUrl} from './model.js';
import {el} from './dom.js';
const cache=new Map();
export function isPlaceholderTitle(title,url){const text=(title||'').trim();return !text||/^https?:\/\//i.test(text)||text===url.replace(/^https?:\/\//,'')||/^[^\s]+\.[a-z]{2,}\/[^\s]*$/i.test(text);}
export function shortWebsiteTitle(title,url){const text=(title||'').replace(/\s+/g,' ').trim();if(!isPlaceholderTitle(text,url))return text.slice(0,1000);try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '网页';}}
export function favicon(url){const result=new URL(chrome.runtime.getURL('_favicon/'));result.searchParams.set('pageUrl',safeUrl(url));result.searchParams.set('size','32');return result.href;}
export function websiteLabel(item){const fallback=el('span',{class:'website-icon fallback-icon',hidden:true},'◉'),image=el('img',{class:'website-icon',src:favicon(item.url),alt:'',loading:'lazy',onerror:()=>{image.hidden=true;fallback.hidden=false;}});return el('span',{class:'website-label'},image,fallback,el('span',{class:'website-title'},shortWebsiteTitle(item.title,item.url)));}
export function websiteLink(item){return el('a',{class:'website-link',href:safeUrl(item.url),target:'_blank',rel:'noopener noreferrer',title:shortWebsiteTitle(item.title,item.url),onclick:e=>e.stopPropagation()},websiteLabel(item));}
export function linkDropTitles(html){const result=new Map();if(!html)return result;const document=new DOMParser().parseFromString(html,'text/html');for(const anchor of document.querySelectorAll('a[href]')){const url=safeUrl(anchor.getAttribute('href'));if(!url)continue;const title=(anchor.textContent||anchor.getAttribute('aria-label')||anchor.getAttribute('title')||anchor.querySelector('img')?.getAttribute('alt')||'').trim();if(title&&!/^https?:\/\//i.test(title))result.set(url,title.slice(0,1000));}return result;}
export async function websiteTitle(url,{hint='',fetchImpl=globalThis.fetch}={}){
 url=safeUrl(url);if(!url)throw new Error('请输入 HTTP / HTTPS 网页链接。');if(cache.has(url))return cache.get(url);
 const pending=(async()=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);let reader;try{
  const response=await fetchImpl(url,{signal:controller.signal,credentials:'omit',redirect:'follow',cache:'no-store'});if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('html'))throw new Error('网页不提供标题');
  reader=response.body.getReader();const chunks=[];let length=0;const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>512*1024)throw new Error('网页标题部分过大');chunks.push(value);if(decoder.decode(value).includes('</head>'))break;}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const charset=response.headers.get('content-type').match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]||'utf-8';let text;try{text=new TextDecoder(charset).decode(bytes);}catch{text=new TextDecoder().decode(bytes);}
  const document=new DOMParser().parseFromString(text,'text/html'),title=document.querySelector('meta[property="og:title"]')?.getAttribute('content')||document.querySelector('title')?.textContent||hint;return shortWebsiteTitle(title,url);
 }catch{return shortWebsiteTitle(hint,url);}finally{clearTimeout(timeout);await reader?.cancel().catch(()=>{});}})();if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(url,pending);return pending;
}

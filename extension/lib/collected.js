import { normalizeRecord, safeUrl } from './model.js';

export const COLLECTION_QUEUE = 'capture:editor';
export const COLLECTION_LOCK = 'pkm-nexus:capture-editor';
const label = (text) =>
  String(text || '')
    .replace(/[\\`*_[\]<>]/g, '\\$&')
    .replace(/\r?\n/g, ' ');
const link = (text, url) =>
  `[${label(text || url)}](${safeUrl(url)?.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29')) || ''})`;

function sectionEnd(content) {
  let offset = 0,
    found = false,
    fence = '';
  for (const line of content.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = '';
    } else if (marker) fence = marker;
    else if (found && /^#{1,2} /.test(line)) return offset;
    else if (/^## collected:[ \t]*\r?\n?$/.test(line)) found = true;
    offset += line.length;
  }
  return found ? content.length : null;
}

export function appendCollected(record, incoming) {
  const source = incoming.sources.find((s) => !['web_link', 'web_image'].includes(s.kind));
  const target = incoming.sources.find((s) => ['web_link', 'web_image'].includes(s.kind));
  const image = incoming.attachments?.find((a) => a.kind === 'image');
  let item = incoming.content.trim().replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ');
  if (target?.kind === 'web_image') {
    item = image
      ? `![${label(incoming.content || '收集图片')}](${image.path})`
      : `![${label(incoming.content || target.title || '收集图片')}](${safeUrl(target.url)?.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29')) || ''})`;
    if (image) item += ` · ${link('原图', target.url)}`;
  } else if (target) item = link(incoming.content || target.title || '收集链接', target.url);
  if (!item) item = source ? link(source.title || '网页', source.url) : '收集内容';
  if (source) item += `\n  来源：${link(source.title || source.url, source.url)}`;
  const bullet = `- ${item}\n`;
  let content = record.content;
  const end = sectionEnd(content);
  if (end !== null) {
    content = `${content.slice(0, end).trimEnd()}\n${bullet}${end < content.length ? '\n' + content.slice(end).trimStart() : ''}`;
  } else content = `${content.trimEnd()}${content.trim() ? '\n\n' : ''}## collected:\n\n${bullet}`;
  const sources = [
    ...new Map([...record.sources, ...incoming.sources].map((s) => [s.url, s])).values(),
  ];
  const attachments = [
    ...new Map(
      [...record.attachments, ...(incoming.attachments || [])].map((a) => [a.id, a]),
    ).values(),
  ];
  return normalizeRecord({
    ...record,
    title: record.title || incoming.title,
    content,
    sources,
    attachments,
    updated_at: new Date().toISOString(),
  });
}

export async function enqueueCollected(db, record, windowId) {
  // Each capture also remains an ordinary recoverable draft until the editor acknowledges it.
  const key = `draft:editor:new:captured-${record.id}`;
  await db.setState(key, {
    record,
    rawUrls: record.sources.map((s) => s.url).join('\n'),
    expectedRev: 0,
  });
  await navigator.locks.request(COLLECTION_LOCK, async () => {
    const old = await db.getState(COLLECTION_QUEUE);
    const queue = Array.isArray(old) ? old : old ? [old] : [];
    queue.push({ key, nonce: record.id, windowId });
    await db.setState(COLLECTION_QUEUE, queue);
  });
}

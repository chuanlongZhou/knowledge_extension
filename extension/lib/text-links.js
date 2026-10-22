import { safeUrl } from './model.js';

// Return text/link segments, never HTML. Preserve URL queries, fragments and parentheses.
export function textLinkParts(value) {
  const text = String(value || ''),
    parts = [];
  const pattern =
    /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()<>]|\([^\s()<>]*\))+)\)|(https?:\/\/[^\s<>"'`]+)/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    let url = match[2] || match[3],
      end = match.index + match[0].length;
    if (match[3]) {
      url = url.replace(/[.,;:!?，。；：！？]+$/u, '');
      for (const [open, close] of [
        ['(', ')'],
        ['[', ']'],
        ['{', '}'],
      ]) {
        while (url.endsWith(close) && url.split(close).length > url.split(open).length)
          url = url.slice(0, -1);
      }
      end = match.index + url.length;
    }
    const href = safeUrl(url);
    if (!href) continue;
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: match[1] || url, href });
    offset = end;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

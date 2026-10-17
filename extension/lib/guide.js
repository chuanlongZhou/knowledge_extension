import { el } from './dom.js';

// This renderer accepts text, links and bundled images, never Markdown HTML.
function localImage(value) {
  if (!/^images\/[a-z0-9_-]+\.png$/i.test(value)) return null;
  return new URL(`guide/${value}`, location.href).href;
}
function linkUrl(value) {
  if (/^#[a-z0-9_-]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function inline(node, text) {
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    node.append(document.createTextNode(text.slice(index, match.index)));
    if (match[1]) {
      const url = linkUrl(match[2]);
      node.append(
        url
          ? el(
              'a',
              {
                href: url,
                target: url.startsWith('#') ? null : '_blank',
                rel: 'noopener noreferrer',
              },
              match[1],
            )
          : match[0],
      );
    } else node.append(el(match[3] ? 'code' : 'strong', {}, match[3] || match[4]));
    index = match.index + match[0].length;
  }
  node.append(document.createTextNode(text.slice(index)));
  return node;
}
export function renderGuide(markdown) {
  const root = el('article'),
    headings = [];
  const lines = markdown.replace(/\r/g, '').split('\n');
  let code = null,
    codeLines = [],
    table = null;
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code) {
        code.textContent = codeLines.join('\n');
        code = null;
      } else {
        code = el('code');
        codeLines = [];
        root.append(el('pre', {}, code));
      }
      continue;
    }
    if (code) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      table = null;
      continue;
    }
    const heading = line.match(/^(#{1,4}) (.+)$/),
      image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (heading) {
      const id = `chapter-${headings.length + 1}`;
      root.append(inline(el(`h${heading[1].length}`, { id }), heading[2]));
      headings.push({ id, text: heading[2], level: heading[1].length });
    } else if (image) {
      const url = localImage(image[2]);
      if (url)
        root.append(
          el(
            'figure',
            {},
            el(
              'a',
              { href: url, target: '_blank', rel: 'noopener noreferrer' },
              el('img', { src: url, alt: image[1], loading: 'lazy', decoding: 'async' }),
            ),
            el('figcaption', {}, image[1]),
          ),
        );
      else root.append(el('p', {}, image[1]));
    } else if (/^\|/.test(line)) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const first = !table;
      if (!table) {
        table = el('table');
        root.append(table);
      }
      table.append(
        el(
          'tr',
          {},
          line
            .split('|')
            .slice(1, -1)
            .map((cell) => inline(el(first ? 'th' : 'td'), cell.trim())),
        ),
      );
    } else if (line.startsWith('> ')) root.append(inline(el('blockquote'), line.slice(2)));
    else if (/^\s*(?:[-*]|\d+\.) /.test(line))
      root.append(
        inline(el('p', { class: 'guide-list-item' }), line.replace(/^(\s*)[-*] /, '$1• ')),
      );
    else if (line === '---') root.append(el('hr'));
    else root.append(inline(el('p'), line));
  }
  if (code) code.textContent = codeLines.join('\n');
  return { root, headings };
}

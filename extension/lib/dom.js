import { safeUrl } from './model.js';
import { icon } from './icons.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function')
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = !!value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
export function button(label, action, className = 'button') {
  return el(
    'button',
    {
      type: 'button',
      class: className,
      onclick: action,
      ...(label === '⌫' ? { 'aria-label': '移入回收站' } : {}),
    },
    label === '⌫' ? icon('trash') : label,
  );
}
export function field(label, input, hint = '') {
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'field-label' }, label),
    input,
    hint ? el('small', {}, hint) : null,
  );
}
export function option(value, label, selected = false) {
  return el('option', { value, selected }, label);
}
export function dateLabel(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
export function download(name, content, mime = 'application/json') {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` }),
  );
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function assetView(descriptor, { load, local = async () => null } = {}) {
  const root = el('div', { class: 'asset-view' }),
    display = el('div', { class: 'asset-display' }),
    status = el(
      'small',
      { class: 'muted' },
      `${descriptor.kind === 'image' ? '图片' : descriptor.kind === 'snapshot' ? '网页快照' : '录音'} · ${(descriptor.size_bytes / 1024).toFixed(1)} KB`,
    );
  let objectUrl;
  const show = (blob) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    const node =
      descriptor.kind === 'snapshot'
        ? el(
            'a',
            { href: objectUrl, download: descriptor.name, class: 'button small' },
            '下载网页快照',
          )
        : descriptor.kind === 'image'
          ? el('img', { src: objectUrl, alt: descriptor.name, loading: 'lazy' })
          : el('audio', { src: objectUrl, controls: true, preload: 'none' });
    display.replaceChildren(node);
    loadButton.hidden = true;
  };
  const loadButton = button(
    descriptor.kind === 'image'
      ? '加载图片'
      : descriptor.kind === 'snapshot'
        ? '加载快照'
        : '加载录音',
    async () => {
      loadButton.disabled = true;
      try {
        show(await load(descriptor));
      } catch (e) {
        status.textContent = e.message;
        status.className = 'error-text';
      } finally {
        loadButton.disabled = false;
      }
    },
    'button small',
  );
  if (descriptor.kind === 'image')
    root.append(
      button(
        '下载图片',
        async () => {
          try {
            download(descriptor.name, await load(descriptor), descriptor.mime_type);
          } catch (e) {
            status.textContent = e.message;
            status.className = 'error-text';
          }
        },
        'link-button',
      ),
    );
  root.append(
    el('strong', {}, descriptor.name),
    display,
    el('div', { class: 'row' }, loadButton, status),
  );
  local(descriptor)
    .then((blob) => {
      if (blob && root.isConnected) show(blob);
    })
    .catch(() => {});
  root.dispose = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
  return root;
}
export function markdownPreview(text, { attachments = [], load, local } = {}) {
  const root = el('div', { class: 'markdown' });
  let code = null,
    codeLines = [];
  const assets = new Map(attachments.map((a) => [a.path, a]));
  function paragraph(line) {
    const row = el('div', { class: 'markdown-line' });
    let index = 0;
    const regex =
      /(!?)\[((?:\\.|[^\]\\])*)\]\((assets\/[a-f0-9]{64}\.[a-z0-9]+|https?:\/\/[^\s)]+)\)/g;
    for (const match of line.matchAll(regex)) {
      row.append(document.createTextNode(line.slice(index, match.index)));
      const descriptor = assets.get(match[3]);
      if (descriptor) row.append(assetView(descriptor, { load, local }));
      else if (safeUrl(match[3])) {
        const href = safeUrl(match[3]);
        const caption = match[2].replace(/\\([\\`*_[\]<>])/g, '$1') || match[3];
        row.append(
          match[1]
            ? el(
                'a',
                { href, target: '_blank', rel: 'noopener noreferrer' },
                el('img', {
                  src: href,
                  alt: caption,
                  loading: 'lazy',
                  referrerpolicy: 'no-referrer',
                }),
              )
            : el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, caption),
        );
      } else row.append(document.createTextNode(match[0]));
      index = match.index + match[0].length;
    }
    row.append(document.createTextNode(line.slice(index) || '\u00a0'));
    return row;
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (code) {
        code.textContent = codeLines.join('\n');
        code = null;
        codeLines = [];
      } else {
        code = el('code');
        root.append(el('pre', {}, code));
      }
    } else if (code) codeLines.push(line);
    else if (/^#{1,4} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      root.append(el(`h${level}`, {}, line.slice(level + 1)));
    } else if (/^[-*] /.test(line)) {
      const bullet = paragraph(line.slice(2));
      bullet.classList.add('markdown-bullet');
      bullet.prepend(document.createTextNode('• '));
      root.append(bullet);
    } else if (line.trim() === '---') root.append(el('hr'));
    else root.append(paragraph(line));
  }
  if (code) code.textContent = codeLines.join('\n');
  root.dispose = () => root.querySelectorAll('.asset-view').forEach((view) => view.dispose?.());
  return root;
}

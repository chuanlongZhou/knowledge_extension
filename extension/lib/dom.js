import { t, getLanguage } from './i18n.js';
import { safeUrl, drivePreviewUrl } from './model.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown-vendor.js';
import { textLinkParts } from './text-links.js';

export function linkedText(text, { linksOnly = false } = {}) {
  return el(
    'span',
    { class: 'linked-text' },
    textLinkParts(text).map((part) =>
      part.href
        ? el(
            'a',
            {
              href: part.href,
              target: '_blank',
              rel: 'noopener noreferrer',
              onclick: (event) => event.stopPropagation(),
            },
            part.text,
          )
        : linksOnly
          ? null
          : part.text,
    ),
  );
}

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
      ...(label === '⌫' ? { 'aria-label': t('移入回收站') } : {}),
    },
    label === '⌫' ? icon('trash') : label,
  );
}
export function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (
      event.clientX < left ||
      event.clientX > right ||
      event.clientY < top ||
      event.clientY > bottom
    )
      dialog.close();
  });
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
  return new Intl.DateTimeFormat(getLanguage(), {
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
export function assetView(descriptor, { load, local = async () => null, imageOnly = false } = {}) {
  if (descriptor.storage === 'drive')
    return el(
      'div',
      { class: 'asset-view drive-attachment' },
      el(
        'a',
        {
          href: drivePreviewUrl(descriptor.drive_file_id),
          target: '_blank',
          rel: 'noopener noreferrer',
          title: t('在 Google Drive 中预览'),
        },
        descriptor.name,
      ),
      el(
        'small',
        { class: 'muted' },
        `${(descriptor.size_bytes / 1024).toFixed(1)} KB · Google Drive`,
      ),
    );
  const root = el('div', { class: `asset-view${imageOnly ? ' asset-image-only' : ''}` }),
    display = el('div', { class: 'asset-display' }),
    status = el(
      'small',
      { class: 'muted' },
      imageOnly
        ? ''
        : `${descriptor.kind === 'image' ? t('图片') : descriptor.kind === 'snapshot' ? t('网页快照') : t('录音')} · ${(descriptor.size_bytes / 1024).toFixed(1)} KB`,
    );
  let objectUrl,
    disposed = false;
  const show = (blob) => {
    if (disposed) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    const node =
      descriptor.kind === 'snapshot'
        ? el(
            'a',
            { href: objectUrl, download: descriptor.name, class: 'button small' },
            t('下载网页快照'),
          )
        : descriptor.kind === 'image'
          ? el('img', { src: objectUrl, alt: descriptor.name })
          : el('audio', { src: objectUrl, controls: true, preload: 'none' });
    display.replaceChildren(node);
    root.classList.add('asset-loaded');
    if (descriptor.kind === 'image')
      node.addEventListener('error', () => {
        if (disposed || display.firstChild !== node) return;
        root.classList.remove('asset-loaded');
        status.textContent = t('图片无法解码，请重新收集原图或导入完整备份。');
        status.className = 'error-text';
        loadButton.hidden = false;
      });
    loadButton.hidden = true;
  };
  const loadButton = button(
    descriptor.kind === 'image'
      ? t('加载图片')
      : descriptor.kind === 'snapshot'
        ? t('加载快照')
        : t('加载录音'),
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
  if (descriptor.kind === 'image' && !imageOnly)
    root.append(
      button(
        t('下载图片'),
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
    ...(imageOnly ? [] : [el('strong', {}, descriptor.name)]),
    display,
    el('div', { class: 'row' }, loadButton, status),
  );
  local(descriptor)
    .then((blob) => {
      // A preview can still be detached while its asynchronous parent is being assembled.
      if (blob) show(blob);
    })
    .catch(() => {});
  root.dispose = () => {
    disposed = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };
  return root;
}
function inlineImageView(descriptor, alt, { load, local } = {}) {
  const image = el('img', { alt: alt || descriptor.name, loading: 'lazy' });
  const status = el(
    'small',
    { class: 'muted' },
    `${t('图片')} · ${(descriptor.size_bytes / 1024).toFixed(1)} KB`,
  );
  const link = el('a', { href: '#', download: descriptor.name }, t('下载图片'));
  const root = el(
    'span',
    { class: 'markdown-inline-image' },
    image,
    el('span', { class: 'markdown-image-meta' }, status, link),
  );
  let objectUrl;
  let disposed = false;
  const getBlob = async () => {
    try {
      const blob = await local?.(descriptor);
      if (blob) return blob;
    } catch {
      // A local copy may be unavailable while the synced asset can still be fetched.
    }
    return load?.(descriptor);
  };
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      const blob = await getBlob();
      if (!blob) throw new Error(t('图片尚未保存到本地。'));
      download(descriptor.name, blob, descriptor.mime_type);
    } catch (error) {
      status.textContent = error.message;
      status.className = 'error-text';
    }
  });
  image.addEventListener('error', () => {
    if (disposed) return;
    status.textContent = t('图片无法解码，请重新收集原图或导入完整备份。');
    status.className = 'error-text';
  });
  getBlob()
    .then((blob) => {
      if (!blob || disposed) return;
      objectUrl = URL.createObjectURL(blob);
      image.src = objectUrl;
    })
    .catch((error) => {
      if (disposed) return;
      status.textContent = error.message;
      status.className = 'error-text';
    });
  root.dispose = () => {
    disposed = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
  return root;
}
export function markdownPreview(text, { attachments = [], load, local } = {}) {
  const root = el('div', { class: 'markdown' });
  const assets = new Map(attachments.map((a) => [a.path, a]));
  root.innerHTML = renderMarkdown(text);
  for (const image of [...root.querySelectorAll('img')]) {
    const source = image.getAttribute('src') || '';
    const descriptor = assets.get(source);
    if (descriptor?.kind === 'image')
      image.replaceWith(inlineImageView(descriptor, image.alt, { load, local }));
    else if (descriptor) image.replaceWith(assetView(descriptor, { load, local }));
    else if (safeUrl(source)) {
      image.src = safeUrl(source);
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.classList.add('markdown-image');
    } else image.remove();
  }
  for (const link of [...root.querySelectorAll('a')]) {
    if (link.closest('.markdown-inline-image')) continue;
    const href = link.getAttribute('href') || '';
    const descriptor = assets.get(href);
    if (descriptor) link.replaceWith(assetView(descriptor, { load, local }));
    else if (safeUrl(href)) {
      link.href = safeUrl(href);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else link.replaceWith(document.createTextNode(link.textContent));
  }
  root.dispose = () =>
    root
      .querySelectorAll('.asset-view, .markdown-inline-image')
      .forEach((view) => view.dispose?.());
  return root;
}

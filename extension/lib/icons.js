export function icon(name, label = '') {
  const paths = {
    theme: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 3v18', 'M8 6v12', 'M5 9v6'],
    book: ['M12 6C9 4 5 4 2 5v15c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1Z', 'M12 6v15'],
    settings: ['M4 3v18', 'M12 3v18', 'M20 3v18', 'M1 8h6', 'M9 16h6', 'M17 7h6'],
    inbox: ['M3 4h18v16H3Z', 'M3 13h5l2 3h4l2-3h5'],
    records: ['M5 3h14v18H5Z', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
    check: ['m4 12 5 5L20 6'],
    duplicates: ['M8 8h13v13H8Z', 'M16 8V3H3v13h5'],
    upload: ['M12 17V3', 'm6 9 6-6 6 6', 'M3 16v5h18v-5'],
    trash: ['M3 6h18', 'M9 6V4h6v2', 'M5 6l1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
    star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z'],
    folder: ['M3 7V4h6l2 3h10v13H3Z'],
    tag: ['M3 3h8l10 10-8 8L3 11Z', 'M7 7h.01'],
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: '22',
    height: '22',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'ui-icon',
    'aria-hidden': label ? 'false' : 'true',
  }))
    svg.setAttribute(key, value);
  if (label) svg.setAttribute('aria-label', label);
  for (const d of paths[name] || paths.trash) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

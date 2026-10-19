import { toMarkdown } from './model.js';

export const EXPORT_GROUPS = { project: '按项目', tag: '按标签', none: '不分类' };
export function safeExportName(value, fallback = '未命名记录') {
  const clean = [...String(value || '').normalize('NFC')]
    .filter((char) => char.codePointAt(0) >= 32 && char.codePointAt(0) !== 127)
    .join('')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  const name =
    [...(clean || fallback)]
      .slice(0, 70)
      .join('')
      .replace(/[. ]+$/g, '') || fallback;
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}
export function readableExport(backup, groupBy = 'project') {
  if (!Object.hasOwn(EXPORT_GROUPS, groupBy)) throw new Error('请选择按项目、按标签或不分类导出。');
  const records = backup.records.map(({ record }) => record).filter((r) => r.kind !== 'tombstone');
  const byId = new Map(records.map((r) => [r.id, r]));
  const files = new Map(),
    entries = [],
    allocated = new Map(),
    projectFolders = new Map();
  const allocate = (parent, title, id, ext = '') => {
    const base = safeExportName(ext === '.md' ? String(title).replace(/\.md$/i, '') : title),
      key = `${parent}/${base}${ext}`.toLowerCase();
    const owner = allocated.get(key);
    let name = base;
    if (owner && owner !== id) {
      let hash = 2166136261;
      for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
      const suffix = /^[\w-]+$/.test(id)
        ? id.slice(0, 8)
        : (hash >>> 0).toString(16).padStart(8, '0');
      name = `${base} -- ${suffix}`;
    }
    let path = `${parent}/${name}${ext}`,
      serial = 2;
    while (allocated.has(path.toLowerCase()) && allocated.get(path.toLowerCase()) !== id)
      path = `${parent}/${name} ${serial++}${ext}`;
    allocated.set(path.toLowerCase(), id);
    return path;
  };
  const projectFolder = (id) => {
    if (projectFolders.has(id)) return projectFolders.get(id);
    const chain = [],
      visited = new Set();
    let current = id;
    while (current && !projectFolders.has(current) && !visited.has(current)) {
      const p = byId.get(current);
      if (!p || p.type !== 'project' || p.deleted_at) break;
      visited.add(current);
      chain.push(p);
      current = p.parent_project_id;
    }
    let parent = projectFolders.get(current) || 'notes/项目';
    for (const p of chain.reverse()) {
      // Deep or unusually long hierarchies use a named folder at the project root.
      if (parent.length > 120) parent = 'notes/项目';
      parent = allocate(parent, p.title, p.id);
      projectFolders.set(p.id, parent);
    }
    return projectFolders.get(id) || null;
  };
  const putNote = (record, parent) => {
    const title = record.title || (record.type === 'list' ? 'Todo - Idea' : '未命名记录');
    const path = allocate(parent, title, record.id, '.md');
    const prefix = '../'.repeat(path.split('/').length - 1);
    files.set(path, toMarkdown(record).replaceAll('](assets/', `](${prefix}assets/`));
    return path;
  };
  // Sort before assigning paths to keep duplicate names deterministic across exports.
  const sorted = [...records].sort(
    (a, b) =>
      Number(b.type === 'project') - Number(a.type === 'project') || a.id.localeCompare(b.id),
  );
  for (const record of sorted) {
    let parents;
    if (record.deleted_at) parents = ['notes/回收站'];
    else if (groupBy === 'none') parents = ['notes'];
    else if (groupBy === 'project') {
      parents =
        record.type === 'project'
          ? [projectFolder(record.id)]
          : [...new Set((record.project_ids || []).map((id) => projectFolder(id)).filter(Boolean))];
      if (!parents.length || !parents[0]) parents = ['notes/未归入项目'];
    } else {
      parents = [...new Set(record.tags || [])].map((tag) =>
        allocate('notes/标签', tag, `tag:${tag}`),
      );
      if (!parents.length)
        parents = [record.type === 'project' ? 'notes/项目说明' : 'notes/未打标签'];
    }
    entries.push({
      id: record.id,
      title: record.title,
      paths: parents.map((parent) => putNote(record, parent)),
    });
  }
  if (groupBy === 'tag') {
    for (const tag of backup.tag_library?.definitions || []) {
      const folder = allocate('notes/标签', tag.name, `tag:${tag.name}`);
      const path = allocate(folder, tag.name, `tag-description:${tag.name}`, '.md');
      files.set(
        path,
        `# ${tag.name.replace(/[\r\n]/g, ' ')}\n\n${tag.description || ''}\n\n颜色：${tag.color}\n`,
      );
    }
  }
  files.set(
    'export-index.json',
    JSON.stringify({ version: 1, group_by: groupBy, records: entries }, null, 2),
  );
  return { files, entries };
}

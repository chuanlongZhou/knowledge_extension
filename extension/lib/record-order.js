import { t, getLanguage } from './i18n.js';
export const SORT_MODES = {
  updated_at: t('最近修改时间'),
  created_at: t('创建时间'),
  tag: t('标签'),
  project: t('项目'),
  title: t('标题'),
};
export function sortPreference(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const mode = Object.hasOwn(SORT_MODES, value.mode) ? value.mode : 'updated_at';
  return {
    mode,
    direction: ['asc', 'desc'].includes(value.direction)
      ? value.direction
      : ['created_at', 'updated_at'].includes(mode)
        ? 'desc'
        : 'asc',
  };
}
const compareText = new Intl.Collator(getLanguage(), { numeric: true, sensitivity: 'base' })
  .compare;
export class RecordOrder {
  reset() {
    this.key = null;
  }
  reconcile(catalog, key, preference) {
    const { mode, direction } = sortPreference(preference),
      byId = new Map(catalog.map((r) => [r.id, r]));
    const projectName = (id) => {
      const names = [],
        seen = new Set();
      while (id && !seen.has(id)) {
        seen.add(id);
        const p = byId.get(id);
        if (!p || p.deleted_at) break;
        names.unshift(p.title);
        id = p.parent_project_id;
      }
      return names.join(' / ');
    };
    const value = (r) =>
      mode === 'tag'
        ? [...(r.tags || [])].sort(compareText).join('、')
        : mode === 'project'
          ? (r.project_ids || []).map(projectName).filter(Boolean).sort(compareText).join('、')
          : r[mode] || '';
    const values = new Map(catalog.map((r) => [r.id, value(r)]));
    const compare = (a, b) => {
      const av = values.get(a.id),
        bv = values.get(b.id);
      if (!av !== !bv) return av ? -1 : 1;
      return (
        (direction === 'desc' ? -1 : 1) * compareText(av, bv) ||
        compareText(b.created_at || '', a.created_at || '') ||
        a.id.localeCompare(b.id)
      );
    };
    const fingerprint = JSON.stringify([key, mode, direction]);
    if (this.key !== fingerprint) {
      this.key = fingerprint;
      this.ids = [...catalog].sort(compare).map((r) => r.id);
      this.values = values;
      this.hasNew = false;
    } else {
      const known = new Set(this.ids);
      const added = catalog.filter((r) => !known.has(r.id)).sort(compare);
      if (added.length && this.ids.length) this.hasNew = true;
      this.ids = this.ids.filter((id) => byId.has(id)).concat(added.map((r) => r.id));
      for (const r of added) this.values.set(r.id, values.get(r.id));
    }
    this.pending = this.hasNew || this.ids.some((id) => this.values.get(id) !== values.get(id));
    return this.ids;
  }
}

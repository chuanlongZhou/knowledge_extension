import { newRecord, normalizeRecord } from './model.js';

export const activeProject = (record) => record.type === 'project' && !record.deleted_at;
export const memberOf = (record, id) =>
  record.kind !== 'tombstone' &&
  record.type !== 'project' &&
  !record.deleted_at &&
  record.project_ids?.includes(id);
export const graphNodeOf = (record, id) =>
  memberOf(record, id) || (activeProject(record) && record.parent_project_id === id);

export function upgradeProject(record) {
  if (record.schema_version === 5) return normalizeRecord(record);
  const rest = { ...record };
  if (record.purpose)
    rest.content = `${record.content}${record.content ? '\n\n' : ''}旧版备注：${record.purpose}`;
  for (const key of ['purpose', 'task_status', 'keywords', 'match_fields']) delete rest[key];
  return newRecord({ ...rest, schema_version: 5, parent_project_id: null, graph: { edges: [] } });
}

export function validateProjects(records, { onlyIds } = {}) {
  const all = new Map(records.map((record) => [record.id, record]));
  const projects = records.filter(activeProject);
  for (const project of projects) {
    if (onlyIds && !onlyIds.has(project.id)) continue;
    const visited = new Set([project.id]);
    let parent = project.parent_project_id;
    while (parent) {
      if (visited.has(parent)) throw new Error('项目层级不能形成循环。');
      visited.add(parent);
      const next = all.get(parent);
      if (!next || !activeProject(next)) throw new Error('父项目不存在或已删除，请先移动子项目。');
      parent = next.parent_project_id;
    }
    for (const edge of project.graph?.edges || []) {
      if (
        !graphNodeOf(all.get(edge.source) || {}, project.id) ||
        !graphNodeOf(all.get(edge.target) || {}, project.id)
      )
        throw new Error(
          '关系两端必须是同一项目的直接成员或直接子项目；不能连接子项目内部或其他项目的记录。请先移除相关连线。',
        );
    }
  }
}

export function projectTree(projects) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const visited = new Set(),
    result = [];
  function visit(project, depth, path) {
    if (visited.has(project.id)) return;
    visited.add(project.id);
    const title = [...path, project.title || '未命名项目'];
    result.push({ ...project, depth, breadcrumb: title.join(' / ') });
    for (const child of projects.filter((p) => p.parent_project_id === project.id))
      visit(child, depth + 1, title);
  }
  for (const project of projects.filter((p) => !byId.has(p.parent_project_id)))
    visit(project, 0, []);
  for (const project of projects) visit(project, 0, []);
  return result;
}

export async function setProjectMemberships(db, id, projectIds, { add = false } = {}) {
  const rows = await db.allRows();
  const row = rows.find((r) => r.id === id);
  if (
    !row ||
    row.record.kind === 'tombstone' ||
    row.record.deleted_at ||
    row.record.type === 'project'
  )
    throw new Error('请选择有效的记录。');
  for (const projectId of projectIds)
    if (!rows.some((r) => r.id === projectId && activeProject(r.record)))
      throw new Error('项目已不存在，请重新选择。');
  const ids = [...new Set(add ? [...row.record.project_ids, ...projectIds] : projectIds)];
  const updates = [
    {
      record: { ...row.record, project_ids: ids, updated_at: new Date().toISOString() },
      expectedRev: row.rev,
    },
  ];
  for (const p of rows) {
    if (p.record.type !== 'project' || !p.record.graph || ids.includes(p.id)) continue;
    const edges = p.record.graph.edges.filter((e) => e.source !== id && e.target !== id);
    if (edges.length !== p.record.graph.edges.length)
      updates.push({
        record: {
          ...p.record,
          graph: { ...p.record.graph, edges },
          updated_at: new Date().toISOString(),
        },
        expectedRev: p.rev,
      });
  }
  await db.saveMany(updates);
}

export async function saveProjectEdge(db, projectId, edge) {
  return db.mutate(projectId, (record) => {
    if (!activeProject(record)) throw new Error('项目已不存在。');
    const project = upgradeProject(record);
    return {
      ...project,
      graph: {
        ...project.graph,
        edges: [...project.graph.edges.filter((e) => e.id !== edge.id), edge],
      },
      updated_at: new Date().toISOString(),
    };
  });
}

export async function removeProjectEdge(db, projectId, edgeId) {
  return db.mutate(projectId, (record) => {
    const project = upgradeProject(record);
    return {
      ...project,
      graph: { ...project.graph, edges: project.graph.edges.filter((e) => e.id !== edgeId) },
      updated_at: new Date().toISOString(),
    };
  });
}
export async function saveProject(db, record, expectedRev) {
  const changes = [{ record, expectedRev }];
  for (const row of await db.allRows()) {
    if (row.id === record.id || !row.record.graph || row.id === record.parent_project_id) continue;
    const edges = row.record.graph.edges.filter(
      (e) => e.source !== record.id && e.target !== record.id,
    );
    if (edges.length !== row.record.graph.edges.length)
      changes.push({
        record: {
          ...row.record,
          graph: { ...row.record.graph, edges },
          updated_at: new Date().toISOString(),
        },
        expectedRev: row.rev,
      });
  }
  return db.saveMany(changes);
}

export const SCHEMA_VERSION = 5;
export const TYPES = {
  note: '普通记录',
  snapshot: '网页快照',
  list: '清单',
  website_group: '网页组',
};
export const LIST_ID = 'nexus-list';
const LEGACY_TYPES = {
  note: '随手记',
  web: '网页摘录',
  image: '图片',
  audio: '录音',
  web_chat: '对话链接',
  artifact: '产物',
  todo: '待办',
  project: '项目规则',
};
export const TASK_STATUSES = {
  backlog: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  archived: '已归档',
};
const MAX_CONTENT = 1_000_000;
const FIELDS = new Set([
  'schema_version',
  'id',
  'kind',
  'type',
  'title',
  'content',
  'summary',
  'purpose',
  'tags',
  'project_ids',
  'organization_state',
  'created_at',
  'updated_at',
  'deleted_at',
  'sources',
  'task_status',
  'keywords',
  'match_fields',
  'attachments',
  'snapshot',
  'list',
  'url_list',
  'parent_project_id',
  'graph',
  'favorite',
  'appearance',
]);
export const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'application/x-mimearchive': 'mhtml',
};
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export function normalizeAttachment(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some(
      (k) =>
        ![
          'id',
          'kind',
          'name',
          'mime_type',
          'size_bytes',
          'sha256',
          'path',
          'created_at',
          'duration_ms',
        ].includes(k),
    )
  )
    throw new Error('附件格式不正确。');
  const mime_type = string(input.mime_type, '附件类型', 100).split(';')[0].toLowerCase();
  if (
    !MIME_EXT[mime_type] ||
    !/^[a-f0-9]{64}$/.test(input.id) ||
    input.sha256 !== input.id ||
    input.kind !==
      (mime_type.startsWith('image/')
        ? 'image'
        : mime_type === 'application/x-mimearchive'
          ? 'snapshot'
          : 'audio') ||
    input.path !== `assets/${input.id}.${MIME_EXT[mime_type]}` ||
    !Number.isSafeInteger(input.size_bytes) ||
    input.size_bytes < 1 ||
    input.size_bytes > MAX_ASSET_BYTES
  )
    throw new Error('附件路径、类型、大小或校验值不正确（单附件最多 20 MB）。');
  if (input.duration_ms != null && (!Number.isFinite(input.duration_ms) || input.duration_ms < 0))
    throw new Error('录音时长不正确。');
  return {
    id: input.id,
    kind: input.kind,
    name: string(input.name, '附件名称', 500),
    mime_type,
    size_bytes: input.size_bytes,
    sha256: input.id,
    path: input.path,
    created_at: date(input.created_at, '附件时间'),
    duration_ms: input.duration_ms ?? null,
  };
}

function string(value, name, max = 1000) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${name}格式不正确或超过 ${max} 字符。`);
  return value;
}
function strings(value, name, max = 100) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name}格式不正确。`);
  return [...new Set(value.map((v) => string(v, name, 500).trim()).filter(Boolean))];
}
function date(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error(`${name}不是有效日期。`);
  return new Date(value).toISOString();
}
export function validId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}
export function normalizeRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('记录必须是 JSON 对象。');
  if (Number.isInteger(input.schema_version) && input.schema_version > SCHEMA_VERSION)
    throw new Error(
      `记录使用较新的数据格式版本 v${input.schema_version}，请升级 PKM Nexus 后再同步；本机内容仍保留。`,
    );
  if (![1, 2, 3, 4, 5].includes(input.schema_version) || !validId(input.id))
    throw new Error('记录版本或 ID 不受支持。');
  if (input.kind !== undefined && input.kind !== 'tombstone') throw new Error('记录形式不受支持。');
  for (const key of Object.keys(input))
    if (!FIELDS.has(key))
      throw new Error(`记录含有未支持的字段 ${key}，为避免丢失数据已停止处理。`);
  const created_at = date(input.created_at, '创建时间');
  if (input.kind === 'tombstone')
    return {
      schema_version: input.schema_version,
      id: input.id,
      kind: 'tombstone',
      created_at,
      deleted_at: date(input.deleted_at, '删除时间'),
    };
  if (
    !(input.schema_version === 5 && input.type === 'project') &&
    !Object.hasOwn(input.schema_version >= 3 ? TYPES : LEGACY_TYPES, input.type)
  )
    throw new Error('记录类型不受支持。');
  if (!['inbox', 'organized'].includes(input.organization_state))
    throw new Error('整理状态不正确。');
  const record = {
    schema_version: input.schema_version,
    id: input.id,
    type: input.type,
    title: string(input.title, '标题', 500),
    content: string(input.content, '正文', MAX_CONTENT),
    summary: string(input.summary, '摘要', 2000),
    purpose: string(input.purpose, '用途', 2000),
    tags: strings(input.tags, '标签'),
    project_ids: strings(input.project_ids, '项目'),
    organization_state: input.organization_state,
    created_at,
    updated_at: date(input.updated_at, '更新时间'),
    deleted_at: input.deleted_at == null ? null : date(input.deleted_at, '删除时间'),
    sources: [],
  };
  if (record.project_ids.some((id) => !validId(id))) throw new Error('项目 ID 不正确。');
  if (!Array.isArray(input.sources) || input.sources.length > 100)
    throw new Error('来源格式不正确。');
  record.sources = input.sources.map((source) => {
    if (!source || typeof source !== 'object') throw new Error('来源格式不正确。');
    if (Object.keys(source).some((key) => !['url', 'title', 'captured_at', 'kind'].includes(key)))
      throw new Error('来源包含未支持的字段，已停止处理以避免数据丢失。');
    const url = string(source.url, '来源 URL', 8000);
    if (url && !safeUrl(url)) throw new Error('来源仅支持不含登录凭证的 HTTP / HTTPS URL。');
    return {
      url,
      title: string(source.title, '来源标题', 1000),
      captured_at: date(source.captured_at, '收集时间'),
      kind: string(source.kind, '来源类型', 100),
    };
  });
  if (input.type === 'todo') {
    if (input.task_status != null && !Object.hasOwn(TASK_STATUSES, input.task_status))
      throw new Error('待办状态不正确。');
    record.task_status = input.task_status || 'backlog';
  }
  if (input.type === 'project' && input.schema_version < 5) {
    record.keywords = strings(input.keywords, '关键词');
    record.match_fields = strings(
      input.match_fields || ['title', 'content', 'tags', 'url'],
      '匹配范围',
      4,
    );
    if (record.match_fields.some((f) => !['title', 'content', 'tags', 'url'].includes(f)))
      throw new Error('关键词匹配范围不受支持。');
  }
  if (input.schema_version >= 2) {
    if (
      input.attachments != null &&
      (!Array.isArray(input.attachments) || input.attachments.length > 100)
    )
      throw new Error('附件列表不正确。');
    record.attachments = (input.attachments || []).map(normalizeAttachment);
    if (new Set(record.attachments.map((a) => a.id)).size !== record.attachments.length)
      throw new Error('附件 ID 重复。');
    record.task_status = input.type === 'todo' ? record.task_status : null;
    record.keywords = record.keywords || [];
    record.match_fields = record.match_fields || [];
  } else if (input.attachments?.length) throw new Error('含附件的记录须使用数据格式版本 2。');
  if (input.schema_version >= 3) {
    if (
      input.purpose !== undefined ||
      input.task_status !== undefined ||
      input.keywords !== undefined ||
      input.match_fields !== undefined
    )
      throw new Error('新版记录不包含用途、旧待办状态或项目规则字段。');
    delete record.purpose;
    delete record.task_status;
    delete record.keywords;
    delete record.match_fields;
    record.snapshot = normalizeSnapshot(input.snapshot, record.attachments);
    record.list = normalizeList(input.list || [], input.schema_version);
    record.url_list = normalizeUrls(input.url_list || []);
    if (record.id === LIST_ID && record.type !== 'list')
      throw new Error('固定清单 ID 不能用于其他记录类型。');
    if (input.schema_version >= 4 && record.type === 'list') record.title = '';
    if (record.type === 'list' && record.id !== LIST_ID)
      throw new Error('只有一份全局清单，请使用固定的清单入口。');
    if (
      (record.type !== 'list' && record.list.length) ||
      (record.type !== 'website_group' && record.url_list.length) ||
      (record.type !== 'snapshot' && record.snapshot)
    )
      throw new Error('记录类型与专用字段不一致。');
  }
  if (input.schema_version === 5 && input.type === 'project') {
    const parent = input.parent_project_id ?? null;
    if (parent !== null && (!validId(parent) || parent === input.id))
      throw new Error('父项目 ID 不正确，项目不能包含自己。');
    if (record.project_ids.length) throw new Error('项目层级请使用父项目，不能加入其他项目。');
    record.parent_project_id = parent;
    record.graph = normalizeGraph(input.graph || { edges: [] });
    if (input.appearance !== undefined) {
      if (
        !input.appearance ||
        Object.keys(input.appearance).some((key) => !['color', 'icon'].includes(key)) ||
        !/^#[a-f0-9]{6}$/i.test(input.appearance.color)
      )
        throw new Error('项目颜色格式不正确。');
      record.appearance = {
        color: input.appearance.color,
        icon: string(input.appearance.icon, '项目图标', 16),
      };
    }
  } else if (input.parent_project_id !== undefined || input.graph !== undefined)
    throw new Error('只有新版项目可以包含层级与关系图。');
  else if (input.appearance !== undefined) throw new Error('只有项目可设置项目外观。');
  if (input.favorite !== undefined) {
    if (input.schema_version < 5 || typeof input.favorite !== 'boolean')
      throw new Error('喜爱状态格式不正确。');
    record.favorite = input.favorite;
  }
  return record;
}
function normalizeGraph(graph) {
  if (
    !graph ||
    Object.keys(graph).some((key) => !['edges', 'positions'].includes(key)) ||
    !Array.isArray(graph.edges) ||
    graph.edges.length > 10000
  )
    throw new Error('项目关系图格式不正确。');
  const ids = new Set(),
    pairs = new Set();
  const result = {
    edges: graph.edges.map((edge) => {
      if (
        !edge ||
        Object.keys(edge).some((key) => !['id', 'source', 'target', 'label'].includes(key)) ||
        !validId(edge.id) ||
        !validId(edge.source) ||
        !validId(edge.target) ||
        edge.source === edge.target ||
        ids.has(edge.id)
      )
        throw new Error('关系 ID 或端点不正确，不能连接自身。');
      const pair = [edge.source, edge.target].sort().join(':');
      if (pairs.has(pair)) throw new Error('同一项目中的两条记录只能有一条关系，可编辑关系说明。');
      ids.add(edge.id);
      pairs.add(pair);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: string(edge.label, '关系说明', 200),
      };
    }),
  };
  if (graph.positions !== undefined) {
    if (
      !graph.positions ||
      typeof graph.positions !== 'object' ||
      Array.isArray(graph.positions) ||
      Object.keys(graph.positions).length > 10000
    )
      throw new Error('节点位置格式不正确。');
    result.positions = {};
    for (const [id, position] of Object.entries(graph.positions)) {
      if (
        !validId(id) ||
        !position ||
        Object.keys(position).some((k) => !['x', 'y'].includes(k)) ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        Math.abs(position.x) > 100000 ||
        Math.abs(position.y) > 100000
      )
        throw new Error('节点位置格式不正确。');
      Object.defineProperty(result.positions, id, {
        value: { x: position.x, y: position.y },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return result;
}
export function newRecord(values = {}) {
  const now = new Date().toISOString();
  const version = values.schema_version || (!Object.hasOwn(TYPES, values.type || 'note') ? 2 : 4),
    isList = version >= 3 && values.type === 'list';
  return normalizeRecord({
    schema_version: version,
    id: isList ? LIST_ID : crypto.randomUUID(),
    type: 'note',
    title: '',
    content: '',
    summary: '',
    ...(version < 3 ? { purpose: '' } : {}),
    tags: [],
    project_ids: [],
    organization_state: 'inbox',
    created_at: isList ? '2026-10-13T00:00:00.000Z' : now,
    updated_at: now,
    deleted_at: null,
    sources: [],
    attachments: [],
    ...values,
  });
}
export function normalizeList(items, version = 4) {
  if (!Array.isArray(items) || items.length > 5000) throw new Error('清单最多 5000 项。');
  const ids = new Set();
  return items.map((item) => {
    if (
      !item ||
      Object.keys(item).some(
        (k) => !['id', 'kind', 'text', 'is_checkbox', 'checked'].includes(k),
      ) ||
      !validId(item.id) ||
      ids.has(item.id) ||
      !['item', 'divider'].includes(item.kind) ||
      typeof item.is_checkbox !== 'boolean' ||
      typeof item.checked !== 'boolean'
    )
      throw new Error('清单项目格式不正确。');
    ids.add(item.id);
    return {
      id: item.id,
      kind: item.kind,
      text: version >= 4 && item.kind === 'divider' ? '' : string(item.text, '清单文字', 5000),
      is_checkbox: version >= 4 ? item.is_checkbox : item.kind === 'item' && item.is_checkbox,
      checked: item.kind === 'item' && item.is_checkbox && item.checked,
    };
  });
}
export function normalizeUrls(items) {
  if (!Array.isArray(items) || items.length > 1000) throw new Error('单组最多 1000 个网址。');
  const ids = new Set(),
    urls = new Set();
  return items.map((item) => {
    if (
      !item ||
      Object.keys(item).some(
        (k) => !['id', 'url', 'title', 'added_at', 'read_at', 'removed_at'].includes(k),
      ) ||
      !validId(item.id) ||
      ids.has(item.id) ||
      !safeUrl(string(item.url, '网址', 8000)) ||
      urls.has(urlKey(item.url))
    )
      throw new Error('网址列表包含无效或重复网址。');
    ids.add(item.id);
    urls.add(urlKey(item.url));
    return {
      id: item.id,
      url: safeUrl(item.url),
      title: string(item.title, '网页标题', 1000),
      added_at: date(item.added_at, '加入时间'),
      read_at: item.read_at == null ? null : date(item.read_at, '阅读时间'),
      ...(item.removed_at !== undefined
        ? { removed_at: item.removed_at == null ? null : date(item.removed_at, '网页删除时间') }
        : {}),
    };
  });
}
function normalizeSnapshot(value, attachments) {
  if (value == null) return null;
  if (
    Object.keys(value).some(
      (k) => !['url', 'title', 'captured_at', 'format', 'asset_id'].includes(k),
    ) ||
    !safeUrl(value.url) ||
    !['png', 'mhtml'].includes(value.format) ||
    !attachments.some(
      (a) =>
        a.id === value.asset_id &&
        (value.format === 'png'
          ? a.mime_type === 'image/png' && a.kind === 'image'
          : a.kind === 'snapshot'),
    )
  )
    throw new Error('网页快照缺少对应文件或格式不正确。');
  return {
    url: safeUrl(value.url),
    title: string(value.title, '快照标题', 1000),
    captured_at: date(value.captured_at, '快照时间'),
    format: value.format,
    asset_id: value.asset_id,
  };
}
export function upgradeRecord(input) {
  const old = normalizeRecord(input);
  if (old.kind === 'tombstone' || old.type === 'project' || old.schema_version >= 4) return old;
  if (old.schema_version === 3) return normalizeRecord({ ...old, schema_version: 4 });
  const { purpose, ...rest } = old;
  delete rest.task_status;
  delete rest.keywords;
  delete rest.match_fields;
  return newRecord({
    ...rest,
    schema_version: 4,
    type: 'note',
    content: `${old.content}${purpose ? `${old.content ? '\n\n' : ''}旧版备注：${purpose}` : ''}`,
    snapshot: null,
    list: [],
    url_list: [],
  });
}
export function displayType(type) {
  return TYPES[type] || (type === 'project' ? '项目' : TYPES.note);
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function digest(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function digestBytes(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '');
}
export function urlKey(value) {
  const valid = safeUrl(value);
  if (!valid) return '';
  const url = new URL(valid);
  for (const key of [...url.searchParams.keys()])
    if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
  return url.href;
}
export function recordPath(record) {
  if (!validId(record.id)) throw new Error('记录 ID 不正确。');
  return `records/${record.id.slice(0, 2)}/${record.id}.json`;
}
export function metadata(record, row = {}) {
  if (record.kind === 'tombstone')
    return {
      id: record.id,
      kind: 'tombstone',
      type: 'tombstone',
      title: '',
      created_at: record.created_at,
      updated_at: record.deleted_at,
      deleted_at: record.deleted_at,
      path: recordPath(record),
      ...row,
    };
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    summary: record.summary || record.content.slice(0, 160),
    tags: record.tags,
    project_ids: record.project_ids,
    favorite: !!record.favorite,
    organization_state: record.organization_state,
    created_at: record.created_at,
    updated_at: record.updated_at,
    deleted_at: record.deleted_at,
    sources: record.sources,
    attachments: record.attachments || [],
    snapshot: record.snapshot || null,
    list_preview: [
      ...(record.list || []).filter((i) => i.is_checkbox).slice(0, 5),
      ...(record.list || []).filter((i) => !i.is_checkbox).slice(0, 5),
    ],
    list_count: (record.list || []).length,
    checked_count: (record.list || []).filter((i) => i.is_checkbox && i.checked).length,
    url_preview: (record.url_list || []).slice(0, 5),
    url_count: (record.url_list || []).length,
    unread_count: (record.url_list || []).filter((i) => !i.read_at && !i.removed_at).length,
    task_status: record.task_status || '',
    keywords: record.keywords || [],
    match_fields: record.match_fields || [],
    ...(record.type === 'project' && record.schema_version === 5
      ? {
          parent_project_id: record.parent_project_id,
          graph: record.graph,
          ...(record.appearance ? { appearance: record.appearance } : {}),
        }
      : {}),
    path: recordPath(record),
    ...row,
  };
}
export function searchText(record) {
  if (record.kind === 'tombstone') return '';
  return [
    record.title,
    record.content,
    record.summary,
    record.purpose || '',
    ...(record.list || []).map((i) => i.text),
    ...(record.url_list || []).flatMap((u) => [u.url, u.title]),
    ...record.tags,
    ...record.sources.map((s) => s.url),
  ]
    .join('\n')
    .toLocaleLowerCase();
}
export function matchingProjects(record, projects) {
  if (record.kind === 'tombstone') return [];
  const values = {
    title: record.title,
    content: `${record.content}\n${record.summary}\n${(record.list || []).map((i) => i.text).join('\n')}\n${record.purpose || ''}`,
    tags: record.tags.join(' '),
    url: [...record.sources.map((s) => s.url), ...(record.url_list || []).map((u) => u.url)].join(
      ' ',
    ),
  };
  return projects.filter(
    (p) =>
      !p.deleted_at &&
      p.type === 'project' &&
      p.keywords.length &&
      p.keywords.some((k) =>
        p.match_fields.some((field) =>
          (values[field] || '').toLocaleLowerCase().includes(k.toLocaleLowerCase()),
        ),
      ),
  );
}
export function duplicateIds(catalog) {
  const groups = new Map(),
    result = new Set();
  for (const m of catalog) {
    if (m.deleted_at || m.type === 'project' || m.kind === 'tombstone') continue;
    for (const key of [
      ...(m.content_key ? [`body:${m.content_key}`] : m.url_keys.map((url) => `url:${url}`)),
    ]) {
      if (groups.has(key) && groups.get(key) !== m.id) {
        result.add(groups.get(key));
        result.add(m.id);
      } else groups.set(key, m.id);
    }
  }
  return result;
}
export function tombstone(record) {
  return normalizeRecord({
    schema_version: 4,
    id: record.id,
    kind: 'tombstone',
    created_at: record.created_at,
    deleted_at: new Date().toISOString(),
  });
}
export function toMarkdown(record) {
  if (record.kind === 'tombstone') return `<!-- 已移除当前内容：${record.id} -->`;
  const info = {
    id: record.id,
    type: record.type,
    tags: record.tags,
    project_ids: record.project_ids,
    favorite: !!record.favorite,
    ...(record.type === 'project'
      ? {
          parent_project_id: record.parent_project_id || null,
          graph: record.graph || { edges: [] },
        }
      : {}),
    organization_state: record.organization_state,
    created_at: record.created_at,
    updated_at: record.updated_at,
    deleted_at: record.deleted_at,
  };
  const title = (record.type === 'list' ? 'Todo / Idea' : record.title).replace(/[\r\n]/g, ' ');
  const listBody = record.list?.length
    ? [true, false]
        .map(
          (mode) =>
            `## ${mode ? 'Todo' : 'Idea'}\n\n` +
            record.list
              .filter((i) => i.is_checkbox === mode)
              .map((i) =>
                i.kind === 'divider'
                  ? '---'
                  : mode
                    ? `- [${i.checked ? 'x' : ' '}] ${i.text}`
                    : `- ${i.text}`,
              )
              .join('\n'),
        )
        .join('\n\n')
    : '';
  return `# ${title || '未命名记录'}\n\n<!-- PKM-Nexus metadata\n${JSON.stringify(info, null, 2)}\n-->\n\n${record.purpose ? `保存用途：${record.purpose || ''}\n\n` : ''}${record.type === 'project' && record.summary ? `${record.summary}\n\n` : ''}${record.content}${
    listBody && !(record.type === 'list' && record.content.trimEnd().endsWith(listBody.trimEnd()))
      ? '\n\n' + listBody
      : ''
  }${record.url_list?.length ? '\n\n' + record.url_list.map((u) => `- ${u.removed_at ? '~~' : ''}[${u.title || u.url}](${u.url})${u.removed_at ? '~~（已删除）' : ''}${u.read_at ? '（已读）' : ''}`).join('\n') : ''}${record.snapshot ? `\n\n${record.snapshot.format === 'png' ? '!' : ''}[页面快照](${record.attachments.find((a) => a.id === record.snapshot.asset_id)?.path})` : ''}\n\n${record.sources.map((s) => `来源：${s.url}\n收集时间：${s.captured_at}`).join('\n\n')}`;
}

import { digest } from './model.js';

export const TAG_LIBRARY_ID = 'guga-tag-library';
export const TAG_GROUPS = 'ui:tag-groups';
export const TAG_STYLES = 'ui:tag-styles';
export const TAG_REVISION = 'library:tags:revision';

export function normalizeTagLibrary(input) {
  if (
    !input ||
    input.id !== TAG_LIBRARY_ID ||
    input.type !== 'tag_library' ||
    input.version !== 1 ||
    !Array.isArray(input.definitions) ||
    input.definitions.length > 10000 ||
    Object.keys(input).some(
      (key) => !['id', 'type', 'version', 'title', 'definitions'].includes(key),
    )
  )
    throw new Error('标签定义格式不正确。');
  const names = new Set();
  const definitions = input.definitions
    .map((item) => {
      if (
        !item ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        item.name !== item.name.trim() ||
        item.name.length > 100 ||
        /[,，\n\r]/.test(item.name) ||
        names.has(item.name) ||
        typeof item.description !== 'string' ||
        item.description.length > 2000 ||
        !/^#[0-9a-f]{6}$/i.test(item.color) ||
        Object.keys(item).some((key) => !['name', 'color', 'description'].includes(key))
      )
        throw new Error('标签名称、颜色或描述不正确。');
      names.add(item.name);
      return { name: item.name, color: item.color.toLowerCase(), description: item.description };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { id: TAG_LIBRARY_ID, type: 'tag_library', version: 1, title: '标签定义', definitions };
}

export function tagLibraryFromState(groups = [], styles = {}) {
  return normalizeTagLibrary({
    id: TAG_LIBRARY_ID,
    type: 'tag_library',
    version: 1,
    definitions: [...new Set([...groups, ...Object.keys(styles)])].map((name) => ({
      name,
      color: styles[name]?.color || '#285f49',
      description: styles[name]?.description || '',
    })),
  });
}

export function writeTagLibrary(store, input, revision) {
  const record = normalizeTagLibrary(input);
  store.put({ key: TAG_GROUPS, value: record.definitions.map((item) => item.name) });
  store.put({
    key: TAG_STYLES,
    value: Object.fromEntries(
      record.definitions.map(({ name, color, description }) => [name, { color, description }]),
    ),
  });
  store.put({ key: TAG_REVISION, value: revision });
}

export async function prepareTagLibrary(input) {
  const record = normalizeTagLibrary(input);
  return { record, hash: await digest(record) };
}

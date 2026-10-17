import { normalizeRecord, normalizeAttachment, digestBytes } from './model.js';
import { StaleEditError } from './db.js';
export const EXAMPLES_VISIBLE = 'onboarding:examples-visible';
const resource = (path) => new URL(`../examples/${path}`, import.meta.url).href;

export async function loadExamples(fetchImpl = fetch) {
  const response = await fetchImpl(resource('catalog.json'));
  if (!response.ok) throw new Error('内置示例目录不可用，请重新加载扩展。');
  const data = await response.json();
  if (
    data.format !== 'pkm-nexus-examples' ||
    data.version !== 1 ||
    !Array.isArray(data.examples) ||
    data.examples.length > 20
  )
    throw new Error('内置示例格式不正确。');
  const ids = new Set(),
    recordIds = new Set();
  return data.examples.map((example) => {
    const record = normalizeRecord(example.record);
    if (
      !/^[a-z0-9-]{1,60}$/.test(example.id) ||
      ids.has(example.id) ||
      recordIds.has(record.id) ||
      !['note', 'snapshot'].includes(record.type) ||
      record.kind === 'tombstone' ||
      record.deleted_at ||
      record.project_ids.length ||
      typeof example.title !== 'string' ||
      example.title.length > 100 ||
      typeof example.description !== 'string' ||
      example.description.length > 1000
    )
      throw new Error('内置示例数据不正确。');
    ids.add(example.id);
    recordIds.add(record.id);
    return { ...example, record };
  });
}
export async function loadExampleAsset(value, fetchImpl = fetch) {
  const descriptor = normalizeAttachment(value);
  const response = await fetchImpl(resource(descriptor.path));
  if (!response.ok) throw new Error('内置示例附件不可用，请重新加载扩展。');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== descriptor.size_bytes || (await digestBytes(bytes)) !== descriptor.id)
    throw new Error('内置示例附件校验失败，未保存。');
  return new Blob([bytes], { type: descriptor.mime_type });
}
export async function saveExample(db, example, { fetchImpl = fetch } = {}) {
  const { saved } = await saveExamples(db, [example], { fetchImpl });
  return { status: saved ? 'saved' : 'already-saved', id: example.record.id };
}
export async function saveExamples(db, examples, { fetchImpl = fetch } = {}) {
  const records = examples.map((example) => ({ record: normalizeRecord(example.record) }));
  for (let attempt = 0; ; attempt++) {
    const plan = await db.previewImport({
      format: 'pkm-nexus-backup',
      schema_version: 4,
      records,
    });
    const added = plan.entries.filter((entry) => entry.status === 'new');
    if (!added.length) return { saved: 0, existing: records.length };
    const descriptors = new Map(
      added.flatMap(({ record }) => record.attachments.map((asset) => [asset.id, asset])),
    );
    plan.assets = await Promise.all(
      [...descriptors.values()].map(async (descriptor) => {
        const blob = await loadExampleAsset(descriptor, fetchImpl);
        const existing = await db.getAsset(descriptor.id);
        return {
          ...existing,
          id: descriptor.id,
          descriptor: existing?.descriptor || descriptor,
          blob,
        };
      }),
    );
    try {
      // All new examples and verified media are committed in one transaction.
      await db.applyImport(plan);
      return { saved: added.length, existing: records.length - added.length };
    } catch (error) {
      // A second window may have imported a subset. Re-plan without overwriting
      // it, including edited, archived or deleted copies of the same IDs.
      if (!(error instanceof StaleEditError) || attempt >= 2) throw error;
    }
  }
}

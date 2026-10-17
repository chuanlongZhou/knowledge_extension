import { upgradeRecord, newRecord, normalizeText } from './model.js';
export async function captureInto(db, values, { force = false } = {}) {
  const record = newRecord({ ...values, organization_state: 'inbox' });
  if (!record.title && !record.content && !record.sources.length && !record.attachments?.length)
    throw new Error('请填写笔记或添加附件。');
  const matches = force ? [] : await db.duplicates(record);
  if (matches.length) {
    await db.enqueueCapture(record, matches);
    return { status: 'duplicate', id: record.id };
  }
  await db.save(record, { expectedRev: 0 });
  return { status: 'saved', id: record.id };
}
export async function appendCapture(db, targetId, capture) {
  const old = await db.get(targetId);
  if (!old) throw new Error('原记录已不存在，请另存。');
  const record = upgradeRecord(old.record);
  if (record.kind === 'tombstone') throw new Error('该记录的正文已移除，请另存。');
  const sourceKeys = new Set(record.sources.map((s) => s.url));
  for (const source of capture.record.sources)
    if (!sourceKeys.has(source.url)) {
      record.sources.push(source);
      sourceKeys.add(source.url);
    }
  if (
    capture.record.content &&
    normalizeText(capture.record.content) !== normalizeText(record.content)
  )
    record.content += `${record.content ? '\n\n---\n\n' : ''}${capture.record.content}`;
  record.tags = [...new Set([...record.tags, ...capture.record.tags])];
  record.updated_at = new Date().toISOString();
  record.deleted_at = null;
  record.schema_version = Math.max(4, record.schema_version);
  record.attachments = [
    ...new Map(
      [...(record.attachments || []), ...(capture.record.attachments || [])].map((a) => [a.id, a]),
    ).values(),
  ];
  await db.finishCapture(capture.id, record, old.rev);
}

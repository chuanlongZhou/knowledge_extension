import { singletonList, listDocument } from './collections.js';
import { StaleEditError } from './db.js';
import { upgradeRecord } from './model.js';
export async function editStartList(db, operation) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await singletonList(db),
      record = upgradeRecord(row.record),
      list = operation(structuredClone(record.list));
    try {
      await db.save(
        {
          ...record,
          list,
          attachments: record.attachments.filter(
            (a) =>
              a.storage !== 'drive' ||
              list.some((item) => item.kind === 'item' && item.id === a.item_id),
          ),
          content: listDocument(list, record.content, record.list),
          updated_at: new Date().toISOString(),
        },
        { expectedRev: row.rev },
      );
      return;
    } catch (error) {
      if (!(error instanceof StaleEditError) || attempt === 4) throw error;
    }
  }
}

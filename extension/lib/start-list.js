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

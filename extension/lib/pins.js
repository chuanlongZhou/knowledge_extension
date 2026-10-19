export const PINNED_RECORDS = 'ui:pinned-records';

export async function togglePinnedRecord(db, id) {
  await navigator.locks.request('pkm-nexus:pinned-records', async () => {
    const pins = await db.getState(PINNED_RECORDS, []);
    await db.setState(
      PINNED_RECORDS,
      pins.includes(id) ? pins.filter((pin) => pin !== id) : [id, ...pins],
    );
  });
}

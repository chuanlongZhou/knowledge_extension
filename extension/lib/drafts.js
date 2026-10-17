// Synchronous recovery bridges document teardown before IndexedDB can finish a draft write.
const cacheKey = (key) => `pkm:recovery:${key}`;
export function cacheDraft(key, value) {
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify(value));
  } catch {
    /* IndexedDB remains the durable fallback. */
  }
}
export function cachedDraft(key) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(key)));
  } catch {
    return null;
  }
}
export async function clearDraft(db, key) {
  try {
    localStorage.removeItem(cacheKey(key));
  } catch {
    /* Storage may be unavailable. */
  }
  await db.setState(key, null);
}

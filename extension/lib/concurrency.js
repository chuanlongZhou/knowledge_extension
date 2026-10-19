// Drain in-flight work before rejecting so a failed sync cannot keep writing in the background.
export async function mapConcurrent(items, limit, task) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('并发数量无效。');
  const results = new Array(items.length);
  let next = 0,
    failure,
    failed = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && next < items.length) {
        const index = next++;
        try {
          results[index] = await task(items[index], index);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw failure;
  return results;
}

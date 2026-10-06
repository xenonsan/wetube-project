const dedupeTtlMs = 24 * 60 * 60 * 1000;
const maxDedupeEntries = 10000;

export function createWatchHistoryRequestDeduper() {
  const requests = new Map();

  function prune(now) {
    for (const [key, entry] of requests) {
      if (!entry.promise && entry.expiresAt <= now) requests.delete(key);
    }
    while (requests.size > maxDedupeEntries) {
      const oldestCompleted = Array.from(requests).find(([, entry]) => !entry.promise);
      if (!oldestCompleted) break;
      requests.delete(oldestCompleted[0]);
    }
  }

  return async function runOnce(key, operation) {
    const now = Date.now();
    prune(now);
    const existing = requests.get(key);
    if (existing) {
      existing.expiresAt = now + dedupeTtlMs;
      const result = existing.promise ? await existing.promise : existing.result;
      return { ...result, duplicate: true };
    }

    const entry = { promise: null, result: null, expiresAt: now + dedupeTtlMs };
    entry.promise = Promise.resolve().then(operation);
    requests.set(key, entry);

    try {
      const result = await entry.promise;
      entry.result = result;
      entry.promise = null;
      entry.expiresAt = Date.now() + dedupeTtlMs;
      prune(Date.now());
      return result;
    } catch (error) {
      if (requests.get(key) === entry) requests.delete(key);
      throw error;
    }
  };
}

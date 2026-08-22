type Entry = { value: unknown; expires: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Memoise an async fetch for `ttlMs`. Concurrent callers share one in-flight
 * promise, so a page that asks for the same series twice pays for it once.
 * Process-local and lost on restart, which is all a single-user app needs.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = fn()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Drop cached values whose key starts with `prefix` (or everything). */
export function invalidate(prefix = ""): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

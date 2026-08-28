type Entry = { value: unknown; expires: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * How many entries the cache will hold.
 *
 * This was an unbounded Map with no eviction, which was defensible while the
 * only host was a server that restarts: keys are time-bucketed, so a stale
 * entry was never read again, and the process died long before the wasted
 * memory mattered. Phase 4 changed the assumption it was written under. An
 * Android process lives for weeks, and every hour of every day adds keys that
 * are already unreadable.
 *
 * A thousand is far above what any screen asks for in a session and far below
 * what would trouble a phone. Eviction takes the entries closest to expiry
 * first, which for time-bucketed keys means the oldest buckets — exactly the
 * ones nothing will ask for again.
 */
const MAX_ENTRIES = 1000;

function evict(now: number): void {
  for (const [key, entry] of store) if (entry.expires <= now) store.delete(key);
  if (store.size <= MAX_ENTRIES) return;
  const byExpiry = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires);
  for (const [key] of byExpiry.slice(0, store.size - MAX_ENTRIES)) store.delete(key);
}

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
      const now = Date.now();
      store.set(key, { value, expires: now + ttlMs });
      if (store.size > MAX_ENTRIES) evict(now);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** How many entries are held. For the test that proves the bound holds. */
export function cacheSize(): number {
  return store.size;
}

/** Drop cached values whose key starts with `prefix` (or everything). */
export function invalidate(prefix = ""): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

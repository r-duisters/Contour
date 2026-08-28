type Entry = { value: unknown; expires: number };

const store_ = new Map<string, Entry>();
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
  for (const [key, entry] of store_) if (entry.expires <= now) store_.delete(key);
  if (store_.size <= MAX_ENTRIES) return;
  const byExpiry = [...store_.entries()].sort((a, b) => a[1].expires - b[1].expires);
  for (const [key] of byExpiry.slice(0, store_.size - MAX_ENTRIES)) store_.delete(key);
}

/**
 * Memoise an async fetch for `ttlMs`. Concurrent callers share one in-flight
 * promise, so a page that asks for the same series twice pays for it once.
 * Process-local and lost on restart, which is all a single-user app needs.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store_.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = fn()
    .then((value) => {
      const now = Date.now();
      store_.set(key, { value, expires: now + ttlMs });
      if (store_.size > MAX_ENTRIES) evict(now);
      persist();
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Somewhere to keep the cache between runs, when the host has one.
 *
 * A server process lives for weeks and an in-memory Map is the whole story
 * there. A phone's process is killed whenever Android feels like it, so every
 * launch was a cold start that re-fetched everything — including a *three-year
 * daily FX series*, which is immutable history that had already been
 * downloaded. That is what "it renews all the data on every boot" was.
 *
 * Injected rather than reached for: this package has no `localStorage` and
 * must not grow one. The device attaches its own in `providers.tsx`.
 */
export type CacheStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const PERSIST_KEY = "contour:cache";
/**
 * Bumped whenever the stored shape changes. A blob written by an older version
 * is discarded rather than read, which is what heals a device that already has
 * one — version 1 stored `Map` values through plain `JSON.stringify`, and a Map
 * serialises to `{}`. The FX rates came back as an empty object, `.get` was not
 * a function, and every valuation threw.
 */
const PERSIST_VERSION = 2;
/**
 * Values above this are held in memory but never written. A month of klines is
 * worth keeping; a whole market board is not worth the write on every set, and
 * `localStorage` is a synchronous API on the UI thread.
 */
const MAX_PERSISTED_BYTES = 256 * 1024;

let persistent: CacheStore | null = null;

/**
 * Hydrate from the store and write through to it from now on.
 *
 * Expired entries are dropped on the way in rather than trusted: a TTL means
 * the same thing across a restart as within one, and a cache that resurrects
 * yesterday's prices would be worse than an empty one.
 */
export function attachCacheStore(store: CacheStore, now = Date.now()): void {
  persistent = store;
  try {
    const raw = store.getItem(PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw, reviver) as { version?: number; entries?: Record<string, Entry> };
    if (parsed?.version !== PERSIST_VERSION || !parsed.entries) {
      store.removeItem(PERSIST_KEY);
      return;
    }
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (entry && typeof entry.expires === "number" && entry.expires > now) {
        store_.set(key, entry);
      }
    }
  } catch {
    // Unreadable or written by an older shape: start empty rather than throw.
    try { store.removeItem(PERSIST_KEY); } catch { /* nothing to do */ }
  }
}

/** For tests, and for a host that stops offering storage. */
export function detachCacheStore(): void {
  persistent = null;
}

/**
 * `Map` and `Set` survive the round trip; nothing else exotic may be cached.
 *
 * Not generality for its own sake — `fetchEcbRates` caches a
 * `Map<number, number>` of exchange rates by day, and a Map is exactly what
 * plain JSON destroys most quietly: `JSON.stringify(new Map([[1, 2]]))` is
 * `"{}"`, so it comes back as an object that has lost every entry *and* every
 * method. `cache.test.ts` pins both types; a value of any other exotic kind
 * would be stored wrongly and must not be put through `cached()`.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { __type: "Map", entries: [...value.entries()] };
  if (value instanceof Set) return { __type: "Set", values: [...value.values()] };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "__type" in value) {
    const tagged = value as { __type: string; entries?: [unknown, unknown][]; values?: unknown[] };
    if (tagged.__type === "Map") return new Map(tagged.entries ?? []);
    if (tagged.__type === "Set") return new Set(tagged.values ?? []);
  }
  return value;
}

function persist(): void {
  if (!persistent) return;
  try {
    const out: Record<string, Entry> = {};
    for (const [key, entry] of store_) {
      const size = JSON.stringify(entry.value, replacer).length;
      if (size <= MAX_PERSISTED_BYTES) out[key] = entry;
    }
    persistent.setItem(PERSIST_KEY, JSON.stringify({ version: PERSIST_VERSION, entries: out }, replacer));
  } catch {
    // Full or blocked storage costs speed on the next launch, never data.
  }
}

/** How many entries are held. For the test that proves the bound holds. */
export function cacheSize(): number {
  return store_.size;
}

/** Drop cached values whose key starts with `prefix` (or everything). */
export function invalidate(prefix = ""): void {
  for (const key of store_.keys()) if (key.startsWith(prefix)) store_.delete(key);
  persist();
}

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
 * What may be written, per entry and in total.
 *
 * The per-entry cap started at 256 KB and quietly did the opposite of its job.
 * A full BTC daily history is 283,715 characters as `Bar[]`, so the single
 * most expensive thing in the cache — four sequential requests to rebuild —
 * was the one entry always dropped, while cheap ones were kept. Measured, not
 * guessed: `histdaily` at 108,898 survived a restart and `klines` did not.
 *
 * So the per-entry cap is now large enough to admit it, and a *total* budget
 * does the job the per-entry cap was pretending to. A browser gives an origin
 * roughly 5 MB; 3 MB leaves room for everything else this app stores and for
 * the fact that the quota counts UTF-16 code units, not bytes.
 */
const MAX_PERSISTED_BYTES = 1024 * 1024;
const TOTAL_BUDGET_CHARS = 3 * 1024 * 1024;

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
  flushCache();
  persistent = null;
}

/**
 * Write now rather than on the next tick.
 *
 * The coalescing below means a burst of `cached()` calls costs one write, at
 * the price of a window in which the newest entries are only in memory. A host
 * that knows it is about to be killed — an app going to the background — can
 * close that window; so can a test that wants to read what it just wrote.
 */
export function flushCache(): void {
  scheduled = false;
  persistNow();
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

/**
 * Writes are coalesced, because `persist()` serialises the whole store.
 *
 * It is called on every `set`, and a startup does a dozen of them: measured at
 * 6.1 MB of `JSON.stringify` to end up with a 1 MB blob, 198ms on a desktop
 * and worse on a phone's UI thread, growing with the square of the cache. One
 * write after the burst says exactly the same thing.
 *
 * A process killed before the timer fires loses the last write, which costs a
 * refetch and never data — the same trade the cache makes everywhere else.
 */
let scheduled = false;

function persist(): void {
  if (!persistent || scheduled) return;
  scheduled = true;
  if (typeof setTimeout === "function") {
    setTimeout(() => { scheduled = false; persistNow(); }, 0);
    return;
  }
  scheduled = false;
  persistNow();
}

function persistNow(): void {
  if (!persistent) return;
  try {
    /*
     * Longest-lived first, then fill until the budget is gone.
     *
     * Something has to be dropped when there is more cache than room, and the
     * entry with the most life left is the one whose loss costs most — it is
     * the one that would still have been answering questions tomorrow.
     */
    const ordered = [...store_.entries()].sort((a, b) => b[1].expires - a[1].expires);
    const out: Record<string, Entry> = {};
    let total = 0;
    for (const [key, entry] of ordered) {
      const size = JSON.stringify(entry.value, replacer).length;
      if (size > MAX_PERSISTED_BYTES) continue;
      if (total + size > TOTAL_BUDGET_CHARS) continue;
      out[key] = entry;
      total += size;
    }
    persistent.setItem(PERSIST_KEY, JSON.stringify({ version: PERSIST_VERSION, entries: out }, replacer));
  } catch {
    // Over quota despite the budget, or storage blocked outright. Drop what is
    // there rather than leaving a half-written blob behind: a stale entry that
    // survives while its neighbours do not is worse than starting cold, and
    // the next `persist()` will try again with whatever is in memory then.
    try { persistent.removeItem(PERSIST_KEY); } catch { /* nothing left to do */ }
  }
}

/**
 * What is held under a key, without computing it if it is not.
 *
 * `cached()` cannot answer "is this already here?" — it takes a function and
 * runs it on a miss, which is the wrong question when a caller has a *cheaper*
 * answer available. The chart uses it to notice that a wider window is already
 * in memory and slice that instead of asking the network for a subset of what
 * it already has.
 */
export function peek<T>(key: string, now = Date.now()): T | undefined {
  const hit = store_.get(key);
  return hit && hit.expires > now ? (hit.value as T) : undefined;
}

/** Store a value a caller computed itself. `cached()`'s other half. */
export function put<T>(key: string, value: T, ttlMs: number, now = Date.now()): void {
  store_.set(key, { value, expires: now + ttlMs });
  if (store_.size > MAX_ENTRIES) evict(now);
  persist();
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

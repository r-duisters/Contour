import { upstreamFor, type Upstream } from "./upstreams";

/**
 * Logos, fetched once and kept on the phone.
 *
 * `IconSource` is synchronous, because `CoinIcon` needs a value for an
 * `<img src>` during render and cannot await one. So this is a store rather
 * than a function: a render asks what it has, gets a local file or null, and
 * a miss schedules the fetch that will make the next render different.
 * `providers.tsx` subscribes and re-renders the tree when one lands.
 *
 * **Cache, not data.** `Directory.Cache` because Android may evict it under
 * storage pressure and losing a logo costs a refetch and nothing else. It is
 * also outside `files/`, so it can never reach the Google backup that
 * `device-backup.ts` deliberately limits to one file.
 *
 * **A failure is remembered for the session and no longer.** A CDN that is
 * down would otherwise cost a request per render, and a ticker marked absent
 * on disk would keep its initials after the network came back. In memory, the
 * next launch tries again; within a launch nothing retries.
 *
 * Everything is injected so this can be tested without a phone — the pattern
 * `capacitor-net.ts` already uses for the same reason.
 */

type Ext = "svg" | "png";

export type IconDeps = {
  /** GET the bytes, base64-encoded. Null for any answer that is not artwork. */
  fetchBase64: (url: string) => Promise<string | null>;
  /** Persist the bytes under `name`. */
  write: (name: string, base64: string) => Promise<void>;
  /** Something an `<img src>` can load, for a file that is already there. */
  srcFor: (name: string) => Promise<string>;
  /** What is already on disk from a previous launch. */
  list: () => Promise<string[]>;
};

/** Known local sources. A null value is "asked, nothing to show". */
const known = new Map<string, string | null>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A number that changes whenever a logo arrives, for `useSyncExternalStore`. */
export function snapshot(): number {
  return version;
}

const extensionOf = (u: Upstream): Ext => (u.source === "spothq" ? "svg" : "png");

/**
 * Adopt whatever a previous launch left behind.
 *
 * Without this the first render after every cold start would refetch
 * everything held — which is the request this whole feature is meant to make
 * rare, since each one names an asset to a CDN.
 */
export async function hydrate(deps: IconDeps): Promise<void> {
  try {
    for (const file of await deps.list()) {
      const dot = file.lastIndexOf(".");
      if (dot <= 0) continue;
      const ticker = file.slice(0, dot).toUpperCase();
      if (!known.has(ticker)) known.set(ticker, await deps.srcFor(file));
    }
    changed();
  } catch {
    // A cache that will not enumerate is an empty cache, not a broken app.
  }
}

/**
 * What to draw for a ticker right now, and a fetch if the answer is nothing.
 *
 * Called during render, so it must not set state synchronously: the fetch is
 * queued as a microtask and the notification happens when it resolves. Every
 * caller for the same ticker joins the one request.
 */
export function resolve(
  ticker: string,
  assetType: "crypto" | "equity" | "cash" | undefined,
  deps: IconDeps,
): string | null {
  const key = ticker.toUpperCase();
  if (known.has(key)) return known.get(key) ?? null;
  if (inFlight.has(key)) return null;

  const upstream = upstreamFor(key, assetType);
  if (!upstream) { known.set(key, null); return null; }

  inFlight.add(key);
  queueMicrotask(() => void (async () => {
    try {
      const base64 = await deps.fetchBase64(upstream.url);
      if (base64) {
        const name = `${key}.${extensionOf(upstream)}`;
        await deps.write(name, base64);
        known.set(key, await deps.srcFor(name));
      }
      // A failure sets nothing, so the next launch will try again. Within this
      // one `inFlight` keeps it from being asked twice.
    } catch {
      // Same: initials now, another attempt next launch.
    } finally {
      changed();
    }
  })());

  return null;
}

/** Test seam. The store is module-level, which two tests must not share. */
export function reset(): void {
  known.clear();
  inFlight.clear();
  version = 0;
}

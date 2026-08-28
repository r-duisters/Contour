"use client";

import { useEffect, useState, type ReactNode } from "react";
import ContourMark from "@/ui/ContourMark";
import MarkTile from "@/components/MarkTile";
import { DataClientProvider } from "@/data/client/context";
import { DEVICE_ROUTING, RoutingProvider } from "@/components/routing";
import { SaveFileProvider } from "@/components/save-file";
import { IconSourceProvider } from "@/components/CoinIcon";
import { DEVICE_ICON_SOURCE } from "../lib/icon-source";
import { DEVICE_SAVE_FILE } from "../lib/save-file";
import type { DataClient } from "@/data/client/data-client";
// Relative, not `@/lib/deps`: in this app `@/lib/*` points at packages/core,
// the way packages/ui refers to itself. This app's own modules are reached
// directly, which also makes it obvious which side of the seam a file is on.
import { client } from "../lib/deps";
import { attachCacheStore, flushCache } from "@/lib/cache";

/**
 * The device build's answer to "where does data come from": SQLite and
 * CapacitorHttp, through the same `DataClient` every screen already takes from
 * context. This is the only file in the app that names an implementation —
 * `apps/web/src/app/providers.tsx` says the swap is the point, and this is it.
 *
 * It cannot build the client at module scope the way the web one does: opening
 * a database is asynchronous and it must be migrated before anything reads it.
 * So there is a state before the first client exists, and the app shows its own
 * mark rather than the word "Loading" — the design audit removed those once.
 */
export default function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<DataClient | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Before the first request, so the cache is warm when the screens ask.
    //
    // A server process lives for weeks and keeps this in memory; a phone's is
    // killed whenever Android likes, so every launch re-fetched everything the
    // last one had — a three-year daily FX series among it, which is history
    // and cannot change. Attached here rather than inside the package because
    // `packages/core` has no `localStorage` and must not grow one.
    try { attachCacheStore(localStorage); } catch { /* blocked storage: cold every time */ }

    /*
     * Write the cache down before Android takes the process.
     *
     * Writes are coalesced onto the next tick, so the newest entries live only
     * in memory for a moment. Backgrounding is the moment before a kill, and
     * it is the last chance to keep them — losing them costs a refetch on the
     * next launch, which is the whole thing the cache exists to avoid.
     */
    const flush = () => { if (document.visibilityState === "hidden") flushCache(); };
    document.addEventListener("visibilitychange", flush);

    let cancelled = false;
    client()
      .then((c) => { if (!cancelled) setReady(c); })
      // A database that will not open is the one failure with nothing behind
      // it to degrade to: every screen's data lives there. Saying so beats a
      // splash that never ends.
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);

  if (failed) {
    return (
      <main className="flex-1 flex items-center justify-center p-8 text-center">
        <div>
          <ContourMark size={64} />
          <p className="mt-4 text-sm text-neutral-400">Contour could not open its database.</p>
          <p className="mt-1 text-xs text-neutral-500">Reopening the app usually clears this.</p>
        </div>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="flex-1 flex items-center justify-center p-8">
        <MarkTile size={112} breathing />
      </main>
    );
  }

  // The device spells the asset page as a query, because a static export
  // cannot have a dynamic segment. See `routing.tsx`.
  return (
    <RoutingProvider routing={DEVICE_ROUTING}>
      {/* An `<a download>` cannot start a download here, so exports are
          written to the cache and handed to the share sheet. */}
      <SaveFileProvider save={DEVICE_SAVE_FILE}>
        {/* Bundled logos, not a CDN: the phone talking to one would tell it
            what is held, which is exactly what the web build's proxy exists
            to prevent. */}
        <IconSourceProvider source={DEVICE_ICON_SOURCE}>
          <DataClientProvider client={ready}>{children}</DataClientProvider>
        </IconSourceProvider>
      </SaveFileProvider>
    </RoutingProvider>
  );
}

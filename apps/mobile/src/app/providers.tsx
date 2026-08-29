"use client";

import { useEffect, useState, type ReactNode } from "react";
import MarkTile from "@/components/MarkTile";
import Button from "@/components/Button";
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
  // Which go this is. Nothing is retried automatically — the count exists so
  // the screen can stop repeating advice that has already been followed once.
  const [attempt, setAttempt] = useState(0);

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
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  // Separate from the cache wiring above, and keyed on the attempt: a retry
  // re-runs the open and nothing else. Re-attaching the cache or the
  // visibility listener on every press would be a leak per press.
  useEffect(() => {
    let cancelled = false;
    client()
      .then((c) => { if (!cancelled) setReady(c); })
      // A database that will not open is the one failure with nothing behind
      // it to degrade to: every screen's data lives there. Saying so beats a
      // splash that never ends.
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  /*
   * The splash held still, not a second screen.
   *
   * This drew a bare `ContourMark` at 64 while the splash a moment earlier
   * drew `MarkTile` at 112, so the app changed identity at the instant it
   * failed — the one moment it should look most like itself. Same mark, same
   * size, same place: only the breathing stops, and the words and the action
   * arrive underneath.
   *
   * And it is an action now. "Reopening the app usually clears this" asked a
   * person to do by hand the one thing the screen could do itself, and the
   * commonest cause — a duplicate native connection after a full document
   * load — is cleared by exactly that retry.
   */
  if (failed) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
        <MarkTile size={112} />
        <div>
          <p className="text-sm text-neutral-400">Contour could not open its database.</p>
          <p className="mt-1 text-xs text-neutral-500 max-w-xs">
            {attempt === 0
              ? "Nothing is lost — the file is still on this phone."
              : "Still not opening. Close Contour completely, then open it again."}
          </p>
        </div>
        <Button
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
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

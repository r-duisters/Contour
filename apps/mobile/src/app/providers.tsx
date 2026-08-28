"use client";

import { useEffect, useState, type ReactNode } from "react";
import ContourMark from "@/ui/ContourMark";
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
    let cancelled = false;
    client()
      .then((c) => { if (!cancelled) setReady(c); })
      // A database that will not open is the one failure with nothing behind
      // it to degrade to: every screen's data lives there. Saying so beats a
      // splash that never ends.
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
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
        <span className="rounded-full bg-blue-600 flex items-center justify-center"
              style={{ width: 112, height: 112 }}>
          <ContourMark size={96} breathing />
        </span>
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

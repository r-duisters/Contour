"use client";

import type { ReactNode } from "react";
import { DataClientProvider } from "@/data/client/context";
import { HttpClient } from "@/data/client/http-client";
import { WebNet } from "@/lib/net/web-net";
import { IconSourceProvider } from "@/components/CoinIcon";
import { WEB_ICON_SOURCE } from "@/lib/icon-source";

/**
 * The web build's answer to "where does data come from": the same routes as
 * before, reached through one client instead of thirty-six `fetch` calls.
 *
 * Built at module scope, not inside the component, so a re-render of the root
 * layout does not hand every consumer a new client identity and re-run every
 * effect that depends on it. Nothing here is per-request — `HttpClient` holds
 * no state, and `WebNet` is a thin wrapper over `fetch`.
 *
 * Phase 4's APK swaps this file, and only this file, for a `LocalClient` over
 * SQLite. That is the point.
 */
const client = HttpClient(WebNet());

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <IconSourceProvider source={WEB_ICON_SOURCE}>
      <DataClientProvider client={client}>{children}</DataClientProvider>
    </IconSourceProvider>
  );
}

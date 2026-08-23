"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DataClient } from "./data-client";

/**
 * How a screen gets its `DataClient` without naming one.
 *
 * The whole phase turns on this: `apps/web` mounts an `HttpClient`, the APK
 * will mount a `LocalClient`, and the screens between them are identical. A
 * component that imported an implementation instead would work perfectly in a
 * browser and be dead weight on a device.
 *
 * This is the one `.tsx` in `packages/data` — a client component, hence the
 * directive. It brings in React and nothing else; the package still reaches the
 * outside world only through the ports.
 */
const Ctx = createContext<DataClient | null>(null);

export function DataClientProvider({
  client,
  children,
}: {
  client: DataClient;
  children: ReactNode;
}) {
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useDataClient(): DataClient {
  const client = useContext(Ctx);
  // Returning `undefined` here would push the failure into whichever screen
  // called a method on it — a `TypeError` several frames from the mistake,
  // which is forgetting to mount the provider.
  if (!client) {
    throw new Error(
      "useDataClient() was called outside a <DataClientProvider>. Mount one above this screen — apps/web does it in app/providers.tsx.",
    );
  }
  return client;
}

"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { IconSourceProvider } from "@/components/CoinIcon";
import type { IconSource } from "@/components/icon-source";
import { DEVICE_ICON_DEPS } from "./icons/device-icons";
import { hydrate, resolve, snapshot, subscribe } from "./icons/icon-cache";

/**
 * Logos on the device: fetched on demand, kept in the cache directory.
 *
 * The app used to ship 274 of them inside the APK. It stopped because we have
 * no right to redistribute most of them — CoinGecko's terms name logos
 * explicitly, and parqet states none at all — and the licence question is the
 * one thing bundling could never fix. `docs/asset-logos.md` has the whole
 * argument, including what it costs.
 *
 * **The subscription is what makes a synchronous source work.** `IconSource`
 * returns a string for an `<img src>` and cannot await one, so a first render
 * gets null and draws initials. When the logo lands, the store's version
 * changes, this re-renders, and a *new* source function goes into context —
 * a new identity, so every `CoinIcon` below re-reads. Passing the same
 * function would change nothing on screen and the logo would appear only when
 * something else happened to re-render.
 *
 * **`useMemo` on `version`, and it is load-bearing rather than an
 * optimisation.** This app compiles with the React Compiler, which is free to
 * memoise a closure that reads nothing reactive — and it did. Measured on an
 * emulator: the logos were fetched and written to the cache correctly, and the
 * screen kept drawing initials until the app was restarted, at which point all
 * nine appeared from disk. The fetch was never the broken half. Naming
 * `version` as a dependency is what ties the closure's identity to the store,
 * and a `void version` statement is not enough because the compiler may drop
 * it.
 */
export function DeviceIcons({ children }: { children: ReactNode }) {
  const version = useSyncExternalStore(subscribe, snapshot, () => 0);

  // Adopt whatever the last launch fetched, before anything asks. Without it
  // every cold start refetches the whole portfolio's worth of logos, which is
  // the request this design exists to make rare.
  useEffect(() => { void hydrate(DEVICE_ICON_DEPS); }, []);

  const source: IconSource = useMemo(() => (symbol, assetType, base) => {
    const ticker = (assetType === "equity" ? symbol : base).toUpperCase();
    return resolve(ticker, assetType, DEVICE_ICON_DEPS);
  }, [version]);

  return <IconSourceProvider source={source}>{children}</IconSourceProvider>;
}

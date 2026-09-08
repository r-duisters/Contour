"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { assetOf } from "@/lib/symbols";
import { DEVICE_ROUTING } from "@/components/routing";

/**
 * Tapping an alert lands on the asset it names, not two navigations away.
 *
 * Two notification paths, two channels in:
 *
 * - The foreground pass posts through `LocalNotifications`, whose own
 *   `localNotificationActionPerformed` listener hands the `extra` back.
 * - The background runner posts through the patched background-runner plugin,
 *   whose tap intent carries the `extra` to `MainActivity`. That side is a
 *   *pull*: the payload is collected through `NotificationTapPlugin.consume()`
 *   on mount, on coming back to the foreground, and when MainActivity rings
 *   the `contourNotificationTap` window event — because a cold start has no
 *   page to push to at the moment the tap happens.
 *
 * A payload without a symbol is a portfolio-wide notice: the app opens on the
 * portfolio anyway, so there is nowhere better to go and no navigation
 * happens. An alert's crypto symbol is the Binance pair — the documented
 * exception in CLAUDE.md — so `assetOf` strips it back to the asset the page
 * is addressed by.
 */
export default function NotificationTaps() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const go = (extra: unknown) => {
      const { symbol, assetType } = (extra ?? {}) as { symbol?: string; assetType?: string };
      if (!symbol) return;
      const type = assetType === "equity" ? "equity" : "crypto";
      const asset = type === "crypto" ? assetOf(symbol) : symbol;
      const href = DEVICE_ROUTING.assetHref(asset, type, undefined);
      if (href) router.push(href);
    };

    const consume = async () => {
      try {
        const { Capacitor, registerPlugin } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const plugin = registerPlugin<{ consume(): Promise<{ extra: string | null }> }>("NotificationTap");
        const { extra } = await plugin.consume();
        if (cancelled || !extra) return;
        go(JSON.parse(extra));
      } catch {
        // A browser, or nothing pending: opening normally is the right answer.
      }
    };

    let removeListener: (() => void) | null = null;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform() || cancelled) return;
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const handle = await LocalNotifications.addListener(
          "localNotificationActionPerformed",
          (performed) => go(performed.notification.extra),
        );
        if (cancelled) void handle.remove();
        else removeListener = () => void handle.remove();
      } catch {
        // No plugin here; the foreground pass could not have notified either.
      }
    })();

    void consume();
    const onRing = () => void consume();
    const onVisible = () => { if (document.visibilityState === "visible") void consume(); };
    window.addEventListener("contourNotificationTap", onRing);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      removeListener?.();
      window.removeEventListener("contourNotificationTap", onRing);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}

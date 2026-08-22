"use client";

import { useEffect } from "react";

type Alert = {
  id: string;
  kind: "indicator" | "price_target" | "pct_move";
  symbol: string | null;
  params: Record<string, unknown>;
  enabled: boolean;
};

/**
 * Keeps the background runner supplied.
 *
 * The runner executes with the app closed, in a runtime that cannot reach this
 * app's session or its API. So whenever the app is open, the alert rules are
 * copied into the shared key store, where the runner reads them on its next
 * wake. Indicator alerts are left out: they need the full daily history to
 * evaluate, which is not work for a phone on a fifteen-minute timer.
 */
export default function BackgroundAlerts() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || cancelled) return;

      const [{ BackgroundRunner }, { LocalNotifications }] = await Promise.all([
        import("@capacitor/background-runner"),
        import("@capacitor/local-notifications"),
      ]);

      // Android 13 and later will not post anything without this.
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") await LocalNotifications.requestPermissions();

      const alerts: Alert[] = await fetch("/api/alerts")
        .then((r) => (r.ok ? r.json() : { alerts: [] }))
        .then((d) => d.alerts ?? [])
        .catch(() => []);
      if (cancelled) return;

      const rules = alerts
        .filter((a) => a.enabled && a.symbol && a.kind !== "indicator")
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          symbol: a.symbol,
          direction: a.params.direction as string | undefined,
          price: a.params.price as number | undefined,
          threshold: a.params.threshold as number | undefined,
        }));

      try {
        await BackgroundRunner.dispatchEvent({
          label: "app.contour.local.alerts",
          event: "setRules",
          details: { rules },
        });
      } catch {
        // The runner may not be registered yet on first launch; the next
        // foreground pass will try again.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return null;
}

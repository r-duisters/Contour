"use client";

import { useEffect } from "react";
import { useDataClient } from "@/data/client/context";
import { expandRules, type AlertRule } from "@/lib/alert-rules";
import { KEYS } from "@/lib/storage-keys";

type Alert = AlertRule & { timeframe: string };

/**
 * Runs an alert check every time the app comes to the foreground, and keeps
 * the background runner supplied for when it is not.
 *
 * The order matters, and used to be the other way round. This component was a
 * courier: it copied rules into the runner's key store and evaluated nothing,
 * so every notification depended on Android choosing to wake a fifteen-minute
 * job — which it does when it feels like it, and on a battery-optimised phone
 * often never. The result was a month of silence that read as "nothing
 * triggered".
 *
 * **Opening the app is the one moment that is guaranteed**, so it now carries
 * the feature. Two paths, and they are not the same check:
 *
 * - **Foreground** asks the server to evaluate, which is the better check by
 *   some distance: it dedupes on a database unique constraint rather than a
 *   key store, it can afford the 1,460 bars an indicator alert needs, and it
 *   dispatches through every notifier configured — Home Assistant, Web Push,
 *   FCM. None of that is reachable from a phone on its own. What it was
 *   missing was never the logic; it was a trigger that reliably happens.
 * - **The runner** is the fallback for when the app is shut, and stays a
 *   fallback. It gets the cheap rules, already expanded, and posts local
 *   notifications itself.
 *
 * Both can fire for one condition, since their dedupe stores are different
 * machines. A duplicate notification is a far cheaper failure than a silence,
 * which is the whole argument of this component.
 */
export default function BackgroundAlerts() {
  const client = useDataClient();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || cancelled) return;

      const { LocalNotifications } = await import("@capacitor/local-notifications");
      // Android 13 and later will not post anything without this.
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") await LocalNotifications.requestPermissions();
      if (cancelled) return;

      const alerts: Alert[] = await fetch("/api/alerts")
        .then((r) => (r.ok ? r.json() : { alerts: [] }))
        .then((d) => d.alerts ?? [])
        .catch(() => []);
      if (cancelled) return;

      // Hand the runner the rules already expanded. It cannot do this itself:
      // it has no imports, and resolving "every holding" needs a valuation.
      // Before this, a portfolio-scoped rule was dropped by a `a.symbol &&`
      // filter here and never reached the runner at all.
      if (alerts.length) {
        void dispatchToRunner(expandRules(alerts, await heldSymbols(alerts)));
      }
      if (cancelled) return;

      // The evaluation that counts. Its own dedupe means calling it on every
      // foreground is safe — a standing condition notifies once, not once per
      // launch — so this needs no marks of its own.
      const ran = await fetch("/api/cron/evaluate").then((r) => r.ok).catch(() => false);
      if (ran && !cancelled) markChecked();
    }

    /**
     * What a portfolio-scoped rule means by "every holding".
     *
     * Only asked for when such a rule exists — this is a valuation request,
     * and most alerts name their own symbol.
     */
    async function heldSymbols(alerts: Alert[]): Promise<string[]> {
      const ids = [...new Set(
        alerts.filter((a) => !a.symbol && a.portfolioId).map((a) => a.portfolioId!),
      )];
      const symbols = new Set<string>();
      for (const id of ids) {
        try {
          const valuation = await client.getValuation(id);
          for (const h of valuation.holdings) if (h.quantity > 0) symbols.add(h.symbol);
        } catch {
          // A portfolio that cannot be valued contributes no rules, rather
          // than failing the check for the alerts that name a symbol.
        }
      }
      return [...symbols];
    }

    const run = () => void check().catch(() => {
      // A failed check is silence, and silence is what this feature exists to
      // prevent — but it recovers on the next foreground, and the last-checked
      // line is what makes the gap visible in the meantime.
    });

    run();
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client]);

  return null;
}

async function dispatchToRunner(rules: unknown[]): Promise<void> {
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    await BackgroundRunner.dispatchEvent({
      label: "app.contour.local.alerts",
      event: "setRules",
      details: { rules },
    });
  } catch {
    // The runner may not be registered yet on first launch; the next
    // foreground pass tries again.
  }
}

/** When a check last completed, for the alerts screen to show. */
function markChecked(): void {
  try {
    localStorage.setItem(KEYS.alertsLastChecked, JSON.stringify(Date.now()));
  } catch {
    // blocked storage: the line reads "not checked", which is the safe error
  }
}

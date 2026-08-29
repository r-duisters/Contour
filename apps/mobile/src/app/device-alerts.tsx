"use client";

import { useEffect } from "react";
import { useDataClient } from "@/data/client/context";
import { baselines, priceSymbols } from "@/data/services/alert-pricing";
import { evaluatePctMove, evaluatePriceTarget } from "@/lib/alerts";
import { forgetOldMarks, shouldNotify } from "@/lib/alert-rules";
import { KEYS } from "@/lib/storage-keys";
import { CapacitorNet } from "../lib/net/capacitor-net";

const DAY_MS = 86_400_000;

/**
 * Alerts that fire on a phone with no server behind them.
 *
 * The web build asks its server to evaluate, because the server is what can
 * reach Home Assistant, web-push and FCM. None of that exists here — and none
 * of it is needed for the two kinds a phone can check. `alert-rules.ts` has
 * been pure since it was written, `alert-pricing.ts` takes a `Net`, and
 * `LocalNotifications` posts the result without asking anyone.
 *
 * Deliberately not FCM. Push needs a Firebase project, Google, and a server to
 * push *from* — the dependency the local-first direction in `CLAUDE.md` rules
 * out as a requirement. A check on every foreground needs none of it.
 *
 * The honest limit is the same one the alerts screen states: this runs when the
 * app is opened. A target hit and reverted while the app was shut is missed,
 * and nothing here can change that without a server.
 */
export default function DeviceAlerts() {
  const client = useDataClient();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || cancelled) return;
      if (!client.listAlerts) return;

      const alerts = (await client.listAlerts().catch(() => [])).filter((a) => a.enabled);
      if (cancelled || alerts.length === 0) return;

      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") await LocalNotifications.requestPermissions();
      if (cancelled) return;

      const settings = await client.getSettings().catch(() => null);
      const net = CapacitorNet();
      const wanted = alerts.map((a) => ({
        symbol: a.symbol!,
        assetType: a.assetType === "equity" ? ("equity" as const) : ("crypto" as const),
      }));

      const [prices, base] = await Promise.all([
        priceSymbols(net, settings ?? {}, wanted),
        // Only fetched when something needs it: a portfolio of price targets
        // should not pay for a day of history it will not read.
        alerts.some((a) => a.kind === "pct_move")
          ? baselines(net, settings ?? {}, wanted)
          : Promise.resolve<Record<string, number>>({}),
      ]);
      if (cancelled) return;

      const sent = readJson<Record<string, number>>(KEYS.alertsSent, {});
      const day = Math.floor(Date.now() / DAY_MS);
      let id = Date.now() % 100_000;

      for (const alert of alerts) {
        const price = prices[alert.symbol!];
        if (price === undefined) continue;
        const params = alert.params as { direction?: string; price?: number; threshold?: number };

        if (alert.kind === "price_target" && typeof params.price === "number") {
          const direction = params.direction === "below" ? "below" : "above";
          if (!evaluatePriceTarget({ direction, price: params.price }, price)) continue;
          const key = `t:${alert.id}`;
          if (!shouldNotify(sent, key, day)) continue;
          await notify(id++, `${alert.symbol} ${direction} ${params.price}`, `Now ${price}`);
          sent[key] = day;
          // One-shot, as the form promises: a target that keeps firing every
          // time the app opens is not what "tell me when it crosses" meant.
          await client.deleteAlert?.(alert.id).catch(() => {});
        } else if (alert.kind === "pct_move" && typeof params.threshold === "number") {
          const was = base[alert.symbol!];
          if (was === undefined) continue;
          const hit = evaluatePctMove({ threshold: params.threshold }, was, price);
          if (!hit) continue;
          const key = `m:${alert.id}:${hit.direction}`;
          if (!shouldNotify(sent, key, day)) continue;
          await notify(
            id++,
            `${alert.symbol} ${hit.direction} ${Math.abs(hit.pct).toFixed(1)}%`,
            `Now ${price}`,
          );
          sent[key] = day;
        }
      }

      writeJson(KEYS.alertsSent, forgetOldMarks(sent, day));
      writeJson(KEYS.alertsLastChecked, Date.now());
    }

    const run = () => void check().catch(() => {
      // A failed check is silence, which is what this feature exists to
      // prevent — but the last-checked line makes the gap visible, and the
      // next foreground tries again.
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

async function notify(id: number, title: string, body: string): Promise<void> {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.schedule({ notifications: [{ id, title, body }] });
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked storage costs a repeated notification, never a missed one.
  }
}

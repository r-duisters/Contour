"use client";

import { useEffect } from "react";
import { useDataClient } from "@/data/client/context";
import { baselines, priceSymbols } from "@/data/services/alert-pricing";
import { evaluatePctMove, evaluatePriceTarget } from "@/lib/alerts";
import { expandRules, forgetOldMarks, shouldNotify, type AlertRule, type HeldAsset } from "@/lib/alert-rules";
import type { AlertSummary, DataClient } from "@/data/client/data-client";
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
 * Paired with `public/runner/alerts.js`, which Android wakes on a schedule so
 * the app does not have to be open. That runner is the fallback and this is
 * the check that is guaranteed: a wake Android never grants costs nothing here
 * because opening the app runs this. Both write dedupe marks in the same
 * shape but to different stores — CapacitorKV there, localStorage here — so a
 * single condition can notify once from each. That is the deliberate trade: a
 * duplicate is a far cheaper failure than a silence.
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

      /*
       * Expanded, not filtered.
       *
       * This read `a.symbol!` straight off the row, so a portfolio-scoped rule
       * — the one the setup flow now creates, whose whole meaning is "every
       * holding" — arrived with symbol null and priced `undefined`. It has
       * never fired here. `expandRules` is what turns one such row into one
       * check per holding, and it is what the background runner is handed too,
       * so the two cannot disagree about what a rule means.
       */
      const rules = expandRules(alerts.flatMap(asRule), await heldAssets(client, alerts));
      if (cancelled || rules.length === 0) return;

      const settings = await client.getSettings().catch(() => null);
      const net = CapacitorNet();
      const wanted = rules.map((r) => ({ symbol: r.symbol, assetType: r.assetType }));

      const [prices, base] = await Promise.all([
        priceSymbols(net, settings ?? {}, wanted),
        // Only fetched when something needs it: a portfolio of price targets
        // should not pay for a day of history it will not read.
        rules.some((r) => r.kind === "pct_move")
          ? baselines(net, settings ?? {}, wanted)
          : Promise.resolve<Record<string, number>>({}),
      ]);
      if (cancelled) return;

      // The runner cannot work out "every holding" — it has no imports and no
      // valuation — so it is handed the same expansion this check uses.
      void dispatchToRunner(rules, settings);

      const sent = readJson<Record<string, number>>(KEYS.alertsSent, {});
      const day = Math.floor(Date.now() / DAY_MS);
      let id = Date.now() % 100_000;

      for (const rule of rules) {
        const price = prices[rule.symbol];
        if (price === undefined) continue;

        if (rule.kind === "price_target" && rule.price !== undefined) {
          const direction = rule.direction ?? "above";
          if (!evaluatePriceTarget({ direction, price: rule.price }, price)) continue;
          const key = `t:${rule.id}`;
          if (!shouldNotify(sent, key, day)) continue;
          await notify(id++, `${rule.name} ${direction} ${rule.price}`, `Now ${price}`);
          sent[key] = day;
          // One-shot, as the form promises: a target that keeps firing every
          // time the app opens is not what "tell me when it crosses" meant.
          // Only a rule that named its own symbol is deleted — a portfolio-wide
          // rule is not one target, and one holding reaching a level is no
          // reason to stop watching the others.
          if (!rule.id.includes(":")) await client.deleteAlert?.(rule.id).catch(() => {});
        } else if (rule.kind === "pct_move" && rule.threshold !== undefined) {
          const was = base[rule.symbol];
          if (was === undefined) continue;
          const hit = evaluatePctMove({ threshold: rule.threshold }, was, price);
          if (!hit) continue;
          const key = `m:${rule.id}:${hit.direction}`;
          if (!shouldNotify(sent, key, day)) continue;
          await notify(
            id++,
            `${rule.name} ${hit.direction} ${Math.abs(hit.pct).toFixed(1)}%`,
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

/**
 * The client's row as the expander wants it.
 *
 * `AlertSummary.kind` is a bare string — the interface deliberately does not
 * enumerate what the alerts page may store — so a row whose kind this build
 * cannot evaluate is dropped here rather than cast into one it can. An
 * indicator alert reaching `expandRules` would be dropped there too; doing it
 * at the boundary means the cast never has to be written.
 */
function asRule(a: AlertSummary): AlertRule[] {
  if (a.kind !== "price_target" && a.kind !== "pct_move") return [];
  return [{
    id: a.id,
    kind: a.kind,
    symbol: a.symbol,
    assetType: a.assetType === "equity" ? "equity" : "crypto",
    portfolioId: a.portfolioId,
    params: a.params,
    enabled: a.enabled,
  }];
}

/**
 * What a portfolio-scoped rule means by "every holding", and how to price each.
 *
 * Only asked for when such a rule exists — this is a valuation, and most
 * alerts name their own symbol. The valuation is also the only thing that
 * knows which holdings are shares: a ticker cannot say, and guessing sends AMD
 * to Binance as AMDUSDT.
 */
async function heldAssets(
  client: DataClient,
  alerts: { symbol?: string | null; portfolioId?: string | null }[],
): Promise<HeldAsset[]> {
  const ids = [...new Set(
    alerts.filter((a) => !a.symbol && a.portfolioId).map((a) => a.portfolioId!),
  )];
  const bySymbol = new Map<string, HeldAsset>();
  for (const id of ids) {
    try {
      const valuation = await client.getValuation(id);
      for (const h of valuation.holdings) {
        if (h.quantity > 0 && h.assetType !== "cash") {
          bySymbol.set(h.symbol, { symbol: h.symbol, assetType: h.assetType });
        }
      }
    } catch {
      // A portfolio that cannot be valued contributes no rules, rather than
      // failing the check for the alerts that name a symbol.
    }
  }
  return [...bySymbol.values()];
}

/**
 * Hand the schedule-driven runner the same rules this check just used.
 *
 * It runs in Capacitor's background runtime: no DOM, no imports, no database.
 * Everything it needs has to be pushed into its key store while the app is
 * open, which is here.
 */
async function dispatchToRunner(
  rules: unknown[],
  settings: { equityProvider?: string | null; equityApiKey?: string | null } | null,
): Promise<void> {
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    await BackgroundRunner.dispatchEvent({
      label: "app.contour.standalone.alerts",
      event: "setRules",
      details: { rules, settings: settings ?? {} },
    });
  } catch {
    // The runner may not be registered yet on first launch; the next
    // foreground pass tries again.
  }
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

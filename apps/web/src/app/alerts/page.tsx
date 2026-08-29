"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import SymbolPicker from "@/components/SymbolPicker";
import { quoteAsset } from "@/components/CoinIcon";
import { Bell, Pause, Play, Plus, Trash2 } from "lucide-react";
import Button from "@/components/Button";
import { field } from "@/components/field";
import EmptyState from "@/components/EmptyState";
import PageLabel from "@/components/PageLabel";
import LastChecked from "@/components/LastChecked";
import { KEYS, readKey } from "@/lib/storage-keys";

type Alert = {
  id: string;
  kind: "indicator" | "price_target" | "pct_move";
  symbol: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  timeframe: string;
  params: Record<string, unknown>;
  enabled: boolean;
  lastEvaluated: string | null;
};

type PortfolioRow = { id: string; name: string };

/**
 * The threshold the suggested portfolio-wide alert uses.
 *
 * Ten percent in a day is rare enough on an equity to mean something and
 * common enough on a coin to fire a few times a year — which is the band
 * where a notification is still read rather than dismissed.
 */
const DEFAULT_SWING = 10;

/**
 * `useSearchParams` opts a client page out of static prerendering unless it
 * sits behind Suspense, and this page is prerendered. The fallback is never
 * really seen — the parameter is known on the first client render.
 */
export default function AlertsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <Alerts />
    </Suspense>
  );
}

function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  /**
   * An asset page can send you here with its own ticker: `?symbol=ETHUSDT`.
   *
   * A link rather than a form over there, deliberately. The alerts routes are
   * server-only by design — `CLAUDE.md` lists them among the endpoints the
   * mobile build will never call — so an inline form would need either a
   * DataClient method that contradicts that, or an exemption in
   * `screen-boundary.test.ts`. This costs one tap and no debt, and it lands on
   * the full form rather than a reduced copy of it that would drift.
   */
  const asked = useSearchParams().get("symbol");
  /**
   * What the asset page said this is, when it sent us here.
   *
   * The alert has to record its own kind: a US ticker carries no exchange
   * suffix, so `AMD` cannot be told from a coin by looking at it, and guessing
   * sends it to Binance as `AMDUSDT` — a symbol that may answer with an
   * unrelated token's price. Firing on the wrong number is worse than not
   * firing. Absent (someone typed a ticker here), a dot is the only signal
   * left, and it is right for the European listings that have one.
   */
  const askedType = useSearchParams().get("type");
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [kind, setKind] = useState<Alert["kind"]>(asked ? "price_target" : "indicator");
  const [symbol, setSymbol] = useState(asked?.toUpperCase() || "BTCUSDT");
  const [assetType, setAssetType] = useState<"crypto" | "equity">(
    askedType === "equity" ? "equity" : askedType === "crypto" ? "crypto"
      : (asked ?? "").includes(".") ? "equity" : "crypto",
  );
  const [timeframe, setTimeframe] = useState("1h");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [targetPrice, setTargetPrice] = useState("");
  const [threshold, setThreshold] = useState("5");
  const [scope, setScope] = useState<"symbol" | "portfolio">("symbol");
  const [portfolioId, setPortfolioId] = useState("");
  const [error, setError] = useState<string | null>(null);
  /**
   * When a check last ran, from either machine that runs one.
   *
   * The server stamps `lastEvaluated` on every alert it evaluates; the device
   * writes a mark when its foreground check completes. Neither alone is the
   * answer — a phone in aeroplane mode has only the first, a browser has only
   * ever seen the second if it is the APK — so the line reports the later of
   * the two. What a person wants to know is whether *anything* checked.
   */
  const deviceChecked = useSyncExternalStore(
    // The mark is written by BackgroundAlerts, in this same document, so there
    // is nothing to subscribe to beyond the reloads this screen already does.
    () => () => {},
    () => readKey(KEYS.alertsLastChecked),
    () => null,
  );
  const serverChecked = alerts
    .map((a) => (a.lastEvaluated ? Date.parse(a.lastEvaluated) : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const lastChecked = Math.max(serverChecked, Number(deviceChecked) || 0) || null;

  async function load() {
    const d = await fetch("/api/alerts").then((r) => r.json());
    setAlerts(d.alerts);
  }
  useEffect(() => {
    load();
    fetch("/api/portfolios").then((r) => r.json()).then((d) => {
      setPortfolios(d.portfolios);
      setPortfolioId((cur) => cur || (d.portfolios[0]?.id ?? ""));
    });
  }, []);

  async function create() {
    setError(null);
    let body: Record<string, unknown>;
    if (kind === "indicator") {
      body = { kind, symbol, timeframe };
    } else if (kind === "price_target") {
      const price = Number(targetPrice);
      if (!Number.isFinite(price) || price <= 0) { setError("Enter a target price."); return; }
      body = { kind, symbol, assetType, params: { direction, price } };
    } else {
      const t = Number(threshold);
      if (!Number.isFinite(t) || t <= 0) { setError("Enter a % threshold."); return; }
      body = {
        kind,
        params: { threshold: t },
        ...(scope === "symbol" ? { symbol, assetType } : { portfolioId }),
      };
      if (scope === "portfolio" && !portfolioId) { setError("Pick a portfolio."); return; }
    }
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { setError("Failed to create alert."); return; }
    await load();
  }

  /**
   * Whether anything already watches a whole portfolio for a swing.
   *
   * A per-symbol pct_move does not count: it covers the one asset it names,
   * and the gap this fills is the coin bought last week that nobody thought
   * to add an alert for.
   */
  const needsSwingAlert =
    portfolios.length > 0 &&
    !alerts.some((a) => a.kind === "pct_move" && a.portfolioId !== null);

  async function addSwingAlert() {
    const target = portfolioId || portfolios[0]?.id;
    if (!target) return;
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "pct_move",
        portfolioId: target,
        params: { threshold: DEFAULT_SWING },
      }),
    });
    if (!res.ok) { setError("Failed to create alert."); return; }
    await load();
  }

  async function toggle(a: Alert) {
    await fetch(`/api/alerts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    await load();
  }

  async function remove(a: Alert) {
    // The trailing ellipsis on the button promises this.
    if (!window.confirm(`Delete the alert “${describe(a)}”?`)) return;
    await fetch(`/api/alerts/${a.id}`, { method: "DELETE" });
    await load();
  }

  async function evaluateNow() {
    await fetch("/api/cron/evaluate");
    await load();
  }

  const input = field();

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <PageLabel icon={Bell}>Alerts</PageLabel>
      </div>

      {/*
        Offered, not seeded.
        Portfolio-wide swing alerts have worked since the pct_move kind was
        added — the model carries a portfolioId, the evaluator expands it over
        every held symbol — and nobody had ever made one, because making one
        means knowing the kind exists and picking the right scope. This is the
        same alert the form builds, in one tap.

        It creates nothing on its own. A self-hosted tool that starts pushing
        notifications through Home Assistant without being asked is worse than
        one you have to switch on.
      */}
      {!suggestionDismissed && needsSwingAlert && (
        <div className="border border-neutral-800 rounded p-3 mb-6">
          <p className="text-sm mb-1">Nothing watches the portfolio as a whole</p>
          <p className="text-xs text-neutral-500 mb-3">
            A {DEFAULT_SWING}% move in a day on any holding would go unnoticed. One
            alert covers every symbol you hold, and follows the holdings as they change.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={addSwingAlert}>Add swing alert</Button>
            <Button variant="secondary" onClick={() => setSuggestionDismissed(true)}>
              Not now
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as Alert["kind"])}>
          <option value="indicator">Indicator signal</option>
          <option value="price_target">Price target</option>
          <option value="pct_move">Move over 24h</option>
        </select>

        {kind === "pct_move" && (
          <select className={input} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="symbol">One symbol</option>
            <option value="portfolio">Whole portfolio</option>
          </select>
        )}

        {(kind !== "pct_move" || scope === "symbol") && (
          <SymbolPicker className={`${input} uppercase w-28`} value={symbol} onChange={setSymbol} />
        )}
        {/*
          Which venue prices it. Shown for the two kinds that read a live
          price; an indicator alert is Binance klines by definition.

          Asked rather than inferred, because a US ticker gives nothing away:
          AMD and ADA look alike and only one of them is a coin.
        */}
        {kind !== "indicator" && (kind !== "pct_move" || scope === "symbol") && (
          <select
            aria-label="Asset type"
            className={input}
            value={assetType}
            onChange={(e) => setAssetType(e.target.value as "crypto" | "equity")}
          >
            <option value="crypto">Crypto</option>
            <option value="equity">Stock / ETF</option>
          </select>
        )}
        {kind === "pct_move" && scope === "portfolio" && (
          <select className={input} value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
            {portfolios.length === 0 && <option value="">— no portfolios —</option>}
            {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        {kind === "indicator" && (
          <select className={input} value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            {["1m","5m","15m","1h","4h","1d"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {kind === "price_target" && (
          <>
            <select className={input} value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="above">Crosses above</option>
              <option value="below">Crosses below</option>
            </select>
            <input className={`${input} w-32`} value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)}
                   placeholder={quoteAsset(symbol) ? `Price (${quoteAsset(symbol)})` : "Price"}
                   inputMode="decimal" />
          </>
        )}
        {kind === "pct_move" && (
          <label className="flex items-center gap-1 text-sm text-neutral-400">
            ±<input className={`${input} w-16`} value={threshold} onChange={(e) => setThreshold(e.target.value)}
                    inputMode="decimal" /> %
          </label>
        )}

        <Button onClick={create}><Plus size={14} aria-hidden />Create</Button>
        <Button variant="secondary" onClick={evaluateNow}>
          <Play size={14} aria-hidden />Evaluate now
        </Button>
      </div>
      <div className="mt-3 mb-4">
        <LastChecked at={lastChecked} />
        {/*
          Documentation, not a permission.

          Play prohibits an app from requesting exemption from battery
          optimisation unless its core function requires it, and a portfolio
          tracker does not qualify. So this declares no permission and fires no
          intent — it tells a person where the setting is and lets them decide.
          Writing it down is not restricted; asking for it would be.

          Framed as improving the odds, because that is all it does. Android
          makes no promise about a background job either way.
        */}
        <details className="mt-2">
          <summary className="text-xs text-neutral-500 cursor-pointer">
            Why background checks are missed
          </summary>
          <div className="text-xs text-neutral-500 mt-2 space-y-2 max-w-prose">
            <p>
              Android decides when a closed app may run. On a phone that is managing
              its battery, a fifteen-minute job can be delayed for hours or skipped
              for days, and the app is not told.
            </p>
            <p>
              Excluding Contour from battery optimisation improves the odds. It
              does not guarantee anything, and Android offers no setting that would.
              In Android Settings, open Apps, choose Contour, then Battery, and
              select Unrestricted.
            </p>
            <p>
              Opening the app always runs a check, so the surest way to catch up is
              to open it.
            </p>
          </div>
        </details>
      </div>
      {error && <p className="text-xs text-red-500 mb-4">{error}</p>}
      {kind === "price_target" && (
        <p className="text-xs text-neutral-500 mb-4">Price targets are one-shot: the alert disables itself after firing.</p>
      )}
      <div className="mb-6" />

      <ul className="divide-y divide-neutral-800">
        {alerts.map((a) => (
          <li key={a.id} className="py-3 flex items-center gap-3 text-sm flex-wrap">
            <span className="font-mono break-all">{describe(a)}</span>
            {/* Green means money gained everywhere else in the app, so an
                enabled alert is marked with the accent, not with a gain. */}
            <span className={`text-xs px-2 py-0.5 rounded border ${
              a.enabled
                ? "border-blue-900 bg-blue-950/50 text-blue-400"
                : "border-neutral-800 bg-neutral-900 text-neutral-500"
            }`}>
              {a.enabled ? "Enabled" : a.kind === "price_target" ? "Fired, paused" : "Paused"}
            </span>
            <span className="text-neutral-500 text-xs">
              {a.lastEvaluated ? `last: ${new Date(a.lastEvaluated).toLocaleString()}` : "never evaluated"}
            </span>
            <span className="flex-1" />
            <button onClick={() => toggle(a)} className="text-xs underline text-neutral-400 inline-flex items-center gap-1">
              {a.enabled ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
              {a.enabled ? "Pause" : "Enable"}
            </button>
            <button onClick={() => remove(a)} className="text-xs underline text-red-500 inline-flex items-center gap-1"><Trash2 size={12} aria-hidden />Delete alert…</button>
          </li>
        ))}
        {alerts.length === 0 && (
          <EmptyState as="li" className="py-4">No alerts yet — build one above and press Create.</EmptyState>
        )}
      </ul>
    </main>
  );
}

function describe(a: Alert): string {
  if (a.kind === "price_target") {
    const p = a.params as { direction?: string; price?: number };
    return `${a.symbol} ${p.direction === "below" ? "≤" : "≥"} ${p.price}`;
  }
  if (a.kind === "pct_move") {
    const p = a.params as { threshold?: number };
    const scope = a.symbol ?? `portfolio “${a.portfolioName ?? "?"}”`;
    return `${scope} moves ±${p.threshold}% (24h)`;
  }
  return `${a.symbol} ${a.timeframe} indicator`;
}

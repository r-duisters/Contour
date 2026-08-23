"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookText } from "lucide-react";
import PageLabel from "@/components/PageLabel";
import { useDataClient } from "@/data/client/context";
import { money, quantity, setDisplayCurrency } from "@/lib/display";
import { useCachedValuation, useLastPortfolio } from "@/components/useCachedValuation";
import StaleNote from "@/components/StaleNote";
import { usePrivacy } from "@/components/usePrivacy";
import Button from "@/components/Button";
import { field } from "@/components/field";

/**
 * What went in, what came out, and what it cost.
 *
 * Split out of Insights, which was answering two questions at once: how the
 * portfolio has performed, and what it has cost. Benchmarks and contributors
 * are performance and stay there; cost basis, realised profit, fees and the
 * January valuation are accounting and live here.
 */

type Totals = {
  value: number; costBasis: number; realizedPnl: number;
  fees: number; unrealizedPnl: number; cash?: number;
};
type CashRow = { symbol: string; quantity: number; value: number | null; unreliable?: boolean };
type Snap = {
  date: string;
  total: number;
  /** Absent — not zero — when the portfolio held nothing on the date. */
  unpriced?: number;
  rows: { symbol: string; assetType: string; quantity: number; value: number | null }[];
};

export default function LedgerPage() {
  const client = useDataClient();
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [cashRows, setCashRows] = useState<CashRow[]>([]);
  // Which portfolio to ask the cache about before the list of portfolios has
  // arrived. The fetch below still decides; this only picks the screen the
  // user most likely left.
  const remembered = useLastPortfolio();
  const { cached, at: stale, remember } = useCachedValuation(portfolioId ?? remembered);
  const [byYear, setByYear] = useState<{ year: number; net: number }[]>([]);
  const [snapDate, setSnapDate] = useState("");
  const [snap, setSnap] = useState<Snap | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  usePrivacy(); // re-render when amounts are hidden or shown

  // Last night's accounting rows, on screen while the priced valuation loads.
  // Derived rather than copied into state: the cache is a stand-in for what
  // has not arrived, and two copies of the same figures can disagree.
  // Set during render, not in an effect: `money()` reads a module variable
  // rather than React state, so an effect would run after the figures below
  // had already been formatted — and with the cache derived rather than
  // copied into state there is no second render to correct them. The call is
  // an idempotent assignment, so repeating it costs nothing.
  if (cached?.currency) setDisplayCurrency(cached.currency);
  const shownTotals = totals ?? cached?.totals ?? null;
  const shownCash = totals ? cashRows : (cached?.holdings.filter((h) => h.assetType === "cash") ?? []);

  // Box 3 is assessed on 1 January, so that is the date worth defaulting to.
  useEffect(() => { setSnapDate(`${new Date().getFullYear()}-01-01`); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await client.listPortfolios().catch(() => null);
      const id: string | undefined = list?.[0]?.id;
      if (!id || cancelled) return;
      setPortfolioId(id);
      // Both in flight at once, each falling back on its own: the accounting
      // rows and the per-year bars are independent, and the priced valuation
      // is the slow half.
      const [val, ins] = await Promise.all([
        client.getValuation(id).catch(() => null),
        client.getInsights(id).catch(() => null),
      ]);
      if (cancelled) return;
      setDisplayCurrency(val?.currency ?? "USD");
      // A failed valuation leaves whatever the cache put on screen: replacing
      // real figures with "Loading…" because a refresh failed is strictly
      // worse than showing them and saying when they are from.
      if (val) {
        setTotals(val.totals);
        setCashRows(val.holdings.filter((h) => h.assetType === "cash"));
        remember(id, val);
      }
      setByYear(ins?.byYear ?? []);
    })();
    return () => { cancelled = true; };
  }, [client, remember]);

  const loadSnapshot = useCallback(async () => {
    if (!portfolioId || !snapDate) return;
    setSnapLoading(true);
    const d = await client.getSnapshot(portfolioId, snapDate).catch(() => null);
    setSnap(d);
    setSnapLoading(false);
  }, [client, portfolioId, snapDate]);

  const costPct = (n: number) =>
    shownTotals && shownTotals.costBasis > 0 ? (n / shownTotals.costBasis) * 100 : null;
  const yearMax = Math.max(...byYear.map((y) => Math.abs(y.net)), 1);

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-5xl mx-auto">
      <Link href="/more" className="text-xs text-neutral-400 inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={14} aria-hidden />More
      </Link>

      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <PageLabel icon={BookText}>Ledger</PageLabel>
      </div>

      {!shownTotals && <p className="text-sm text-neutral-500">Loading…</p>}
      <StaleNote at={stale} />

      {shownTotals && (
        <>
          {/* Rows rather than tiles: these are read one after another, not
              scanned, and a row gives the figure room to be the point. */}
          <section className="mb-10 divide-y divide-neutral-800 border-b border-neutral-800">
            <Row label="Cost basis" value={money(shownTotals.costBasis)} />
            <Row label="Unrealised" value={money(shownTotals.unrealizedPnl)}
                 signed={shownTotals.unrealizedPnl} pct={costPct(shownTotals.unrealizedPnl)} />
            <Row label="Realised" value={money(shownTotals.realizedPnl)}
                 signed={shownTotals.realizedPnl} pct={costPct(shownTotals.realizedPnl)} />
            <Row label="Fees paid" value={money(shownTotals.fees)} muted />
            {typeof shownTotals.cash === "number" && (
              <Row label="Cash" value={money(shownTotals.cash)} />
            )}
          </section>

          {byYear.length > 0 && (
            <section className="mb-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-4">
                Net invested per year
              </h2>
              <div className="space-y-3">
                {byYear.map((y) => {
                  const width = (Math.abs(y.net) / yearMax) * 50;
                  const out = y.net < 0;
                  return (
                    <div key={y.year}
                         className="grid grid-cols-[48px_1fr_100px] gap-4 items-center text-xs">
                      <span className="text-neutral-500">{y.year}</span>
                      {/* Bars run from a shared centre: right for money in,
                          left for money out, so a withdrawal year is visible
                          as a direction and not just a minus sign. */}
                      <div className="relative h-2 bg-neutral-900 rounded-full overflow-hidden">
                        <div
                          className={`absolute h-full ${out ? "bg-amber-500" : "bg-blue-500"}`}
                          style={out
                            ? { right: "50%", width: `${width}%` }
                            : { left: "50%", width: `${width}%` }}
                        />
                      </div>
                      <span className={`text-right tabular-nums ${out ? "text-amber-500" : ""}`}>
                        {money(y.net)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-4">
              Value on a date
            </h2>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <input
                type="date"
                aria-label="Valuation date"
                className={field()}
                value={snapDate}
                onChange={(e) => setSnapDate(e.target.value)}
              />
              <Button onClick={loadSnapshot} disabled={!snapDate}>Value it</Button>
              {snapLoading && <span className="text-xs text-neutral-500">valuing…</span>}
              <span className="flex-1" />
              {snap && (
                <span className="text-sm tabular-nums">
                  {money(snap.total)}
                  <span className="text-neutral-500 text-xs"> on {snap.date}</span>
                </span>
              )}
            </div>
            {snap && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs text-left">
                    <tr>
                      <th className="py-2 pr-4">Asset</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4 text-right">Quantity</th>
                      <th className="py-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {snap.rows.map((r) => (
                      <tr key={`${r.symbol}-${r.assetType}`}>
                        <td className="py-2 pr-4 font-mono">{r.symbol}</td>
                        <td className="py-2 pr-4 text-neutral-500">{r.assetType}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{quantity(r.quantity)}</td>
                        <td className="py-2 text-right tabular-nums">
                          {r.value !== null ? money(r.value) : <span className="text-neutral-600">no price</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-neutral-600 mt-2">
              Holdings and prices as they stood on that date, converted at that date&rsquo;s exchange rate.
              Dutch box 3 is assessed on 1 January.
              {snap?.unpriced ? ` ${snap.unpriced} holding(s) had no price then and are excluded.` : null}
            </p>
          </section>

          {shownCash.length > 0 && (
            <section className="mb-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-4">
                Cash
              </h2>
              <div className="divide-y divide-neutral-800 border-b border-neutral-800">
                {shownCash.map((c) => (
                  <div key={c.symbol} className="py-3 flex justify-between items-baseline">
                    <span className="text-sm font-mono text-neutral-400">{c.symbol}</span>
                    <span className="text-sm tabular-nums">
                      {c.unreliable ? (
                        <span className="text-amber-500 text-xs">not counted · export missing deposits</span>
                      ) : c.value !== null ? money(c.value) : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-neutral-600 mt-2">
                Cash is counted from recorded transfers only and is reported beside the portfolio
                rather than inside its value.
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

/** One accounting figure: label left, figure right, optional percent beneath. */
function Row({ label, value, signed, pct, muted }: {
  label: string; value: string; signed?: number; pct?: number | null; muted?: boolean;
}) {
  const tone =
    signed === undefined || signed === 0 ? (muted ? "text-neutral-400" : "text-white")
    : signed > 0 ? "text-green-500" : "text-red-500";
  return (
    <div className="py-4 flex justify-between items-baseline gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      <span className="text-right">
        <span className={`block text-xl tabular-nums ${tone}`}>{value}</span>
        {pct !== null && pct !== undefined && (
          <span className={`block text-[11px] font-medium tabular-nums ${tone}`}>
            {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
          </span>
        )}
      </span>
    </div>
  );
}

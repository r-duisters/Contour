"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { money, quantity, setDisplayCurrency } from "@/lib/display";

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
  date: string; total: number; unpriced: number;
  rows: { symbol: string; assetType: string; quantity: number; value: number | null }[];
};

export default function LedgerPage() {
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [cashRows, setCashRows] = useState<CashRow[]>([]);
  const [byYear, setByYear] = useState<{ year: number; net: number }[]>([]);
  const [snapDate, setSnapDate] = useState("");
  const [snap, setSnap] = useState<Snap | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);

  // Box 3 is assessed on 1 January, so that is the date worth defaulting to.
  useEffect(() => { setSnapDate(`${new Date().getFullYear()}-01-01`); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetch("/api/portfolios").then((r) => r.json()).catch(() => null);
      const id: string | undefined = list?.portfolios?.[0]?.id;
      if (!id || cancelled) return;
      setPortfolioId(id);
      const [val, ins] = await Promise.all([
        fetch(`/api/portfolios/${id}/valuation`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/portfolios/${id}/insights`).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (cancelled) return;
      setDisplayCurrency(val?.currency ?? "USD");
      setTotals(val?.totals ?? null);
      setCashRows((val?.holdings ?? []).filter((h: { assetType?: string }) => h.assetType === "cash"));
      setByYear(ins?.byYear ?? []);
    })();
    return () => { cancelled = true; };
  }, []);

  const loadSnapshot = useCallback(async () => {
    if (!portfolioId || !snapDate) return;
    setSnapLoading(true);
    const d = await fetch(`/api/portfolios/${portfolioId}/snapshot?date=${snapDate}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setSnap(d);
    setSnapLoading(false);
  }, [portfolioId, snapDate]);

  const costPct = (n: number) =>
    totals && totals.costBasis > 0 ? (n / totals.costBasis) * 100 : null;
  const yearMax = Math.max(...byYear.map((y) => Math.abs(y.net)), 1);

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-3xl mx-auto">
      <Link href="/more" className="text-xs text-neutral-400 inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={14} aria-hidden />More
      </Link>

      <header className="mb-8">
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Ledger</h1>
        <p className="text-xs text-neutral-500">What went in, what came out, and what it cost.</p>
      </header>

      {!totals && <p className="text-sm text-neutral-500">Loading…</p>}

      {totals && (
        <>
          {/* Rows rather than tiles: these are read one after another, not
              scanned, and a row gives the figure room to be the point. */}
          <section className="mb-10 divide-y divide-neutral-800 border-b border-neutral-800">
            <Row label="Cost basis" value={money(totals.costBasis)} />
            <Row label="Unrealised" value={money(totals.unrealizedPnl)}
                 signed={totals.unrealizedPnl} pct={costPct(totals.unrealizedPnl)} />
            <Row label="Realised" value={money(totals.realizedPnl)}
                 signed={totals.realizedPnl} pct={costPct(totals.realizedPnl)} />
            <Row label="Fees paid" value={money(totals.fees)} muted />
            {typeof totals.cash === "number" && (
              <Row label="Cash" value={money(totals.cash)} />
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
                className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                value={snapDate}
                onChange={(e) => setSnapDate(e.target.value)}
              />
              <button onClick={loadSnapshot} disabled={!snapDate}
                      className="bg-blue-600 disabled:opacity-50 text-white rounded px-3 py-1 text-sm">
                Value it
              </button>
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
              {snap && snap.unpriced > 0 && ` ${snap.unpriced} holding(s) had no price then and are excluded.`}
            </p>
          </section>

          {cashRows.length > 0 && (
            <section className="mb-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-4">
                Cash
              </h2>
              <div className="divide-y divide-neutral-800 border-b border-neutral-800">
                {cashRows.map((c) => (
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
          <span className={`block text-[11px] font-medium ${tone}`}>
            {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
          </span>
        )}
      </span>
    </div>
  );
}

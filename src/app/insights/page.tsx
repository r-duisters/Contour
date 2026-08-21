"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import { classSplit, concentration, contributions, type TradeStats } from "@/lib/insights";
import type { ValuedHolding } from "@/lib/portfolio";

type Holding = ValuedHolding & { assetType?: "crypto" | "equity" | "cash" };

type RangeStat = {
  key: string;
  label: string;
  twrPct: number | null;
  mwrPct: number | null;
  benchPct: number | null;
  benchSameFlows: number | null;
  closing: number;
};

const RANGES = [
  { key: "1m", label: "1 month" },
  { key: "ytd", label: "Year to date" },
  { key: "1y", label: "1 year" },
  { key: "2y", label: "2 years" },
  { key: "5y", label: "5 years" },
  { key: "all", label: "All time" },
] as const;

const BENCHMARKS = [
  { key: "sp500", label: "S&P 500" },
  { key: "world", label: "MSCI World" },
  { key: "aex", label: "AEX" },
  { key: "nasdaq", label: "Nasdaq 100" },
  { key: "btc", label: "Bitcoin" },
] as const;

let currency: "USD" | "EUR" = "USD";
const money = (n: number) =>
  n.toLocaleString(currency === "EUR" ? "de-DE" : "en-US", {
    style: "currency", currency, maximumFractionDigits: 0,
  });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function InsightsPage() {
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [totals, setTotals] = useState<{ value: number; costBasis: number; realizedPnl: number; fees: number } | null>(null);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [byYear, setByYear] = useState<{ year: number; net: number }[]>([]);
  const [benchKey, setBenchKey] = useState<string>("sp500");
  const [rows, setRows] = useState<RangeStat[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [snapDate, setSnapDate] = useState(() => `${new Date().getUTCFullYear()}-01-01`);
  const [snap, setSnap] = useState<{
    date: string; total: number; unpriced: number;
    rows: { symbol: string; assetType: string; quantity: number; value: number | null }[];
  } | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);

  async function loadSnapshot() {
    if (!portfolioId) return;
    setSnapLoading(true);
    const d = await fetch(`/api/portfolios/${portfolioId}/snapshot?date=${snapDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    setSnap(d);
    setSnapLoading(false);
  }

  useEffect(() => {
    fetch("/api/portfolios")
      .then((r) => r.json())
      .then((d: { portfolios: { id: string }[] }) => setPortfolioId(d.portfolios[0]?.id ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!portfolioId) return;
    fetch(`/api/portfolios/${portfolioId}/valuation`)
      .then((r) => r.json())
      .then((d) => { currency = d.currency ?? "USD"; setHoldings(d.holdings); setTotals(d.totals); })
      .catch(() => setHoldings([]));
    fetch(`/api/portfolios/${portfolioId}/insights`)
      .then((r) => r.json())
      .then((d) => { setStats(d.stats); setByYear(d.byYear ?? []); })
      .catch(() => {});
  }, [portfolioId]);

  // One row per period: our two return measures beside the benchmark's.
  const loadRows = useCallback(async () => {
    if (!portfolioId) return;
    setLoadingRows(true);
    const out: RangeStat[] = [];
    for (const r of RANGES) {
      const s = await fetch(`/api/portfolios/${portfolioId}/series?range=${r.key}`)
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      if (!s) continue;
      const b = await fetch(
        `/api/benchmark?key=${benchKey}&from=${s.windowFrom}&barMs=${s.barMs}&portfolioId=${portfolioId}`,
      ).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const benchPoints: { index: number }[] = b?.points ?? [];
      out.push({
        key: r.key,
        label: r.label,
        twrPct: s.twr?.totalPct ?? null,
        mwrPct: s.mwr?.annualPct ?? null,
        benchPct: benchPoints.length ? benchPoints[benchPoints.length - 1]!.index - 100 : null,
        benchSameFlows: b?.sameFlows?.finalValue ?? null,
        closing: s.mwr?.closing ?? 0,
      });
      setRows([...out]);
    }
    setLoadingRows(false);
  }, [portfolioId, benchKey]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const split = holdings ? classSplit(holdings) : [];
  const conc = holdings ? concentration(holdings) : null;
  const contrib = holdings ? contributions(holdings) : [];
  const winners = contrib.filter((c) => c.total > 0).slice(0, 5);
  const losers = [...contrib].reverse().filter((c) => c.total < 0).slice(0, 5);

  return (
    <main className="min-h-screen px-3 py-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6 flex items-center gap-2">
        <BarChart3 size={20} aria-hidden className="text-neutral-400" />Insights
      </h1>

      {!portfolioId && <p className="text-sm text-neutral-500">No portfolio yet.</p>}

      {portfolioId && (
        <>
          <Section title="Performance by period">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs text-neutral-500">compared against</span>
              <select
                className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs"
                value={benchKey}
                onChange={(e) => setBenchKey(e.target.value)}
              >
                {BENCHMARKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              {loadingRows && <span className="text-xs text-neutral-500">loading…</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-neutral-500 text-xs text-left">
                  <tr>
                    <th className="py-2 pr-4">Period</th>
                    <th className="py-2 pr-4 text-right" title="Return ignoring when money was added — comparable to an index quote">
                      Your return
                    </th>
                    <th className="py-2 pr-4 text-right" title="Annualised return on the money you actually had invested">
                      Annualised
                    </th>
                    <th className="py-2 pr-4 text-right">Index</th>
                    <th className="py-2 text-right" title="What your own deposits, on your own dates, would be worth in the index">
                      Same money in index
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="py-2 pr-4">{r.label}</td>
                      <td className="py-2 pr-4 text-right"><Signed value={r.twrPct} suffix="%" /></td>
                      <td className="py-2 pr-4 text-right"><Signed value={r.mwrPct} suffix="%/yr" /></td>
                      <td className="py-2 pr-4 text-right"><Signed value={r.benchPct} suffix="%" /></td>
                      <td className="py-2 text-right text-neutral-300">
                        {r.benchSameFlows !== null ? money(r.benchSameFlows) : "—"}
                        {r.benchSameFlows !== null && r.closing > 0 && (
                          <span className={`ml-2 text-xs ${r.closing >= r.benchSameFlows ? "text-green-500" : "text-red-500"}`}>
                            {r.closing >= r.benchSameFlows ? "you ahead" : "you behind"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="py-4 text-neutral-500 text-sm">Calculating…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-neutral-600 mt-2">
              &ldquo;Your return&rdquo; removes deposits and withdrawals, so it compares like for like with an index.
              &ldquo;Annualised&rdquo; keeps them, answering what your money actually earned per year.
            </p>
          </Section>

          <Section title="Balance between assets">
            <div className="grid sm:grid-cols-[1fr_240px] gap-6 mb-6 items-start">
              <div className="space-y-4">
                <ul className="space-y-2">
                  {split.map((c) => (
                    <li key={c.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{c.label}</span>
                        <span className="text-neutral-400">{money(c.value)} · {c.share.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 bg-neutral-800 rounded overflow-hidden">
                        <div
                          className={
                            c.label === "Crypto" ? "h-full bg-blue-500"
                            : c.label === "Cash" ? "h-full bg-neutral-500"
                            : "h-full bg-green-500"
                          }
                          style={{ width: `${c.share}%` }}
                        />
                      </div>
                    </li>
                  ))}
                  {split.length === 0 && <li className="text-sm text-neutral-500">No priced holdings.</li>}
                </ul>
              <dl className="text-sm space-y-2">
                <Row label="Priced positions" value={conc?.pricedCount ?? "—"} />
                <Row
                  label="Largest position"
                  value={conc?.topShare !== null && conc ? `${conc.topShare!.toFixed(1)}% of value` : "—"}
                />
                <Row
                  label="Top three"
                  value={conc?.top3Share !== null && conc ? `${conc.top3Share!.toFixed(1)}% of value` : "—"}
                />
                <Row
                  label="Concentration"
                  value={conc?.herfindahl !== null && conc
                    ? `${conc.herfindahl!.toFixed(2)} ${conc.herfindahl! > 0.25 ? "(concentrated)" : "(spread)"}`
                    : "—"}
                />
              </dl>
              </div>
              {holdings && <AllocationDonut holdings={holdings} />}
            </div>
          </Section>

          <Section title="What made the money">
            <div className="grid sm:grid-cols-2 gap-6">
              <ContribList title="Best" rows={winners} up />
              <ContribList title="Worst" rows={losers} up={false} />
            </div>
          </Section>

          <Section title="Trading activity">
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Tile label="Transactions" value={String(stats.trades)} />
                <Tile label="Buys / sells" value={`${stats.buys} / ${stats.sells}`} />
                <Tile label="Assets traded" value={String(stats.assetsTraded)} />
                <Tile
                  label="Busiest year"
                  value={stats.busiestYear ? `${stats.busiestYear.year} (${stats.busiestYear.trades})` : "—"}
                />
                <Tile label="Total bought" value={money(stats.totalBought)} />
                <Tile label="Total sold" value={money(stats.totalSold)} />
                <Tile label="Average buy" value={stats.avgBuySize !== null ? money(stats.avgBuySize) : "—"} />
                <Tile
                  label="Fees paid"
                  value={`${money(stats.fees)}${stats.feeRatePct !== null ? ` (${stats.feeRatePct.toFixed(2)}%)` : ""}`}
                />
              </div>
            )}
            {stats?.firstTrade && (
              <p className="text-xs text-neutral-500 mt-3">
                First transaction {new Date(stats.firstTrade).toLocaleDateString()}, most recent{" "}
                {new Date(stats.lastTrade!).toLocaleDateString()}.
              </p>
            )}
          </Section>

          <Section title="Net invested per year">
            <ul className="space-y-1">
              {byYear.map((y) => {
                const max = Math.max(...byYear.map((r) => Math.abs(r.net)), 1);
                return (
                  <li key={y.year} className="flex items-center gap-3 text-sm">
                    <span className="w-12 text-neutral-500">{y.year}</span>
                    <span className="flex-1 h-2 bg-neutral-900 rounded overflow-hidden flex">
                      <span
                        className={y.net >= 0 ? "h-full bg-blue-500" : "h-full bg-amber-500"}
                        style={{ width: `${(Math.abs(y.net) / max) * 100}%` }}
                      />
                    </span>
                    <span className={`w-28 text-right ${y.net >= 0 ? "text-neutral-300" : "text-amber-500"}`}>
                      {money(y.net)}
                    </span>
                  </li>
                );
              })}
              {byYear.length === 0 && <li className="text-sm text-neutral-500">No transactions.</li>}
            </ul>
            <p className="text-xs text-neutral-600 mt-2">
              Positive means money went in that year; negative means you took more out than you put in.
            </p>
          </Section>

          <Section title="Value on a date">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <input
                type="date"
                className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                value={snapDate}
                onChange={(e) => setSnapDate(e.target.value)}
              />
              <button onClick={loadSnapshot}
                      className="bg-blue-600 text-white rounded px-3 py-1 text-sm">
                Value it
              </button>
              {snapLoading && <span className="text-xs text-neutral-500">valuing…</span>}
              <span className="flex-1" />
              {snap && (
                <span className="text-sm">
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
                        <td className="py-2 pr-4 text-right">
                          {r.quantity.toLocaleString("en-US", { maximumFractionDigits: 8 })}
                        </td>
                        <td className="py-2 text-right">
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
          </Section>

          {totals && (
            <p className="text-xs text-neutral-600 mb-10">
              Realised profit to date {money(totals.realizedPnl)} · fees {money(totals.fees)} ·
              current value {money(totals.value)} against {money(totals.costBasis)} of cost basis.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-neutral-900 pb-1">
      <dt className="text-neutral-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded p-3">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className="text-base">{value}</div>
    </div>
  );
}

function Signed({ value, suffix }: { value: number | null; suffix: string }) {
  if (value === null) return <span className="text-neutral-600">—</span>;
  return (
    <span className={value >= 0 ? "text-green-500" : "text-red-500"}>
      {pct(value).replace("%", "")}{suffix}
    </span>
  );
}

function ContribList({
  title, rows, up,
}: {
  title: string;
  rows: { symbol: string; total: number; pct: number | null }[];
  up: boolean;
}) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2 flex items-center gap-1">
        {up ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
        {title}
      </h3>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.symbol}>
            <Link
              href={`/portfolio/${encodeURIComponent(r.symbol)}`}
              className="flex items-center gap-2 text-sm"
            >
              <CoinIcon symbol={r.symbol} size={16} />
              <span className="font-mono truncate">{r.symbol}</span>
            <span className="flex-1" />
              <span className={r.total >= 0 ? "text-green-500" : "text-red-500"}>{money(r.total)}</span>
              {r.pct !== null && <span className="text-xs text-neutral-500 w-16 text-right">{pct(r.pct)}</span>}
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-neutral-500">Nothing here yet.</li>}
      </ul>
    </div>
  );
}

const SLICE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#64748b"];

/** Per-asset allocation. Lives here rather than on the daily dashboard.
 */
function AllocationDonut({ holdings }: { holdings: Holding[] }) {
  const slices = holdings
    .filter((h) => (h.value ?? 0) > 0)
    .sort((a, b) => b.value! - a.value!);
  const total = slices.reduce((a, h) => a + h.value!, 0);
  if (total <= 0) return null;

  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div>
      <svg viewBox="0 0 200 200" className="w-full max-w-[260px]">
        {slices.map((h, i) => {
          const frac = h.value! / total;
          const dash = frac * C;
          const el = (
            <circle
              key={h.symbol}
              cx="100" cy="100" r={R}
              fill="none"
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
              strokeWidth="28"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <ul className="mt-3 space-y-1 text-xs hidden md:block">
        {slices.map((h, i) => (
          <li key={h.symbol} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm inline-block"
                  style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
            <CoinIcon symbol={h.symbol} size={14} />
            <span className="font-mono">{h.symbol}</span>
            <span className="text-neutral-500">{((h.value! / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

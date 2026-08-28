"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

// Charting loads after the tables, which need no library at all.
const ComparisonChart = dynamic(() => import("@/components/ComparisonChart"), {
  ssr: false,
  loading: () => <div className="h-56 md:h-72 border border-neutral-800 rounded" />,
});
import { BarChart3, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import PageLabel from "@/components/PageLabel";
import CoinIcon from "@/components/CoinIcon";
import { useDataClient } from "@/data/client/context";
import { useAssetHref } from "@/components/routing";
import { money as fmtMoney, percent, setDisplayCurrency } from "@/lib/display";
import { usePrivacy } from "@/components/usePrivacy";
import { allocation, concentration, contributions, type AllocationClass, type TradeStats } from "@/lib/insights";
import type { TripStats } from "@/lib/round-trips";
import type { ValuedHolding } from "@/lib/portfolio";
import { currencyShare, type CurrencyEffect, type PortfolioEffect } from "@/lib/attribution";
import { CURRENCY_NAMES, type DisplayCurrency } from "@/lib/currencies";
import RangePicker from "@/components/RangePicker";
import { PERFORMANCE_RANGES, rangeLabel, type RangeKey } from "@/lib/ranges";
import StatTile from "@/components/StatTile";
import EmptyState from "@/components/EmptyState";
import SubHeading from "@/components/SubHeading";

type Holding = ValuedHolding & {
  assetType?: "crypto" | "equity" | "cash";
  name?: string | null;
  fx?: CurrencyEffect | null;
};

type RangeStat = {
  key: string;
  label: string;
  twrPct: number | null;
  mwrPct: number | null;
  benchPct: number | null;
  benchSameFlows: number | null;
  closing: number;
};



const BENCHMARKS = [
  { key: "sp500", label: "S&P 500" },
  { key: "world", label: "MSCI World" },
  { key: "aex", label: "AEX" },
  { key: "nasdaq", label: "Nasdaq 100" },
  { key: "btc", label: "Bitcoin" },
] as const;

/**
 * Narrower than the client's own `BenchmarkKey`, deliberately: the compiler
 * now rejects a key this screen offers that the data layer cannot answer.
 */
type BenchKey = (typeof BENCHMARKS)[number]["key"];

const money = (n: number) => fmtMoney(n, 0);
const pct = (n: number) => percent(n);

export default function InsightsScreen() {
  const client = useDataClient();
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [fx, setFx] = useState<PortfolioEffect | null>(null);
  const [cur, setCur] = useState<DisplayCurrency>("USD");
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [realised, setRealised] = useState<{ year: number; realised: number }[]>([]);
  const [trips, setTrips] = useState<TripStats | null>(null);
  const [income, setIncome] = useState<{ symbol: string | null; total: number }[]>([]);
  const [benchKey, setBenchKey] = useState<BenchKey>("sp500");
  const [rows, setRows] = useState<RangeStat[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [chartRange, setChartRange] = useState<RangeKey>("1y");
  const [chartMode, setChartMode] = useState<"money" | "pct">("money");
  const [curve, setCurve] = useState<{
    you: { t: number; v: number }[] | null;
    bench: { t: number; v: number }[] | null;
  }>({ you: null, bench: null });
  usePrivacy(); // re-render when amounts are hidden or shown

  useEffect(() => {
    client.listPortfolios()
      .then((rows) => setPortfolioId(rows[0]?.id ?? null))
      .catch(() => {});
  }, [client]);

  useEffect(() => {
    if (!portfolioId) return;
    // Two chains, not a Promise.all: the trade statistics come from the
    // transaction log alone and land long before the priced valuation does.
    client.getValuation(portfolioId)
      .then((d) => {
        setDisplayCurrency(d.currency);
        setCur(d.currency);
        setHoldings(d.holdings);
        setFx(d.totals.fx ?? null);
      })
      .catch(() => setHoldings([]));
    client.getInsights(portfolioId)
      .then((d) => {
        setStats(d.stats);
        setRealised(d.realisedByYear ?? []);
        setTrips(d.trips ?? null);
        setIncome(d.income ?? []);
      })
      .catch(() => {});
  }, [client, portfolioId]);

  // One row per period: our two return measures beside the benchmark's.
  const loadRows = useCallback(async () => {
    if (!portfolioId) return;
    setLoadingRows(true);
    const out: RangeStat[] = [];
    for (const r of PERFORMANCE_RANGES.map((k) => ({ key: k, label: rangeLabel(k, true) }))) {
      const s = await client.getSeries(portfolioId, r.key).catch(() => null);
      if (!s) continue;
      // A portfolio holding nothing priceable answers with the thin shape: no
      // window, so there is no period for an index to be measured over.
      const measured = "twr" in s ? s : null;
      const opening = Math.max(0, Math.round(s.series[0]?.value ?? 0));
      const b = measured
        ? await client.getBenchmark({
            key: benchKey,
            from: measured.windowFrom,
            barMs: measured.barMs,
            portfolioId,
            opening,
          }).catch(() => null)
        : null;
      const benchPoints = b?.points ?? [];
      out.push({
        key: r.key,
        label: r.label,
        twrPct: measured?.twr.totalPct ?? null,
        mwrPct: measured?.mwr.annualPct ?? null,
        benchPct: benchPoints.length ? benchPoints[benchPoints.length - 1]!.index - 100 : null,
        benchSameFlows: b?.sameFlows?.finalValue ?? null,
        closing: measured?.mwr.closing ?? 0,
      });
      setRows([...out]);
    }
    setLoadingRows(false);
  }, [client, portfolioId, benchKey]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // The picture behind the table: one period, drawn.
  useEffect(() => {
    if (!portfolioId) return;
    let cancelled = false;
    setCurve({ you: null, bench: null });
    (async () => {
      const series = await client.getSeries(portfolioId, chartRange).catch(() => null);
      if (cancelled || !series) return;
      // The value already invested when the window opened, so the index is
      // handed the same starting stake rather than starting from nothing.
      const opening = series.series[0]?.value ?? 0;
      const measured = "twr" in series ? series : null;
      const bench = measured
        ? await client.getBenchmark({
            key: benchKey,
            from: measured.windowFrom,
            barMs: measured.barMs,
            portfolioId,
            opening: Math.max(0, Math.round(opening)),
          }).catch(() => null)
        : null;
      if (cancelled) return;
      if (chartMode === "money") {
        setCurve({
          you: series.series.map((p) => ({ t: p.t, v: p.value })),
          bench: (bench?.sameFlows?.series ?? []).map((p) => ({ t: p.t, v: p.value })),
        });
      } else {
        setCurve({
          you: (measured?.twr.points ?? []).map((p) => ({ t: p.t, v: p.index })),
          bench: (bench?.points ?? []).map((p) => ({ t: p.t, v: p.index })),
        });
      }
    })();
    return () => { cancelled = true; };
  }, [client, portfolioId, chartRange, benchKey, chartMode]);

  // The positions where the exchange rate mattered most, either way.
  const byCurrency = (holdings ?? [])
    .filter((h): h is Holding & { fx: CurrencyEffect } => !!h.fx)
    .sort((a, b) => Math.abs(b.fx.currency) - Math.abs(a.fx.currency))
    .slice(0, 5);

  // Null when the asset and the currency very nearly cancel: a share of a
  // result that is essentially zero is a number, not a fact.
  const share = fx ? currencyShare(fx, fx.costDisplay) : null;
  // A priced open position with no dollar cost behind it — a gift, an inbound
  // transfer at no basis — has no acquisition rate, so it sits outside the
  // split and outside the total beside it.
  const uncovered = fx
    ? (holdings ?? []).filter(
        (h) => h.assetType !== "cash" && h.quantity > 1e-12 && h.value !== null,
      ).length - fx.covered
    : 0;

  const alloc = holdings ? allocation(holdings) : [];
  const conc = holdings ? concentration(holdings) : null;
  const contrib = holdings ? contributions(holdings) : [];
  const winners = contrib.filter((c) => c.total > 0).slice(0, 5);
  const losers = [...contrib].reverse().filter((c) => c.total < 0).slice(0, 5);

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-3 py-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <PageLabel icon={BarChart3}>Insights</PageLabel>
      </div>

      {!portfolioId && <EmptyState>No portfolio yet — create one on the More page.</EmptyState>}

      {portfolioId && (
        <>
          <Section title="Performance by period">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs text-neutral-500">compared against</span>
              <select
                className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs"
                value={benchKey}
                onChange={(e) => setBenchKey(e.target.value as BenchKey)}
              >
                {BENCHMARKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              {loadingRows && <span className="text-xs text-neutral-500">loading…</span>}
            </div>
            <div className="flex gap-1 flex-wrap mb-2 items-center">
              <div className="flex rounded overflow-hidden border border-neutral-800 mr-2">
                {([["money", "Your money"], ["pct", "Return %"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setChartMode(m)}
                    className={`px-2 py-1 text-xs ${
                      chartMode === m ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <RangePicker
                value={chartRange}
                onChange={(k) => setChartRange(k)}
                only={PERFORMANCE_RANGES}
              />
            </div>
            <div className="mb-6">
              <ComparisonChart
                you={curve.you}
                bench={curve.bench}
                benchLabel={BENCHMARKS.find((b) => b.key === benchKey)?.label ?? "Index"}
                mode={chartMode}
              />
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
                      <td className="py-2 pr-4 text-right tabular-nums"><Signed value={r.twrPct} suffix="%" /></td>
                      <td className="py-2 pr-4 text-right tabular-nums"><Signed value={r.mwrPct} suffix="%/yr" /></td>
                      <td className="py-2 pr-4 text-right tabular-nums"><Signed value={r.benchPct} suffix="%" /></td>
                      <td className="py-2 text-right tabular-nums text-neutral-300">
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
            <div className="grid sm:grid-cols-[1fr_240px] gap-6 items-start">
              {alloc.length > 0
                ? <Allocation rows={alloc} />
                : <EmptyState>No priced holdings yet — add a transaction to see the balance.</EmptyState>}
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
          </Section>

          <Section title="What made the money">
            <div className="grid sm:grid-cols-2 gap-6">
              <ContribList title="Best" rows={winners} up />
              <ContribList title="Worst" rows={losers} up={false} />
            </div>
          </Section>

          {fx && (
            <Section title="The asset, and the currency">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <StatTile label="The asset" value={fmtMoney(fx.asset)} signed={fx.asset} />
                <StatTile label="The currency" value={fmtMoney(fx.currency)} signed={fx.currency} />
                <StatTile label="Together" value={fmtMoney(fx.total)} signed={fx.total} />
              </div>
              {/* The rate is not an amount, so it is not masked: it says
                  nothing about how much is held. */}
              <p className="text-xs text-neutral-500 mt-3">
                Prices are quoted in dollars. You bought your dollars at{" "}
                {fx.acquiredRate.toFixed(4)} {CURRENCY_NAMES[cur].toLowerCase()} on average and they
                are worth {fx.currentRate.toFixed(4)} today, so the exchange rate{" "}
                {fx.currency < 0 ? "has taken" : "has added"} {fmtMoney(Math.abs(fx.currency))}{" "}
                {fx.currency < 0 ? "off" : "to"} what the assets themselves earned
                {share !== null && ` — ${Math.abs(share).toFixed(0)}% of the result`}.
              </p>
              {/* Two exclusions a reader would otherwise have to infer from a
                  total that does not quite match the one on the portfolio
                  screen. */}
              <p className="text-xs text-neutral-500 mt-2">
                Across {fx.covered} open positions. A closed trade banked its exchange rate along
                with its profit, so it is not counted here
                {uncovered > 0 &&
                  `, and ${uncovered} open ${uncovered === 1 ? "position has" : "positions have"} no dollar cost to compare against`}.
              </p>
              {byCurrency.length > 0 && (
                <div className="mt-5">
                  <SubHeading>Where the rate mattered most</SubHeading>
                  <dl className="text-sm">
                    {byCurrency.map((h) => (
                      <Row
                        key={h.symbol}
                        label={h.symbol}
                        value={
                          <span className={h.fx.currency >= 0 ? "text-green-500" : "text-red-500"}>
                            {fmtMoney(h.fx.currency)}
                          </span>
                        }
                      />
                    ))}
                  </dl>
                </div>
              )}
            </Section>
          )}

          {realised.length > 0 && (
            <Section title="Profit taken, by year">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-sm">
                {realised.map((r) => (
                  <StatTile
                    key={r.year}
                    label={String(r.year)}
                    value={money(r.realised)}
                    signed={r.realised}
                  />
                ))}
              </div>
              {/* Two things a reader would otherwise have to guess. A year of
                  pure accumulation is absent rather than zero, and the figure
                  depends on the accounting method — see #47. */}
              <p className="text-xs text-neutral-500 mt-3">
                What sales actually made, on an average-cost basis. Years with no sale are not listed.
              </p>
            </Section>
          )}

          {trips && trips.trips > 0 && (
            <Section title="Closed trades">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <StatTile label="Round trips" value={String(trips.trips)} />
                <StatTile
                  label="Worked out"
                  value={trips.winRatePct !== null ? `${trips.winRatePct.toFixed(0)}%` : "—"}
                />
                <StatTile
                  label="Winners held"
                  value={trips.medianWinnerDays !== null ? `${trips.medianWinnerDays.toFixed(0)} days` : "—"}
                />
                <StatTile
                  label="Losers held"
                  value={trips.medianLoserDays !== null ? `${trips.medianLoserDays.toFixed(0)} days` : "—"}
                />
              </div>
              {(trips.best || trips.worst) && (
                <div className="grid sm:grid-cols-2 gap-3 mt-3 text-sm">
                  {trips.best && (
                    <StatTile
                      label={`Best — ${trips.best.symbol}`}
                      value={money(trips.best.pnl)}
                      signed={trips.best.pnl}
                      sub={`held ${trips.best.days.toFixed(0)} days`}
                    />
                  )}
                  {trips.worst && (
                    <StatTile
                      label={`Worst — ${trips.worst.symbol}`}
                      value={money(trips.worst.pnl)}
                      signed={trips.worst.pnl}
                      sub={`held ${trips.worst.days.toFixed(0)} days`}
                    />
                  )}
                </div>
              )}
              {/* Two things a reader would otherwise have to infer. The unit is
                  a matched buy-and-sell, not a sale — one sale can close
                  several — and these are matched oldest-first, which is a
                  different convention from the cost basis shown everywhere
                  else. No total appears here on purpose. */}
              <p className="text-xs text-neutral-500 mt-3">
                Each sale matched to the units it sold, oldest first. Median holding periods.
              </p>
            </Section>
          )}

          {/* Nothing is drawn when there is no income. EmptyState owns the
              empty tier, and a panel saying "no income yet" on a ledger that
              never will have any is noise. */}
          {income.length > 0 && (
            <Section title="What your holdings paid you">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <StatTile
                  label="Income"
                  value={fmtMoney(income.reduce((a, r) => a + r.total, 0))}
                  signed={1}
                />
              </div>
              <SubHeading>By source</SubHeading>
              <dl className="text-sm">
                {income.map((r) => (
                  <Row
                    key={r.symbol ?? "unattributed"}
                    label={r.symbol ?? "No source"}
                    value={<span className="text-green-500">{fmtMoney(r.total)}</span>}
                  />
                ))}
              </dl>
              <p className="text-xs text-neutral-500 mt-3">
                Dividends, interest and rewards paid in cash. It never changes what a
                holding cost, so a dividend cannot flatter the shares that paid it.
                {income.some((r) => r.symbol === null) &&
                  " Income with no source is interest, which nothing pays."}
              </p>
            </Section>
          )}

          <Section title="Trading activity">
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <StatTile label="Transactions" value={String(stats.trades)} />
                <StatTile label="Buys / sells" value={`${stats.buys} / ${stats.sells}`} />
                <StatTile label="Assets traded" value={String(stats.assetsTraded)} />
                <StatTile
                  label="Busiest year"
                  value={stats.busiestYear ? `${stats.busiestYear.year} (${stats.busiestYear.trades})` : "—"}
                />
                <StatTile label="Total bought" value={money(stats.totalBought)} />
                <StatTile label="Total sold" value={money(stats.totalSold)} />
                <StatTile label="Average buy" value={stats.avgBuySize !== null ? money(stats.avgBuySize) : "—"} />
                <StatTile
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
  rows: {
    symbol: string; total: number; pct: number | null;
    assetType?: "crypto" | "equity" | "cash"; name?: string | null;
  }[];
  up: boolean;
}) {
  const assetHref = useAssetHref();
  return (
    <div>
      <SubHeading className="mb-2 flex items-center gap-1">
        {up ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
        {title}
      </SubHeading>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.symbol}>
            <Link
              href={assetHref(r.symbol, r.assetType)}
              className="flex items-center gap-2 text-sm"
            >
              <CoinIcon symbol={r.symbol} size={20} assetType={r.assetType} />
              <span className="truncate">{r.name ?? r.symbol}</span>
            <span className="flex-1" />
              <span className={r.total >= 0 ? "text-green-500" : "text-red-500"}>{money(r.total)}</span>
              {r.pct !== null && <span className="text-xs text-neutral-500 w-16 text-right tabular-nums">{pct(r.pct)}</span>}
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <EmptyState as="li">{up ? "Nothing has gained yet." : "Nothing has lost yet."}</EmptyState>
        )}
      </ul>
    </div>
  );
}


/**
 * One accent, four weights, largest class first.
 *
 * BRAND.md keeps colour for meaning and gives green and red to money moved,
 * so four category hues were not available — the donut this replaced used
 * eight, including both. Encoding *magnitude* in the opacity of a single hue
 * stays inside the rule, and it survives privacy mode: the amounts mask, the
 * proportions still read.
 */
const WEIGHTS = ["rgba(59,130,246,1)", "rgba(59,130,246,0.7)", "rgba(59,130,246,0.45)", "rgba(59,130,246,0.25)"];

/** Positions shown before a class folds the rest into one row. */
const SHOWN = 5;

/**
 * Where the money is: the class mix as one bar, then each class opening onto
 * its own positions.
 *
 * A pie was the obvious shape and the wrong one. A real portfolio is a few
 * large positions and a long tail of small ones, which is exactly what a pie
 * renders as an unlabelled fan of slivers — and drilling into Crypto would
 * have produced twenty more. Rows carry the figures a pie cannot: right
 * aligned, `tabular-nums`, readable at 390px and at 1280px alike.
 */
function Allocation({ rows }: { rows: AllocationClass[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<string | null>(null);

  return (
    <div>
      <div className="flex h-2.5 rounded overflow-hidden mb-4" role="img"
           aria-label={rows.map((r) => `${r.label} ${r.share.toFixed(0)}%`).join(", ")}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ width: `${r.share}%`, background: WEIGHTS[i % WEIGHTS.length] }} />
        ))}
      </div>

      <ul className="space-y-1">
        {rows.map((r, i) => {
          const expandable = r.positions.length > 1;
          const isOpen = open === r.label;
          const all = showAll === r.label;
          const shown = all ? r.positions : r.positions.slice(0, SHOWN);
          const rest = r.positions.length - shown.length;
          return (
            <li key={r.label}>
              <button
                type="button"
                onClick={() => { setOpen(isOpen ? null : r.label); setShowAll(null); }}
                disabled={!expandable}
                aria-expanded={expandable ? isOpen : undefined}
                className="w-full flex items-center gap-2.5 py-1.5 text-sm text-left disabled:cursor-default"
              >
                <span className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ background: WEIGHTS[i % WEIGHTS.length] }} aria-hidden />
                <span className="flex-1">{r.label}</span>
                <span className="tabular-nums text-neutral-400">{money(r.value)}</span>
                <span className="tabular-nums text-neutral-500 w-12 text-right">{r.share.toFixed(1)}%</span>
                <ChevronRight
                  size={14}
                  aria-hidden
                  className={`shrink-0 transition-transform ${expandable ? "text-neutral-600" : "text-transparent"} ${isOpen ? "rotate-90" : ""}`}
                />
              </button>

              {isOpen && (
                <ul className="pl-5 pb-2 space-y-1">
                  {shown.map((p) => (
                    <li key={p.symbol} className="flex items-center gap-2.5 text-sm">
                      <CoinIcon symbol={p.symbol} size={16} assetType={r.label === "Crypto" ? "crypto" : r.label === "Cash" ? "cash" : "equity"} />
                      <span className="flex-1 truncate text-neutral-300">{p.name ?? p.symbol}</span>
                      <span className="tabular-nums text-neutral-400">{money(p.value)}</span>
                      <span className="tabular-nums text-neutral-500 w-12 text-right">{p.share.toFixed(1)}%</span>
                    </li>
                  ))}
                  {rest > 0 && (
                    <li>
                      {/* The tail is admitted rather than drawn. A pie draws all
                          twenty whether or not any of them can be read. */}
                      <button
                        type="button"
                        onClick={() => setShowAll(r.label)}
                        className="text-xs text-neutral-500 underline py-1"
                      >
                        {rest} smaller {rest === 1 ? "position" : "positions"}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

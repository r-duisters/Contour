"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  createChart, createSeriesMarkers, LineSeries,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time,
} from "lightweight-charts";
import { ArrowDown, ArrowLeft, ArrowUp, Trash2 } from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import { money as fmtMoney, quantity, setDisplayCurrency } from "@/lib/display";
import { annotateTransactions } from "@/lib/portfolio";
import { useFitChart } from "@/components/useFitChart";
import { useStoredRange } from "@/components/useStoredRange";
import { usePrivacy } from "@/components/usePrivacy";

type Tx = {
  id: string;
  symbol: string;
  side: "buy" | "sell" | "transfer_in" | "transfer_out";
  quantity: number;
  price: number;
  fee: number;
  time: number;
};

type Holding = {
  symbol: string;
  assetType?: "crypto" | "equity";
  quantity: number;
  avgCost: number;
  costBasis: number;
  realizedPnl: number;
  fees: number;
  price: number | null;
  value: number | null;
  unrealizedPnl: number | null;
  dayChange?: { abs: number; pct: number } | null;
};

const RANGES = [
  { key: "1d", label: "1D" }, { key: "1w", label: "1W" }, { key: "1m", label: "1M" },
  { key: "ytd", label: "YTD" }, { key: "1y", label: "1Y" }, { key: "2y", label: "2Y" },
  { key: "5y", label: "5Y" }, { key: "all", label: "All" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];
const RANGE_KEYS = RANGES.map((r) => r.key);

const money = fmtMoney;
const qty = quantity;

export default function SymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = use(params);
  const symbol = decodeURIComponent(raw).toUpperCase();

  const [holding, setHolding] = useState<Holding | null | undefined>(undefined);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [bars, setBars] = useState<{ t: number; c: number }[] | null>(null);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const hideAmounts = usePrivacy();
  const [range, setRange, rangeReady] = useStoredRange<RangeKey>(
    "nabla:range:asset", "1y", RANGE_KEYS,
  );
  const [changePct, setChangePct] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetch("/api/portfolios").then((r) => r.json()).catch(() => null);
      const id: string | undefined = list?.portfolios?.[0]?.id;
      if (!id || cancelled) { setHolding(null); return; }
      setPortfolioId(id);

      const [val, detail] = await Promise.all([
        fetch(`/api/portfolios/${id}/valuation`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/portfolios/${id}`).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (cancelled) return;
      setDisplayCurrency(val?.currency ?? "USD");
      const found: Holding | undefined = val?.holdings?.find((h: Holding) => h.symbol === symbol);
      setHolding(found ?? null);
      setTxs((detail?.portfolio.transactions ?? []).filter((t: Tx) => t.symbol === symbol));

    })();
    return () => { cancelled = true; };
  }, [symbol]);

  // Price history reloads when the period changes, not when the page does.
  useEffect(() => {
    if (holding === undefined || !rangeReady) return;
    let cancelled = false;
    setBars(null);
    const assetType = holding?.assetType ?? "crypto";
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { bars?: { t: number; c: number }[]; changePct?: number | null } | null) => {
        if (cancelled) return;
        setBars(d?.bars ?? []);
        setChangePct(d?.changePct ?? null);
      })
      .catch(() => { if (!cancelled) setBars([]); });
    return () => { cancelled = true; };
  }, [symbol, range, holding, rangeReady]);

  async function deleteTx(id: string) {
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    if (!portfolioId) return;
    const detail = await fetch(`/api/portfolios/${portfolioId}`).then((r) => r.json());
    setTxs((detail?.portfolio.transactions ?? []).filter((t: Tx) => t.symbol === symbol));
  }

  const pct = holding && holding.costBasis > 0 && holding.unrealizedPnl !== null
    ? (holding.unrealizedPnl / holding.costBasis) * 100
    : null;

  return (
    <main className="min-h-screen px-3 py-4 md:p-8 max-w-4xl mx-auto">
      <Link href="/portfolio" className="text-xs text-neutral-400 inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={14} aria-hidden />Portfolio
      </Link>

      <div className="flex items-center gap-3 mb-6">
        {holding === undefined
          ? <span className="w-10 h-10 rounded-full bg-neutral-900 border border-neutral-800 shrink-0" />
          : <CoinIcon symbol={symbol} size={40} assetType={holding?.assetType} />}
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-mono">{symbol}</h1>
          {holding && (
            <p className="text-xs text-neutral-500">
              {holding.assetType === "equity" ? "Stock / ETF" : "Crypto"} · {qty(holding.quantity)} held
            </p>
          )}
        </div>
        <span className="flex-1" />
        {holding?.value !== null && holding && (
          <div className="text-right">
            <div className="text-xl font-medium">{money(holding.value!)}</div>
            {holding.dayChange && (
              <div className={`text-xs ${holding.dayChange.pct >= 0 ? "text-green-500" : "text-red-500"}`}>
                {holding.dayChange.pct >= 0 ? "+" : ""}{holding.dayChange.pct.toFixed(2)}% today
              </div>
            )}
          </div>
        )}
      </div>

      {holding === undefined && <p className="text-sm text-neutral-500">Loading…</p>}
      {holding === null && (
        <p className="text-sm text-neutral-500">
          Nothing held in {symbol}. It may have been sold, or the ticker may not be in this portfolio.
        </p>
      )}

      {holding && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 text-sm mb-6">
            <Field label="Average cost" value={holding.quantity > 0 ? money(holding.avgCost) : "—"} />
            <Field label="Last price" value={holding.price !== null ? money(holding.price) : "no price"} />
            <Field label="Cost basis" value={money(holding.costBasis)} />
            <Field
              label="Unrealised"
              value={holding.unrealizedPnl !== null
                ? `${money(holding.unrealizedPnl)}${pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}`
                : "—"}
              signed={holding.unrealizedPnl ?? undefined}
            />
            <Field label="Realised" value={money(holding.realizedPnl)} signed={holding.realizedPnl} />
            <Field label="Fees" value={money(holding.fees)} />
          </div>

          <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2 py-1 text-xs rounded ${
                range === r.key ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {changePct !== null && (
          <span className={`text-sm ${changePct >= 0 ? "text-green-500" : "text-red-500"}`}>
            {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
            <span className="text-neutral-500 text-xs"> price, {RANGES.find((r) => r.key === range)?.label}</span>
          </span>
        )}
      </div>
      <PriceChart bars={bars} txs={txs} hideValues={hideAmounts} />

          <TransactionTable txs={txs} onDelete={deleteTx} />
        </>
      )}
    </main>
  );
}

function Field({ label, value, signed }: { label: string; value: string; signed?: number }) {
  const color =
    signed === undefined ? "text-neutral-200"
    : signed > 0 ? "text-green-500"
    : signed < 0 ? "text-red-500"
    : "text-neutral-200";
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={color}>{value}</div>
    </div>
  );
}

/** Price history with this portfolio's own buys and sells marked. */
function PriceChart({
  bars, txs, hideValues = false,
}: {
  bars: { t: number; c: number }[] | null;
  txs: Tx[];
  hideValues?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const line = useRef<ISeriesApi<"Line"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#d4d4d4" },
      grid: { vertLines: { color: "#171717" }, horzLines: { color: "#171717" } },
      autoSize: true,
      timeScale: { timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chart.current = c;
    line.current = c.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2 });
    markers.current = createSeriesMarkers(line.current);
    return () => { c.remove(); chart.current = null; line.current = null; markers.current = null; };
  }, []);

  const trades = useMemo(
    () => txs.filter((t) => t.side === "buy" || t.side === "sell").sort((a, b) => a.time - b.time),
    [txs],
  );

  // A price axis is a price: hide it with the rest of the amounts.
  useEffect(() => {
    chart.current?.applyOptions({ rightPriceScale: { visible: !hideValues } });
  }, [hideValues]);

  useEffect(() => {
    if (!line.current || !bars) return;
    line.current.setData(bars.map((b) => ({ time: Math.floor(b.t / 1000) as Time, value: b.c })));
    const first = bars[0]?.t ?? 0;
    markers.current?.setMarkers(
      trades.filter((t) => t.time >= first).map((t) => ({
        time: Math.floor(t.time / 1000) as Time,
        position: t.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
        color: t.side === "buy" ? "#22c55e" : "#ef4444",
        shape: t.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
        text: t.side === "buy" ? "B" : "S",
      })),
    );
  }, [bars, trades]);

  useFitChart(chart, container, bars);

  if (bars !== null && bars.length === 0) {
    return <p className="text-xs text-neutral-500">No price history available for this asset.</p>;
  }
  return <div ref={container} className="h-56 md:h-72 border border-neutral-800 rounded" />;
}

/**
 * The asset's trade log. Each row says what moved and what it left behind:
 * the position after it, and for a sale what that sale actually made — the
 * two questions a ledger is read for.
 */
function TransactionTable({ txs, onDelete }: { txs: Tx[]; onDelete: (id: string) => void }) {
  const [newestFirst, setNewestFirst] = useState(true);

  const rows = useMemo(() => {
    const annotated = annotateTransactions(txs);
    return newestFirst ? [...annotated].reverse() : annotated;
  }, [txs, newestFirst]);

  if (txs.length === 0) {
    return (
      <>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mt-8 mb-2">
          Transactions
        </h2>
        <p className="text-sm text-neutral-500">No transactions.</p>
      </>
    );
  }

  return (
    <section className="mt-8">
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Transactions
        </h2>
        <span className="text-xs text-neutral-500">{txs.length}</span>
        <span className="flex-1" />
        <button
          onClick={() => setNewestFirst((v) => !v)}
          className="text-xs text-neutral-400 inline-flex items-center gap-1"
        >
          {newestFirst ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />}
          {newestFirst ? "Newest first" : "Oldest first"}
        </button>
      </div>

      {/* Column headings only where there is room to align under them. */}
      <div className="hidden md:grid grid-cols-[6.5rem_5.5rem_1fr_1fr_1fr_1.5rem] gap-3 px-2 pb-1
                      text-xs text-neutral-500 border-b border-neutral-800">
        <span>Date</span>
        <span>Type</span>
        <span className="text-right">Quantity</span>
        <span className="text-right">Price</span>
        <span className="text-right">Value / result</span>
        <span />
      </div>

      <ul className="divide-y divide-neutral-800">
        {rows.map((tx) => {
          const incoming = tx.side === "buy" || tx.side === "transfer_in";
          const value = tx.quantity * tx.price;
          return (
            <li
              key={tx.id}
              className="grid grid-cols-[1fr_auto] md:grid-cols-[6.5rem_5.5rem_1fr_1fr_1fr_1.5rem]
                         gap-x-3 gap-y-1 items-center px-2 py-2 text-sm group"
            >
              <span className="text-neutral-400 text-xs md:text-sm order-1">
                {new Date(tx.time).toLocaleDateString(undefined, {
                  year: "numeric", month: "short", day: "numeric",
                })}
              </span>

              <span className={`order-3 md:order-2 justify-self-start text-xs px-2 py-0.5 rounded ${
                incoming ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400"
              }`}>
                {tx.side.replace("_", " ")}
              </span>

              <span className="order-4 md:order-3 md:text-right font-mono text-xs md:text-sm">
                {quantity(tx.quantity)}
              </span>

              <span className="order-5 md:order-4 md:text-right text-neutral-400 text-xs md:text-sm">
                {tx.price > 0 ? money(tx.price) : "—"}
                {tx.fee > 0 && (
                  <span className="text-neutral-600"> · fee {money(tx.fee)}</span>
                )}
              </span>

              <span className="order-2 md:order-5 justify-self-end md:text-right">
                {tx.realized !== null ? (
                  <span className={tx.realized >= 0 ? "text-green-500" : "text-red-500"}>
                    {tx.realized >= 0 ? "+" : ""}{money(tx.realized)}
                  </span>
                ) : (
                  <span className={incoming ? "text-neutral-200" : "text-neutral-400"}>
                    {value > 0 ? money(value) : "—"}
                  </span>
                )}
                <span className="block text-xs text-neutral-600">
                  held {quantity(tx.positionAfter)}
                </span>
              </span>

              <button
                onClick={() => onDelete(tx.id)}
                aria-label="Delete transaction"
                className="order-6 justify-self-end text-neutral-700 hover:text-red-500 md:opacity-0
                           md:group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-neutral-600 mt-2">
        Sales show what they realised against the average cost at the time.
      </p>
    </section>
  );
}

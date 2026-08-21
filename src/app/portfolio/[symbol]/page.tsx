"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  createChart, createSeriesMarkers, LineSeries,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time,
} from "lightweight-charts";
import { ArrowLeft, Trash2 } from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import { money as fmtMoney, quantity, setDisplayCurrency } from "@/lib/display";
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

      const assetType = found?.assetType ?? "crypto";
      const hist = await fetch(
        `/api/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}`,
      ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!cancelled) setBars(hist?.bars ?? []);
    })();
    return () => { cancelled = true; };
  }, [symbol]);

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
        <CoinIcon symbol={symbol} size={40} assetType={holding?.assetType} />
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

          <PriceChart bars={bars} txs={txs} hideValues={hideAmounts} />

          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mt-8 mb-2">
            Transactions ({txs.length})
          </h2>
          <ul className="divide-y divide-neutral-800">
            {txs.map((tx) => (
              <li key={tx.id} className="py-2 flex items-center gap-3 text-sm flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded w-24 text-center ${
                  tx.side === "buy" || tx.side === "transfer_in"
                    ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"
                }`}>{tx.side.replace("_", " ")}</span>
                <span>{qty(tx.quantity)} @ {money(tx.price)}</span>
                {tx.fee > 0 && <span className="text-neutral-500 text-xs">fee {money(tx.fee)}</span>}
                <span className="text-neutral-500 text-xs">{new Date(tx.time).toLocaleDateString()}</span>
                <span className="flex-1" />
                <button onClick={() => deleteTx(tx.id)}
                        className="text-xs underline text-red-500 inline-flex items-center gap-1">
                  <Trash2 size={12} aria-hidden />delete
                </button>
              </li>
            ))}
            {txs.length === 0 && <li className="py-2 text-sm text-neutral-500">No transactions.</li>}
          </ul>
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
      timeScale: { timeVisible: false },
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
    chart.current?.timeScale().fitContent();
  }, [bars, trades]);

  if (bars !== null && bars.length === 0) {
    return <p className="text-xs text-neutral-500">No price history available for this asset.</p>;
  }
  return <div ref={container} className="h-56 md:h-72 border border-neutral-800 rounded" />;
}

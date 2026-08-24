"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AreaSeries, createChart, createSeriesMarkers, LineType,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time,
} from "lightweight-charts";
import { chartTheme, directionColors, roseOverPeriod } from "@/components/chart-theme";
import {
  ArrowDown, ArrowLeft, ArrowUp, Bell, ChevronLeft, ChevronRight, Plus, Trash2,
} from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import { useDataClient } from "@/data/client/context";
import {
  marketMoney, money as fmtMoney, percent, quantity, setDisplayCurrency,
} from "@/lib/display";
import { assetName } from "@/lib/asset-names";
import { annotateTransactions } from "@/lib/portfolio";
import { useFitChart } from "@/components/useFitChart";
import { shapePoints, thinKeepingExtremes } from "@/lib/chart-data";
import { useStoredRange } from "@/components/useStoredRange";
import { KEYS } from "@/lib/storage-keys";
import { useCachedValuation, useLastPortfolio } from "@/components/useCachedValuation";
import StaleNote from "@/components/StaleNote";
import { usePrivacy } from "@/components/usePrivacy";
import TxForm, { type NewTx } from "@/components/TxForm";
import AssetInfoPanel from "@/components/AssetInfoPanel";
import RangePicker from "@/components/RangePicker";
import { RANGE_KEYS, rangeLabel, type RangeKey } from "@/lib/ranges";
import StatTile from "@/components/StatTile";
import EmptyState from "@/components/EmptyState";

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
  assetType?: "crypto" | "equity" | "cash";
  name?: string | null;
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

  const client = useDataClient();
  // Which portfolio the holding was opened from. Absent on a direct visit.
  const query = useSearchParams();
  const wantedId = query.get("p") || null;
  /**
   * What kind of asset this is, for a page reached without a holding to read
   * it off. Markets passes it; a bare URL falls back to the ticker's shape,
   * which is right for every USDT pair and for a suffixed European listing.
   */
  const linkedType = query.get("type") === "equity" ? "equity" as const
    : query.get("type") === "crypto" ? "crypto" as const : null;
  const [holding, setHolding] = useState<Holding | null | undefined>(undefined);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [bars, setBars] = useState<{ t: number; c: number }[] | null>(null);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const hideAmounts = usePrivacy();
  const [range, setRange, rangeReady] = useStoredRange<RangeKey>(
    KEYS.rangeAsset, "1y", RANGE_KEYS,
  );
  const [changePct, setChangePct] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The id arrives in the URL when this page is opened from the portfolio, so
  // the cached holding can be on screen before any request finishes. A direct
  // visit carries none and falls back to the portfolio last seen.
  const remembered = useLastPortfolio();
  const { cached, at: stale, remember } = useCachedValuation(portfolioId ?? wantedId ?? remembered);

  // The figures for this holding were on screen a moment ago on the portfolio
  // page; show them again rather than a spinner, then correct them. Derived
  // rather than copied into state, so there is only ever one answer.
  // Set during render, not in an effect: `money()` reads a module variable
  // rather than React state, so an effect would run after the figures below
  // had already been formatted — and with the cache derived rather than
  // copied into state there is no second render to correct them. The call is
  // an idempotent assignment, so repeating it costs nothing.
  if (cached?.currency) setDisplayCurrency(cached.currency);
  const cachedHolding = cached?.holdings.find((h) => h.symbol === symbol) as Holding | undefined;
  const shownHolding = holding === undefined ? cachedHolding : holding;
  /**
   * The holding knows best; without one, the link's hint; without that, the
   * ticker. A cash row is cast to crypto here as it always was — its history
   * request is refused either way, and narrowing would ask for coin bars under
   * a currency's name.
   */
  const resolvedType: "crypto" | "equity" =
    shownHolding?.assetType === "equity" ? "equity"
    : shownHolding?.assetType === "crypto" ? "crypto"
    : linkedType ?? (symbol.endsWith("USDT") ? "crypto" : "equity");
  /** Loaded, and this portfolio does not hold it. */
  const notHeld = shownHolding === null;
  const lastClose = bars && bars.length > 0 ? bars[bars.length - 1]!.c : null;
  const title = shownHolding?.name ?? assetName(symbol, resolvedType) ?? symbol;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Which portfolio has to be answered first — the two below are addressed
      // by its id — but they then go out together.
      //
      // The id travels in the URL because this screen has no other way to know
      // it: the selection lives in `/portfolio`'s own state and is not shared.
      // Defaulting to the first portfolio silently showed the wrong ledger for
      // anyone holding more than one, and it is how a scratch-portfolio test
      // once deleted a real transaction. The list is still fetched, both to
      // validate the parameter and to serve a direct visit that carries none.
      const list = await client.listPortfolios().catch(() => null);
      const wanted = wantedId && list?.some((p) => p.id === wantedId) ? wantedId : undefined;
      const id: string | undefined = wanted ?? list?.[0]?.id;
      if (!id || cancelled) { setHolding(null); return; }
      setPortfolioId(id);

      const [val, detail] = await Promise.all([
        client.getValuation(id).catch(() => null),
        client.getPortfolio(id).catch(() => null),
      ]);
      if (cancelled) return;
      setDisplayCurrency(val?.currency ?? "USD");
      if (val) remember(id, val);
      const found: Holding | undefined = val?.holdings.find((h) => h.symbol === symbol);
      // Only a valuation that actually arrived may say "nothing held here".
      // A failed one leaves the cached position on screen; with nothing
      // cached there is nothing to protect, so the empty state is the truth.
      if (val) setHolding(found ?? null);
      else if (!cachedHolding) setHolding(null);
      setTxs((detail?.transactions ?? []).filter((t) => t.symbol === symbol));

    })();
    return () => { cancelled = true; };
  }, [client, symbol, wantedId, remember, cachedHolding]);

  // Price history reloads when the period changes, not when the page does.
  useEffect(() => {
    if (shownHolding === undefined || !rangeReady) return;
    let cancelled = false;
    setBars(null);
    // A cash row has no price history and the request has always been refused
    // for one, landing in the catch below. The cast keeps that: narrowing here
    // instead would ask for crypto bars under a currency's name.
    const assetType = resolvedType;
    // The client encodes the symbol itself, so this must not — a dotted equity
    // ticker would otherwise arrive double-encoded.
    client.getHistory(symbol, assetType, range)
      .then((d) => {
        if (cancelled) return;
        setBars(d.bars);
        setChangePct(d.changePct);
      })
      .catch(() => { if (!cancelled) { setBars([]); setChangePct(null); } });
    return () => { cancelled = true; };
  }, [client, symbol, range, shownHolding, rangeReady, resolvedType]);

  const reload = useCallback(async () => {
    if (!portfolioId) return;
    const [detail, val] = await Promise.all([
      client.getPortfolio(portfolioId).catch(() => null),
      client.getValuation(portfolioId).catch(() => null),
    ]);
    setTxs((detail?.transactions ?? []).filter((t) => t.symbol === symbol));
    // The position and its cost move with every trade, so the tiles above the
    // table have to be refetched alongside it.
    const found: Holding | undefined = val?.holdings.find((h) => h.symbol === symbol);
    if (found) setHolding(found);
    // The setters are listed because the React Compiler infers them and
    // refuses to optimise the component when the written list disagrees.
    // They are stable, so naming them costs nothing.
  }, [client, portfolioId, symbol, setTxs, setHolding]);

  async function deleteTx(id: string) {
    // The delete's own answer has never been read here: the reload below is
    // what tells the user whether the row is gone.
    await client.deleteTransaction(id).catch(() => {});
    await reload();
  }

  async function addTransaction(tx: NewTx) {
    setFormError(null);
    // Same as the portfolio screen: with no portfolio loaded this used to post
    // to a route that answered 404 and produce this message.
    try {
      if (!portfolioId) throw new Error("no portfolio loaded");
      await client.addTransaction(portfolioId, tx);
    } catch {
      setFormError("Failed to add transaction — check the fields.");
      return;
    }
    await reload();
  }

  const pct = shownHolding && shownHolding.costBasis > 0 && shownHolding.unrealizedPnl !== null
    ? (shownHolding.unrealizedPnl / shownHolding.costBasis) * 100
    : null;

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-3 py-4 md:p-8 max-w-4xl mx-auto">
      <Link href="/portfolio" className="text-xs text-neutral-400 inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={14} aria-hidden />Portfolio
      </Link>

      <div className="flex items-center gap-3 mb-6">
        {shownHolding === undefined
          ? <span className="w-10 h-10 rounded-full bg-neutral-900 border border-neutral-800 shrink-0" />
          : <CoinIcon symbol={symbol} size={40} assetType={resolvedType} />}
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold truncate">{title}</h1>
          <p className="text-xs text-neutral-500">
            {/* The ticker earns its line only when the heading is a name.
                `assetName` knows a few hundred coins and no equities without a
                provider, so plenty of pages fall back to the ticker up there —
                and printing it twice reads as a rendering fault. */}
            {title !== symbol && <span className="font-mono">{symbol}{" · "}</span>}
            {resolvedType === "equity" ? "Stock / ETF" : "Crypto"}
            {shownHolding
              ? <>{" · "}{qty(shownHolding.quantity)} held</>
              : notHeld && <>{" · "}not in this portfolio</>}
          </p>
        </div>
        <span className="flex-1" />
        {/* What it is worth to you, or — when you hold none — simply what it
            costs. The second is a market price and not the owner's money, so
            it is not masked and says which period it moved over. */}
        {shownHolding && shownHolding.value !== null ? (
          <div className="text-right shrink-0">
            <div className="text-xl font-medium">{money(shownHolding.value)}</div>
            {shownHolding.dayChange && (
              <div className={`text-xs ${shownHolding.dayChange.pct >= 0 ? "text-green-500" : "text-red-500"}`}>
                {shownHolding.dayChange.pct >= 0 ? "+" : ""}{shownHolding.dayChange.pct.toFixed(2)}% today
              </div>
            )}
          </div>
        ) : lastClose !== null ? (
          <div className="text-right shrink-0">
            <div className="text-xl font-medium tabular-nums">{marketMoney(lastClose)}</div>
            {changePct !== null && (
              <div className={`text-xs ${changePct >= 0 ? "text-green-500" : "text-red-500"}`}>
                {percent(changePct)} <span className="text-neutral-500">{rangeLabel(range)}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {shownHolding === undefined && <p className="text-sm text-neutral-500">Loading…</p>}
      <StaleNote at={stale} />
      {shownHolding && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 text-sm mb-6">
            <StatTile label="Average cost" value={shownHolding.quantity > 0 ? money(shownHolding.avgCost) : "—"} />
            <StatTile label="Last price" value={shownHolding.price !== null ? money(shownHolding.price) : "no price"} />
            <StatTile label="Cost basis" value={money(shownHolding.costBasis)} />
            <StatTile
              label="Unrealised"
              value={shownHolding.unrealizedPnl !== null
                ? `${money(shownHolding.unrealizedPnl)}${pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}`
                : "—"}
              signed={shownHolding.unrealizedPnl ?? undefined}
            />
            <StatTile label="Realised" value={money(shownHolding.realizedPnl)} signed={shownHolding.realizedPnl} />
            <StatTile label="Fees" value={money(shownHolding.fees)} />
          </div>
        </>
      )}

      {/*
        Everything from here down is about the asset, not about your position
        in it, so it renders whether or not you hold any. It used to sit inside
        the gate above, which meant every Markets row led to an icon, a ticker
        and the words "Nothing held" — and a sold position reached the same
        dead end.
      */}
      {shownHolding !== undefined && (
        <>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
        <RangePicker value={range} onChange={setRange} />
        <span className="flex-1" />
        {changePct !== null && (
          <span className={`text-sm ${changePct >= 0 ? "text-green-500" : "text-red-500"}`}>
            {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
            <span className="text-neutral-500 text-xs"> price, {rangeLabel(range)}</span>
          </span>
        )}
      </div>
      {/* Crypto only. The detailed chart is fed by /api/candles, which is
          Binance, so an equity would open an empty pane — and a tap that
          leads nowhere is worse than no tap. */}
      {resolvedType === "crypto" ? (
        <Link
          href={`/chart?symbol=${encodeURIComponent(symbol)}`}
          aria-label={`Open ${symbol} in the detailed chart`}
          className="block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          <PriceChart bars={bars} txs={txs} hideValues={hideAmounts} />
        </Link>
      ) : (
        <PriceChart bars={bars} txs={txs} hideValues={hideAmounts} />
      )}

          <AssetInfoPanel symbol={symbol} assetType={resolvedType} />

          <section className="mt-8">
            <div className="flex items-baseline gap-2 mb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
                {notHeld ? "Start a position" : "Transactions"}
              </h2>
              {!notHeld && <span className="text-xs text-neutral-500">{txs.length}</span>}
              <span className="flex-1" />
              {/* Alerts live on their own page and their routes are
                  server-only by design, so this hands the ticker over rather
                  than growing a second, smaller alert form here. */}
              <Link
                href={`/alerts?symbol=${encodeURIComponent(symbol)}`}
                className="text-xs text-neutral-300 inline-flex items-center gap-1"
              >
                <Bell size={12} aria-hidden />Alert me
              </Link>
              <button
                onClick={() => setAddOpen((v) => !v)}
                className="text-xs text-neutral-300 inline-flex items-center gap-1"
              >
                <Plus size={12} aria-hidden />{addOpen ? "Close" : "Add"}
              </button>
            </div>
            {addOpen && (
              <TxForm onSubmit={addTransaction} error={formError} lockedSymbol={symbol}
                      livePrice={shownHolding?.price ?? lastClose} />
            )}
            {notHeld
              ? !addOpen && (
                  <EmptyState>
                    You hold none of this. Add a transaction to start tracking it here.
                  </EmptyState>
                )
              : <TransactionTable txs={txs} onDelete={deleteTx} />}
          </section>
        </>
      )}
    </main>
  );
}


/**
 * The time scale's own canvas, along the bottom of the container. Measured,
 * not guessed — the corner labels are placed from the plot above it.
 */
const AXIS_PX = 28;
/**
 * Share of the plot reserved above the high and below the low. Equal at both
 * ends, so the high sits at `EDGE` of the plot's height and the low at
 * `1 - EDGE` and each label lands on its own line without measuring.
 */
const EDGE = 0.1;

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
  const line = useRef<ISeriesApi<"Area"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      ...chartTheme(),
      autoSize: true,
      // No price axis, matching the portfolio's chart. `BRAND.md` used to make
      // this one the exception — "a price chart is read against its levels" —
      // and the levels are still there, as the high and low in the corners.
      // What the column actually cost was a fifth of a 390px screen and a
      // second chart idiom in an app with four of them.
      //
      // The margins are pinned for the same reason ValueChart pins them: the
      // two labels are placed from these fractions rather than measured.
      rightPriceScale: { visible: false, scaleMargins: { top: EDGE, bottom: EDGE } },
      timeScale: { timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chart.current = c;
    line.current = c.addSeries(AreaSeries, {
      // Recoloured with the data below. The line takes the period's direction,
      // as the portfolio's does; the buy and sell markers keep the same green
      // and red, which is a real overlap — they are triangles at the edge of a
      // bar against a two-pixel line, and the alternative was a third pair of
      // colours nobody has a meaning for.
      ...directionColors(true),
      lineWidth: 2,
      lineType: LineType.Curved,
      // The last value is printed in the header; a third rule competed with
      // the two that carry the range.
      priceLineVisible: false,
    });
    markers.current = createSeriesMarkers(line.current);
    return () => { c.remove(); chart.current = null; line.current = null; markers.current = null; };
  }, []);

  const trades = useMemo(
    () => txs.filter((t) => t.side === "buy" || t.side === "sell").sort((a, b) => a.time - b.time),
    [txs],
  );

  /** The period's high and low, which the corner labels claim. */
  const extent = useMemo(() => {
    if (!bars || bars.length === 0) return null;
    const closes = bars.map((b) => b.c);
    const hi = Math.max(...closes);
    const lo = Math.min(...closes);
    return hi > lo ? { hi, lo } : null;
  }, [bars]);


  useEffect(() => {
    if (!line.current || !bars) return;
    // `shapePoints`, as the portfolio chart uses — the register that makes a
    // week and a year read as the same kind of picture. `targetPoints` drew
    // this one three times as finely as every other line in the app.
    // Extremes are kept because the corner labels claim them.
    const points = thinKeepingExtremes(
      bars.map((b) => ({ t: b.t, v: b.c })),
      shapePoints(container.current?.clientWidth ?? 360),
    );
    line.current.setData(points.map((p) => ({ time: Math.floor(p.t / 1000) as Time, value: p.v })));
    line.current.applyOptions(directionColors(roseOverPeriod(points.map((p) => p.v))));
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
    return <EmptyState>No price history for this asset.</EmptyState>;
  }
  return (
    <div className="relative h-56 md:h-72 border border-neutral-800 rounded">
      <div ref={container} className="absolute inset-0" />
      {/* With the axis gone the levels have to come back somewhere, or the
          shape can flatter or alarm — a 2% wobble and a 40% drawdown draw the
          same curve. `z-10` because lightweight-charts fills the container
          with its own absolutely-positioned canvases and these would otherwise
          be painted behind them: present, sized, and never on screen. */}
      {extent && !hideValues && (
        <>
          <span
            style={{ top: `calc((100% - ${AXIS_PX}px) * ${EDGE})` }}
            className="pointer-events-none absolute z-10 right-2 -translate-y-full -mt-0.5 text-xs tabular-nums text-neutral-500"
          >
            {fmtMoney(extent.hi)}
          </span>
          <span
            style={{ top: `calc((100% - ${AXIS_PX}px) * ${1 - EDGE})` }}
            className="pointer-events-none absolute z-10 right-2 mt-0.5 text-xs tabular-nums text-neutral-500"
          >
            {fmtMoney(extent.lo)}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The asset's trade log. Each row says what moved and what it left behind:
 * the position after it, and for a sale what that sale actually made — the
 * two questions a ledger is read for.
 */
const PER_PAGE = 10;

function TransactionTable({ txs, onDelete }: { txs: Tx[]; onDelete: (id: string) => void }) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    // Annotation runs over the full history in order: a page's "held after"
    // figure depends on every trade before it, not just the ten on screen.
    const annotated = annotateTransactions(txs);
    return newestFirst ? [...annotated].reverse() : annotated;
  }, [txs, newestFirst]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  // Deleting the last row of the last page, or flipping the sort, must not
  // strand the reader on a page that no longer exists.
  const current = Math.min(page, pageCount - 1);
  useEffect(() => { if (page !== current) setPage(current); }, [page, current]);
  const visible = rows.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  if (txs.length === 0) {
    return <EmptyState>No transactions yet — add one with Add above.</EmptyState>;
  }

  return (
    <>
      <div className="flex items-baseline gap-2 mb-2">
        <button
          onClick={() => { setNewestFirst((v) => !v); setPage(0); }}
          className="text-xs text-neutral-400 inline-flex items-center gap-1"
        >
          {newestFirst ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />}
          {newestFirst ? "Newest first" : "Oldest first"}
        </button>
        <span className="flex-1" />
        {pageCount > 1 && (
          <span className="text-xs text-neutral-500">
            {current * PER_PAGE + 1}–{Math.min(rows.length, (current + 1) * PER_PAGE)} of {rows.length}
          </span>
        )}
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
        {visible.map((tx) => {
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

              <span className="order-4 md:order-3 md:text-right tabular-nums text-xs md:text-sm">
                {quantity(tx.quantity)}
              </span>

              <span className="order-5 md:order-4 md:text-right tabular-nums text-neutral-400 text-xs md:text-sm">
                {tx.price > 0 ? money(tx.price) : "—"}
                {tx.fee > 0 && (
                  <span className="text-neutral-600"> · fee {money(tx.fee)}</span>
                )}
              </span>

              <span className="order-2 md:order-5 justify-self-end md:text-right tabular-nums">
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
      {pageCount > 1 && (
        <nav className="flex items-center justify-between gap-2 mt-3" aria-label="Transaction pages">
          <button
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            className="text-xs text-neutral-300 inline-flex items-center gap-1 px-2 py-1 rounded
                       border border-neutral-800 disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft size={14} aria-hidden />Previous
          </button>
          <span className="text-xs text-neutral-500">Page {current + 1} of {pageCount}</span>
          <button
            onClick={() => setPage(current + 1)}
            disabled={current >= pageCount - 1}
            className="text-xs text-neutral-300 inline-flex items-center gap-1 px-2 py-1 rounded
                       border border-neutral-800 disabled:opacity-30 disabled:cursor-default"
          >
            Next<ChevronRight size={14} aria-hidden />
          </button>
        </nav>
      )}
      <p className="text-xs text-neutral-600 mt-2">
        Sales show what they realised against the average cost at the time.
      </p>
    </>
  );
}

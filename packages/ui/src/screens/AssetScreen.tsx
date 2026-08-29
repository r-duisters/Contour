"use client";

import { use, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { TxSide } from "@/lib/portfolio";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AreaSeries, createChart, createSeriesMarkers, LineType,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time,
} from "lightweight-charts";
import Sheet from "@/components/Sheet";
import { assetOf, pricingPair } from "@/core/symbols";
import { chartTheme, directionColors, roseOverPeriod } from "@/components/chart-theme";
import {
  ArrowDown, ArrowLeft, ArrowUp, Bell, ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2, X,
} from "lucide-react";
import CoinIcon from "@/components/CoinIcon";
import { useDataClient } from "@/data/client/context";
import {
  marketMoney, money as fmtMoney, percent, quantity, setDisplayCurrency,
} from "@/lib/display";
import { positionChangeOverWindow } from "@/lib/change";
import { assetName } from "@/lib/asset-names";
import { annotateTransactions } from "@/lib/portfolio";
import { useChartHref } from "@/components/routing";
import TransactionRow from "@/components/TransactionRow";
import AlertForm from "@/components/AlertForm";
import { useFitChart } from "@/components/useFitChart";
import { shapePoints, thinKeepingExtremes } from "@/lib/chart-data";
import { iconButton } from "@/components/icon-button";
import { useStoredRange } from "@/components/useStoredRange";
import { KEYS } from "@/lib/storage-keys";
import { useCachedValuation, useLastPortfolio } from "@/components/useCachedValuation";
import StaleNote from "@/components/StaleNote";
import { usePrivacy } from "@/components/usePrivacy";
import { useChartReadout } from "@/components/useChartReadout";
import TxForm, { type NewTx } from "@/components/TxForm";
import AssetInfoPanel from "@/components/AssetInfoPanel";
import RangePicker from "@/components/RangePicker";
import { RANGE_KEYS, changeWindowLabel, type RangeKey } from "@/lib/ranges";
import StatTile from "@/components/StatTile";
import EmptyState from "@/components/EmptyState";

type Tx = {
  id: string;
  symbol: string;
  side: TxSide;
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

/**
 * One asset's page, reading no route of its own.
 *
 * The two apps address it differently — a path segment on the web, a query
 * string on a device, because a static export cannot have a dynamic segment —
 * so each app's `page.tsx` does the reading and hands the three answers down.
 * See `routing.tsx`.
 */
export default function AssetScreen({
  symbol: raw, assetType: linkedType, portfolioId: wantedId,
}: {
  /** As the URL spelled it; already decoded by the router that read it. */
  symbol: string;
  /**
   * What kind of asset this is, for a page reached without a holding to read
   * it off. Markets passes it; a bare URL falls back to the ticker's shape,
   * which is right for every USDT pair and for a suffixed European listing.
   */
  assetType: "crypto" | "equity" | null;
  /** Which portfolio the holding was opened from. Absent on a direct visit. */
  portfolioId: string | null;
}) {
  // Both forms resolve, per the spec's second decision: `/portfolio/ETH` is the
  // honest URL and `/portfolio/ETHUSDT` is every link and bookmark that
  // predates the rename. Everything downstream compares assets too — the store
  // may still hold the pair, so matching a holding on the stored spelling
  // would lose it for exactly as long as the rename is pending.
  //
  // Applied here rather than in either router: it is what a symbol *means*,
  // not how a URL is shaped, and two routers normalising separately is two
  // places for them to disagree.
  const symbol = assetOf(raw);

  const client = useDataClient();
  const [holding, setHolding] = useState<Holding | null | undefined>(undefined);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [bars, setBars] = useState<{ t: number; c: number }[] | null>(null);
  /**
   * The latest close in the asset's own quote currency.
   *
   * Separate from `bars`, which are in the display currency. The transaction
   * form types a native price — USDT for a coin, the venue's currency for a
   * share — so offering it a converted figure would be wrong by the exchange
   * rate under a label that names the other one.
   */
  const [nativeClose, setNativeClose] = useState<{ value: number; currency: string } | null>(null);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const hideAmounts = usePrivacy();
  const [range, setRange, rangeReady] = useStoredRange<RangeKey>(
    KEYS.rangeAsset, "1y", RANGE_KEYS,
  );
  const [changePct, setChangePct] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  /**
   * Whether the header's two columns read as amounts rather than rates.
   *
   * Remembered across assets: it is a way of reading rather than a question
   * about this holding, and somebody who thinks in money thinks in money on
   * every page. Read once at mount, because a hook for one boolean that only
   * this screen has an opinion about would be a hook for its own sake.
   */
  const [ledgerOpen, setLedgerOpen] = useState(() => {
    try { return localStorage.getItem(KEYS.assetLedgerOpen) === "1"; } catch { return false; }
  });
  const ledgerId = useId();
  const [headerMoney, setHeaderMoney] = useState(() => {
    try { return localStorage.getItem(KEYS.headerShowsMoney) === "1"; } catch { return false; }
  });
  const [alertOpen, setAlertOpen] = useState(false);
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
  const cachedHolding = cached?.holdings.find((h) => assetOf(h.symbol) === symbol) as Holding | undefined;
  const shownHolding = holding === undefined ? cachedHolding : holding;
  // Read by the fetch effect without making it a dependency — see below.
  // Written in an effect rather than during render: the compiler rejects a
  // ref write in the render body, and the read happens after two awaits, long
  // after effects have flushed.
  const cachedRef = useRef(cachedHolding);
  useEffect(() => { cachedRef.current = cachedHolding; }, [cachedHolding]);
  /**
   * The holding knows best; without one, the link's hint; without that, the
   * ticker. A cash row is cast to crypto here as it always was — its history
   * request is refused either way, and narrowing would ask for coin bars under
   * a currency's name.
   */
  const knownType: "crypto" | "equity" | null =
    shownHolding?.assetType === "equity" ? "equity"
    : shownHolding?.assetType === "crypto" ? "crypto"
    : linkedType ?? null;
  /**
   * Null means not known yet, and the kind-dependent parts of the page wait
   * rather than guess. This used to read the ticker — `endsWith("USDT")` —
   * which worked only while every coin was stored as a pair. Once symbols
   * became assets, `ETH` stopped looking like a coin and every holding opened
   * as a stock for a few hundred milliseconds: the wrong icon, the words
   * "Stock / ETF", and a genuine request for whatever security trades under
   * that ticker, whose price was briefly drawn as if it were yours.
   *
   * The fallback is only reached by a hand-typed URL for something not held —
   * every link into this page carries the kind. A dot is a market suffix
   * (`ASML.AS`), which no coin has.
   */
  const resolvedType: "crypto" | "equity" =
    knownType ?? (symbol.includes(".") ? "equity" : "crypto");

  // Both null in the device build, which has neither screen to link at.
  //
  // The alert gets the asset's own spelling and its kind, not a Binance pair:
  // `pricingPair` answers ASML.ASUSDT for a share, which is not a market, and
  // an alert built on it could never be priced. Only the chart wants a pair,
  // and only because it really is a Binance market.
  const chartHref = useChartHref(pricingPair(symbol));
  // Read once so the button and the handler cannot disagree about whether the
  // capability is there — the same shape the settings screen uses.
  const createAlert = client.createAlert?.bind(client);
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
      const found: Holding | undefined = val?.holdings.find((h) => assetOf(h.symbol) === symbol);
      // Only a valuation that actually arrived may say "nothing held here".
      // A failed one leaves the cached position on screen; with nothing
      // cached there is nothing to protect, so the empty state is the truth.
      if (val) setHolding(found ?? null);
      else if (!cachedRef.current) setHolding(null);
      setTxs((detail?.transactions ?? []).filter((t) => assetOf(t.symbol) === symbol));

    })();
    return () => { cancelled = true; };
    // `cachedHolding` is deliberately absent: it is derived from the cache
    // object this effect itself replaces through `remember`, so listing it
    // made the effect its own trigger — valuation, portfolio and history
    // refetched roughly three times a second, for as long as the page stayed
    // open. It is read through a ref instead, which is what it was ever used
    // for: a yes/no on whether anything is already on screen to protect.
  }, [client, symbol, wantedId, remember]);

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
        setNativeClose(d.nativeClose);
        setChangePct(d.changePct);
      })
      .catch(() => {
        if (!cancelled) { setBars([]); setNativeClose(null); setChangePct(null); }
      });
    return () => { cancelled = true; };
  }, [client, symbol, range, shownHolding, rangeReady, resolvedType]);

  const reload = useCallback(async () => {
    if (!portfolioId) return;
    const [detail, val] = await Promise.all([
      client.getPortfolio(portfolioId).catch(() => null),
      client.getValuation(portfolioId).catch(() => null),
    ]);
    setTxs((detail?.transactions ?? []).filter((t) => assetOf(t.symbol) === symbol));
    // The position and its cost move with every trade, so the tiles above the
    // table have to be refetched alongside it.
    const found: Holding | undefined = val?.holdings.find((h) => assetOf(h.symbol) === symbol);
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

  // The period's price move expressed in money, using what is held here. Null
  // when nothing is held or nothing is priced, which is the state this page is
  // in whenever it is reached from Markets rather than from the portfolio —
  // and null too when the window opened before the position did, where the
  // figure would describe money that was never at stake.
  //
  // Both bounds come from what is already on screen: the window starts at the
  // first bar the chart drew, and the position starts at its earliest
  // transaction. No duration table, and no disagreement with the chart.
  const rangeMoney = positionChangeOverWindow({
    value: shownHolding?.value ?? null,
    pct: changePct,
    heldSince: txs.length > 0 ? Math.min(...txs.map((t) => t.time)) : null,
    windowStart: bars && bars.length > 0 ? bars[0]!.t : null,
  });

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-3 py-4 md:p-8 max-w-4xl mx-auto">
      {/*
        This page's top bar. `BRAND.md` gives every screen a label on the left
        and circular icon buttons on the right; here the back link is the
        label, because an asset page is somewhere you arrived from somewhere
        else.

        The two actions were text buttons in the "Transactions" heading, which
        put them below a chart and a background panel — a scroll away on a
        phone, and on the half of the page about the *holding* rather than the
        asset. They are the two things a person opens this page to do, so they
        are where the thumb already is. Both sheets moved up with them: a
        trigger that outlives its sheet is a button that does nothing while the
        page is still resolving what it holds.
      */}
      <div className="flex items-center gap-2 mb-4">
        <Link href="/portfolio" className="text-xs text-neutral-400 inline-flex items-center gap-1">
          <ArrowLeft size={14} aria-hidden />Portfolio
        </Link>
        <span className="flex-1" />
        {/*
          Feature-detected, not asked about. `createAlert` is optional because
          dispatch needs Home Assistant, web-push or FCM and an APK has none of
          them — so the button is absent where the capability is, exactly as
          the settings screen treats `sendTestNotification`.
        */}
        {createAlert && (
          <button
            onClick={() => setAlertOpen((v) => !v)}
            aria-label={alertOpen ? "Close alert" : `Alert on ${symbol}`}
            aria-expanded={alertOpen}
            className={iconButton()}
          >
            {alertOpen ? <X size={16} aria-hidden /> : <Bell size={16} aria-hidden />}
          </button>
        )}
        <button
          onClick={() => setAddOpen((v) => !v)}
          aria-label={addOpen ? "Close add transaction" : "Add transaction"}
          aria-expanded={addOpen}
          className={iconButton()}
        >
          {addOpen ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
        </button>
      </div>

      <Sheet open={alertOpen} onClose={() => setAlertOpen(false)} title={`Alert on ${symbol}`}>
        <div className="p-3">
          <AlertForm
            symbol={symbol}
            // `knownType`, not `resolvedType`: null means the page does
            // not yet know, and the form says so rather than guessing.
            // The fallback exists for drawing a chart, not for deciding
            // which venue prices an alert.
            assetType={knownType}
            livePrice={shownHolding?.price ?? null}
            // The sheet stays open so the form can say what it did.
            // Closing it on submit threw away the one confirmation there
            // is — the alert was created and the screen said nothing,
            // which is indistinguishable from the button not working.
            onSubmit={async (alert) => { await createAlert!(alert); }}
          />
        </div>
      </Sheet>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a transaction">
        <div className="p-3">
          {/* `nativeClose`, not the holding's `price` and not the bars: the
              holding is valued in the *display* currency and so are the bars
              now, while this field is in the asset's own. Measured on the live
              ledger, AMD reads 457.58 natively and €389.13 on the holding —
              the same asset, differing by the exchange rate. */}
          <TxForm onSubmit={addTransaction} error={formError} lockedSymbol={symbol}
                  assetType={resolvedType} livePrice={nativeClose?.value ?? null} />
        </div>
      </Sheet>

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
            {knownType === null ? "—" : knownType === "equity" ? "Stock / ETF" : "Crypto"}
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
            {/*
              Two periods side by side, rather than the day alone.
              ==================================================

              The header answered "what is it worth" and "what did it do
              today", and left "what has it made since I bought it" four rows
              down in a tile. Both readings a person comes here for now sit in
              the same block, labelled, so neither is a figure you have to know
              where to look for.

              This is *narrower* than the line it replaced, which is the part
              worth recording: that line was a rate and an amount together —
              "-2,33% -€400,05 today" — and two short rates stacked in columns
              take less width at 412px than a rate beside a money figure. It
              was measured on the longest name in the ledger, Advanced Micro
              Devices: 186px of room for the name before, 193px after, so it
              still truncates but truncates less. (The mock-up promised 12px
              and the built version gives 7 — BRAND.md's 11px floor for the
              column labels costs the other five, and the floor wins.)

              The amounts are one tap away rather than gone. Rates by default
              because the tiles below already state both amounts, so the header
              says how fast and the tiles say how much; tapping swaps the
              header to amounts for somebody who would rather read it the other
              way round.
            */}
            {shownHolding.dayChange && shownHolding.unrealizedPnl !== null ? (
              <button
                type="button"
                onClick={() => {
                  const next = !headerMoney;
                  setHeaderMoney(next);
                  try { localStorage.setItem(KEYS.headerShowsMoney, next ? "1" : "0"); } catch {
                    // Blocked storage costs the choice on the next page, not data.
                  }
                }}
                aria-label={headerMoney
                  ? "Show these as percentages"
                  : "Show these as amounts"}
                // Negative margin against the padding, so the tap target is
                // taller than the text without moving anything in the row.
                className="flex gap-3.5 justify-end -my-2 py-2 -mr-1 pr-1 rounded
                           hover:bg-neutral-900/60 active:bg-neutral-900 transition-colors
                           focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                <ChangeColumn
                  /* A coin's day is a rolling 24 hours and matches the chart's
                     own 1D figure. A share's day is the session before this
                     one, because its market was shut for most of the last
                     twenty-four hours. The label follows the measurement. */
                  label={shownHolding.assetType === "equity" ? "Today" : "24h"}
                  value={headerMoney
                    ? signedMoney(shownHolding.dayChange.abs)
                    : `${shownHolding.dayChange.pct >= 0 ? "+" : ""}${shownHolding.dayChange.pct.toFixed(2)}%`}
                  signed={headerMoney ? shownHolding.dayChange.abs : shownHolding.dayChange.pct}
                />
                <ChangeColumn
                  label="Since bought"
                  value={headerMoney
                    ? signedMoney(shownHolding.unrealizedPnl)
                    : pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                  signed={headerMoney ? shownHolding.unrealizedPnl : pct}
                />
              </button>
            ) : shownHolding.dayChange && (
              /* No cost basis to measure against — a position that is all
                 realised, or one whose rows carry no price. The day stands
                 alone rather than beside an empty column. */
              <div className={`text-xs ${shownHolding.dayChange.pct >= 0 ? "text-green-500" : "text-red-500"}`}>
                {shownHolding.dayChange.pct >= 0 ? "+" : ""}{shownHolding.dayChange.pct.toFixed(2)}%
                {" "}
                <span className="tabular-nums">
                  {shownHolding.dayChange.abs >= 0 ? "+" : ""}{money(shownHolding.dayChange.abs)}
                </span>
                {shownHolding.assetType === "equity" ? " today" : " 24h"}
              </div>
            )}
          </div>
        ) : lastClose !== null ? (
          <div className="text-right shrink-0">
            <div className="text-xl font-medium tabular-nums">{marketMoney(lastClose)}</div>
            {changePct !== null && (
              <div className={`text-xs ${changePct >= 0 ? "text-green-500" : "text-red-500"}`}>
                {percent(changePct)} <span className="text-neutral-500">{changeWindowLabel(range)}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {shownHolding === undefined && <p className="text-sm text-neutral-500">Loading…</p>}
      <StaleNote at={stale} />
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
            {/* What that price move is worth on the position. Absent when
                nothing is held here — this page renders for assets reached
                from Markets, where there is no quantity to apply it to. */}
            {rangeMoney !== null && (
              <> <span className="tabular-nums">
                {rangeMoney >= 0 ? "+" : ""}{money(rangeMoney)}
              </span></>
            )}
            <span className="text-neutral-500 text-xs"> price, {changeWindowLabel(range)}</span>
          </span>
        )}
      </div>
      {/* Crypto only, and only where the chart page exists. It is fed by
          /api/candles, which is Binance, so an equity would open an empty pane
          — and a tap that leads nowhere is worse than no tap. In the device
          build it leads somewhere worse than nowhere: out of the static export
          and into a restart, which is why the seam answers null there. */}
      {resolvedType === "crypto" && chartHref ? (
        <Link
          // The destination addresses a venue, not a holding: the chart proxies
          // Binance klines, so it wants the pair.
          href={chartHref}
          aria-label={`Open ${symbol} in the detailed chart`}
          className="block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          <PriceChart bars={bars} txs={txs} hideValues={hideAmounts} />
        </Link>
      ) : (
        <PriceChart bars={bars} txs={txs} hideValues={hideAmounts} />
      )}

          {/*
            Two figures under the chart, not six above it.
            ============================================

            Six equal tiles opened this page — average cost, last price, cost
            basis, unrealised, realised, fees — roughly 380px of numbers before
            any chart on a 412px phone. The common task is a glance, and a
            glance was made to scroll for it.

            These two are the pair read *while looking at the chart above*:
            what it costs now on the left, beside the axis the line just ended
            at, and what it cost you on average on the right. The distance
            between them is the position, and putting them side by side is the
            cheapest way to state it.

            Unrealised has left the tiles entirely — it is the header's second
            column now, beside the day, where both readings sit together.
          */}
          {shownHolding && (
            <div className="grid grid-cols-2 gap-2 md:gap-3 text-sm mt-4">
              <StatTile label="Last price" value={shownHolding.price !== null ? money(shownHolding.price) : "no price"} />
              <StatTile label="Average cost" value={shownHolding.quantity > 0 ? money(shownHolding.avgCost) : "—"} />
            </div>
          )}

          {/*
            The rest folds out rather than being deleted. "Cost basis and
            realised are the point of a portfolio tool versus watching a candle
            on TradingView" — they are wanted, just not on every glance, and
            the cost of demoting them is one tap for somebody reconciling.
            Which is why the fold is remembered: that person is reading several
            holdings in one sitting, and re-opening it on each would be the
            annoying half of the trade.
          */}
          {shownHolding && (
            <>
              <button
                onClick={() => {
                  const next = !ledgerOpen;
                  setLedgerOpen(next);
                  try { localStorage.setItem(KEYS.assetLedgerOpen, next ? "1" : "0"); } catch {
                    // Blocked storage costs a tap on the next asset, not data.
                  }
                }}
                aria-expanded={ledgerOpen}
                aria-controls={ledgerId}
                className="mt-2 w-full min-h-11 flex items-center justify-center gap-1.5 rounded
                           border border-dashed border-neutral-800 text-xs text-neutral-400
                           hover:border-neutral-700 hover:text-neutral-300 transition-colors
                           focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                Cost basis, realised, fees
                <ChevronDown
                  size={14}
                  aria-hidden
                  className={`transition-transform ${ledgerOpen ? "rotate-180" : ""}`}
                />
              </button>
              {ledgerOpen && (
                <div id={ledgerId} className="grid grid-cols-2 sm:grid-cols-3 gap-2 md:gap-3 text-sm mt-2">
                  <StatTile label="Cost basis" value={money(shownHolding.costBasis)} />
                  <StatTile label="Realised" value={money(shownHolding.realizedPnl)} signed={shownHolding.realizedPnl} />
                  <StatTile label="Fees" value={money(shownHolding.fees)} />
                </div>
              )}
            </>
          )}

          {/* Waits for the kind rather than asking about the wrong asset:
              a background panel fetched as an equity describes a listed
              security that merely shares the ticker. */}
          {knownType !== null && <AssetInfoPanel symbol={symbol} assetType={knownType} />}

          <section className="mt-8">
            <div className="flex items-baseline gap-2 mb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
                {notHeld ? "Start a position" : "Transactions"}
              </h2>
              {!notHeld && <span className="text-xs text-neutral-500">{txs.length}</span>}
            </div>
            {/* The empty state no longer hides while the form is open: an
                inline form pushed it down the page, and a sheet covers it. */}
            {notHeld
              ? <EmptyState>
                  You hold none of this. Add a transaction with + at the top to
                  start tracking it here.
                </EmptyState>
              : <TransactionTable txs={txs} onDelete={deleteTx} />}
          </section>
        </>
      )}
    </main>
  );
}


/**
 * A gain with its sign written, so the two readings of this pair agree.
 *
 * `money` prints a minus and nothing for a plus, which is right in a column of
 * figures where most are positive. Here it sat beside a percentage that always
 * carries its sign, so switching the pair to amounts silently dropped the plus
 * from a gain and kept the minus on a loss — the same number looking like two
 * different kinds of thing depending on which way it was being read.
 */
function signedMoney(n: number): string {
  return `${n >= 0 ? "+" : ""}${money(n)}`;
}

/**
 * One labelled figure in the header's change pair.
 *
 * The label sits above the value rather than beside it, which is what keeps
 * the pair narrow: two stacked columns of six characters each are less wide
 * than the same figures written out in a sentence.
 */
function ChangeColumn({
  label, value, signed,
}: {
  label: string;
  value: string;
  /** Decides the colour. Null leaves it neutral rather than guessing a gain. */
  signed: number | null;
}) {
  const tone = signed === null ? "text-neutral-400" : signed >= 0 ? "text-green-500" : "text-red-500";
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <span className={`text-xs tabular-nums ${tone}`}>{value}</span>
    </span>
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

  /**
   * The same press-and-hold reading the portfolio chart has. This chart is a
   * near-copy of `ValueChart` rather than an instance of it — it carries trade
   * markers the shared component has no notion of — so the readout has to be
   * repeated here. Without it this was the one chart in the app where holding
   * a finger down produced a date and no figure.
   */
  const at = useChartReadout(chart, [line]);
  const reading = at && at.values[0] !== null ? { t: at.t, value: at.values[0]! } : null;

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
      {/* Left, so it clears the high and low pinned to the right edge. */}
      {reading && !hideValues && (
        <div className="pointer-events-none absolute z-10 left-2 top-2 text-xs">
          <div className="tabular-nums text-neutral-200">{fmtMoney(reading.value)}</div>
          <div className="text-neutral-500">
            {new Date(reading.t).toLocaleDateString(undefined, {
              day: "numeric", month: "short", year: "numeric",
            })}
          </div>
        </div>
      )}
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

      {/*
        One row at every width, which is what "in line with the rest" means
        here: `BRAND.md` describes the holdings row as the same row at two
        densities, and this is that row. What it replaces was a single grid
        that reflowed with `order-*` — six parts shuffled into two columns on a
        phone, three visual lines per transaction, and a figure sitting above
        the label explaining it.
      */}
      <ul className="divide-y divide-neutral-800">
        {visible.map((tx) => (
          <TransactionRow
            key={tx.id}
            side={tx.side}
            quantity={tx.quantity}
            price={tx.price}
            fee={tx.fee}
            time={tx.time}
            positionAfter={tx.positionAfter}
            realized={tx.realized}
            onDelete={() => onDelete(tx.id)}
          />
        ))}
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

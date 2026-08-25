import { assetName } from "@/core/asset-names";
import { cached } from "@/core/cache";
import { cashBalances } from "@/core/cash";
import { toDisplayTxs } from "@/core/display-tx";
import { currencyForTicker } from "@/core/equity";
import { rateOn } from "@/core/fx";
import { flowsByYear, realisedByYear, tradeStats, type TradeStats } from "@/core/insights";
import { computeHoldings, valueHoldings, type ValuedHolding } from "@/core/portfolio";
import { pricingPair } from "@/core/symbols";
import type { Net } from "../ports/net";
import type { Store, Transaction } from "../ports/store";
import { fetchKlinesRange, fetchPricesSafe } from "../sources/binance";
import { makeEquitySource } from "../sources/equity";
import { fetchEcbRates } from "../sources/fx";
import { getPortfolio } from "./portfolios";
import { displayContext, displayContextAt, fetchCrypto24hAgo, fetchEquityPricesUsd } from "./pricing";

const DAY_MS = 86_400_000;

export type DayChange = { abs: number; pct: number };

export type AssetRow = ValuedHolding & {
  assetType: "crypto" | "equity";
  name: string | null;
  dayChange: DayChange | null;
};

export type CashRow = {
  /**
   * A negative balance cannot be real money: it means the ledger records
   * withdrawals whose matching deposits are missing.
   */
  unreliable: boolean;
  symbol: string;
  name: string | null;
  assetType: "cash";
  quantity: number;
  avgCost: number;
  costBasis: number;
  realizedPnl: number;
  fees: number;
  price: number;
  value: number;
  unrealizedPnl: number;
  dayChange: null;
};

export type Totals = {
  dayChange: { abs: number; pct: number; covered: number } | null;
  value: number;
  cash: number;
  invested: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  fees: number;
};

export type Valuation = {
  holdings: (AssetRow | CashRow)[];
  totals: Totals;
  currency: "USD" | "EUR";
  /** Always 1: the figures above are already in `currency`. Kept for compatibility. */
  rate: number;
};

/**
 * What a portfolio holds and what it is worth right now, in the display
 * currency.
 *
 * Everything is computed in that currency. Trades settled in it use the amount
 * actually paid; the rest convert from USD at the current rate. Re-converting a
 * 2017 EUR purchase through today's USD rate would misstate the cost basis,
 * which is what this avoids.
 *
 * The value series is deliberately not here: it needs full price history per
 * symbol and would otherwise hold the headline numbers hostage for seconds.
 * `series` fetches it separately.
 */
export async function valuation(store: Store, net: Net, id: string): Promise<Valuation> {
  const portfolio = await getPortfolio(store, id);
  const { currency, toDisplay, displayUsd, equityProvider, equityApiKey } =
    await displayContext(store, net);

  const assetRows = portfolio.transactions.filter((t) => t.assetType !== "cash");
  const txs = toDisplayTxs(assetRows, currency, toDisplay);

  const equitySymbols = new Set(
    portfolio.transactions.filter((t) => t.assetType === "equity").map((t) => t.symbol),
  );
  const holdings = computeHoldings(txs);
  const held = holdings.filter((h) => h.quantity > 0).map((h) => h.symbol);
  const cryptoSymbols = held.filter((s) => !equitySymbols.has(s));
  const heldEquities = held.filter((s) => equitySymbols.has(s));

  // Asked for by pair, reported by asset: the store may hold either form while
  // the rename is pending, and Binance only knows the pair.
  const pairOf = new Map(cryptoSymbols.map((s) => [s, pricingPair(s)]));

  const [cryptoPrices, equityPrices, cryptoDayAgo] = await Promise.all([
    fetchPricesSafe(net, [...pairOf.values()]),
    fetchEquityPricesUsd(net, heldEquities, equityProvider, equityApiKey),
    fetchCrypto24hAgo(net, [...pairOf.values()]),
  ]);
  const prices: Record<string, number> = {};
  const prevCloses: Record<string, number> = {};
  for (const [symbol, pair] of pairOf) {
    const usd = cryptoPrices[pair];
    if (usd !== undefined) prices[symbol] = usd * toDisplay;
    const prev = cryptoDayAgo[pair];
    if (prev !== undefined) prevCloses[symbol] = prev * toDisplay;
  }
  for (const [sym, q] of Object.entries(equityPrices)) {
    prices[sym] = q.price * toDisplay;
    if (q.prevClose !== undefined) prevCloses[sym] = q.prevClose * toDisplay;
  }

  const cashHoldings = await valueCash(net, portfolio.transactions, currency);

  const valued: AssetRow[] = valueHoldings(holdings, prices).map((h) => {
    const prev = prevCloses[h.symbol];
    const dayChange = h.price !== null && prev !== undefined && prev > 0
      ? { abs: (h.price - prev) * h.quantity, pct: ((h.price - prev) / prev) * 100 }
      : null;
    const assetType = equitySymbols.has(h.symbol) ? ("equity" as const) : ("crypto" as const);
    return {
      ...h,
      assetType,
      name: assetName(h.symbol, assetType, equityPrices[h.symbol]?.name),
      // Carried for the allocation grouping only. Absent for crypto, and for
      // any equity provider that does not report it — those group as shares.
      instrumentType: equityPrices[h.symbol]?.instrumentType,
      dayChange,
    };
  });

  // Day change covers only holdings with a comparison price; its base is their
  // value alone, so the percentage is not diluted by unpriced assets.
  //
  // The aggregate deliberately blends two bases: a rolling 24 hours for coins,
  // the previous session close for shares. They cannot be reconciled — a
  // market that shuts has no price a day ago — and no screen renders this
  // total today, so nothing currently labels it. Anything that starts to must
  // say which window it means, or say that it means both.
  const all = [...valued, ...cashHoldings];
  const withDay = valued.filter((h) => h.dayChange !== null && h.quantity > 0);
  const dayAbs = sum(withDay.map((h) => h.dayChange!.abs));
  const dayBase = sum(withDay.map((h) => (h.value ?? 0) - h.dayChange!.abs));

  const cashValue = sum(cashHoldings.filter((h) => !h.unreliable).map((h) => h.value));
  const totals: Totals = {
    dayChange: withDay.length > 0
      ? { abs: dayAbs, pct: dayBase > 0 ? (dayAbs / dayBase) * 100 : 0, covered: withDay.length }
      : null,
    // Cash counts towards what the portfolio is worth, never towards its P&L.
    value: sum(valued.map((h) => h.value ?? 0)) + cashValue,
    cash: cashValue,
    invested: sum(valued.map((h) => h.value ?? 0)),
    costBasis: sum(valued.filter((h) => h.quantity > 0).map((h) => h.costBasis)),
    unrealizedPnl: sum(valued.map((h) => h.unrealizedPnl ?? 0)),
    realizedPnl: sum(valued.map((h) => h.realizedPnl)),
    fees: sum(valued.map((h) => h.fees)),
  };

  return {
    holdings: all,
    totals,
    // A failed EUR lookup leaves the figures in USD, so the label has to follow.
    // `displayContext` keeps `currency` as the raw setting because it also
    // decides which stored trades count as natively priced; only the label the
    // caller sees is relabelled here.
    currency: displayUsd > 0 ? currency : "USD",
    rate: 1,
  };
}

/**
 * Today's rate from each held currency into the display currency.
 *
 * Exported because the value series has to convert cash exactly as this does,
 * or the line will not end on the figure printed above it. A currency whose
 * rate cannot be fetched is absent from the map rather than assumed to be 1 —
 * leaving it out understates the total, where guessing would misstate it.
 *
 * Today's rate, deliberately, even for a balance held years ago: the whole
 * value series is already reported in today's currency terms, and giving cash
 * a per-day rate while the holdings keep one would make the two halves of a
 * single line disagree about what a euro is.
 */
export async function currentCashRates(
  net: Net,
  currencies: string[],
  currency: "USD" | "EUR",
): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  for (const cur of currencies) {
    if (cur === currency) { rates.set(cur, 1); continue; }
    try {
      const window = await fetchEcbRates(net, cur, currency, Date.now() - 10 * DAY_MS, Date.now());
      const r = rateOn(window, Date.now());
      if (r) rates.set(cur, r);
    } catch {
      // leave it out rather than guess
    }
  }
  return rates;
}

/** Cash balances: deposits and withdrawals, less what trades spent. */
async function valueCash(
  net: Net,
  transactions: Transaction[],
  currency: "USD" | "EUR",
): Promise<CashRow[]> {
  const balances = cashBalances(transactions);
  const cashRates = await currentCashRates(net, Object.keys(balances), currency);
  return Object.entries(balances)
    .filter(([cur]) => cashRates.has(cur))
    .map(([cur, amount]) => {
      const value = amount * cashRates.get(cur)!;
      // Report a negative balance, but never let it subtract from the
      // portfolio's worth.
      const unreliable = amount < 0;
      return {
        unreliable,
        symbol: cur,
        name: assetName(cur, "cash"),
        assetType: "cash" as const,
        quantity: amount,
        avgCost: 1,
        costBasis: value,
        realizedPnl: 0,
        fees: 0,
        price: cashRates.get(cur)!,
        value,
        unrealizedPnl: 0,
        dayChange: null,
      };
    });
}

export type SnapshotRow = {
  symbol: string;
  assetType: "crypto" | "equity" | "cash";
  quantity: number;
  price: number | null;
  value: number | null;
};

export type Snapshot = {
  date: string;
  currency: "USD" | "EUR";
  rows: SnapshotRow[];
  total: number;
  /** Absent — not zero — when the portfolio held nothing on the date. */
  unpriced?: number;
};

/**
 * What the portfolio held, and what it was worth, on one date.
 *
 * Dutch box 3 is assessed on wealth held at the start of the year, so the
 * figure needed each January is a valuation at a past date, not today's — which
 * is why this uses `displayContextAt` rather than `displayContext`.
 */
export async function snapshot(
  store: Store,
  net: Net,
  id: string,
  date: string,
): Promise<Snapshot> {
  const at = Date.parse(`${date}T00:00:00Z`);
  // The route rejects this with a 400 before ever getting here; the guard is
  // for the device build, which has no route in front of it.
  if (!Number.isFinite(at)) throw new RangeError(`unparseable date: ${date}`);
  const day = Math.floor(at / DAY_MS) * DAY_MS;

  const portfolio = await getPortfolio(store, id);
  const { currency, toDisplay, equityProvider, equityApiKey } =
    await displayContextAt(store, net, at);

  // Everything as it stood on the date: later transactions do not exist yet.
  const upTo = portfolio.transactions.filter((t) => Number(t.time) <= at + DAY_MS);
  if (upTo.length === 0) return { date, currency, rows: [], total: 0 };

  const assetRows = upTo.filter((t) => t.assetType !== "cash");
  const txs = toDisplayTxs(assetRows, currency, toDisplay);
  const holdings = computeHoldings(txs).filter((h) => h.quantity > 1e-12);
  const equity = new Set(upTo.filter((t) => t.assetType === "equity").map((t) => t.symbol));

  const source = makeEquitySource(net, equityProvider, equityApiKey);
  const fxCache = new Map<string, Map<number, number>>();

  const priced: SnapshotRow[] = await Promise.all(holdings.map(async (h) => {
    let price: number | null = null;
    try {
      if (equity.has(h.symbol)) {
        const years = Math.max(1, Math.min(10, Math.ceil((Date.now() - at) / (365 * DAY_MS)) + 1));
        const rows = await cached(`snap-eq:${h.symbol}:${years}`, 3_600_000, async () =>
          source.history ? await source.history(h.symbol, `${years}y`, "1d") : [],
        );
        const before = rows.filter((r) => r.t <= at + DAY_MS);
        const native = before[before.length - 1]?.c ?? null;
        const cur = currencyForTicker(h.symbol);
        if (native !== null) {
          if (cur === currency) price = native;
          else {
            if (!fxCache.has(cur)) {
              fxCache.set(cur, await fetchEcbRates(net, cur, currency, at - 10 * DAY_MS, at + DAY_MS)
                .catch(() => new Map<number, number>()));
            }
            const rate = rateOn(fxCache.get(cur)!, at);
            price = rate === null ? null : native * rate;
          }
        }
      } else {
        const bars = await cached(`snap-cx:${h.symbol}:${day}`, 3_600_000, () =>
          fetchKlinesRange(net, { symbol: h.symbol, interval: "1d", from: at - 7 * DAY_MS, to: at + DAY_MS }),
        );
        const usd = bars[bars.length - 1]?.c ?? null;
        price = usd === null ? null : usd * toDisplay;
      }
    } catch {
      price = null;
    }
    return {
      symbol: h.symbol,
      assetType: equity.has(h.symbol) ? ("equity" as const) : ("crypto" as const),
      quantity: h.quantity,
      price,
      value: price === null ? null : h.quantity * price,
    };
  }));

  // Cash as it stood on the date, converted at that date's rate.
  const balances = cashBalances(upTo);
  const cashRows: SnapshotRow[] = [];
  for (const [cur, amount] of Object.entries(balances)) {
    let rate = 1;
    if (cur !== currency) {
      if (!fxCache.has(cur)) {
        fxCache.set(cur, await fetchEcbRates(net, cur, currency, at - 10 * DAY_MS, at + DAY_MS)
          .catch(() => new Map<number, number>()));
      }
      const r = rateOn(fxCache.get(cur)!, at);
      if (r === null) continue;
      rate = r;
    }
    cashRows.push({
      symbol: cur, assetType: "cash", quantity: amount, price: rate, value: amount * rate,
    });
  }

  const rows = [...priced, ...cashRows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return {
    date,
    currency,
    rows,
    total: rows.reduce((a, r) => a + (r.value ?? 0), 0),
    unpriced: rows.filter((r) => r.value === null).length,
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export type Insights = {
  currency: "USD" | "EUR";
  stats: TradeStats;
  /** Money in and out per year. Not profit — see `realisedByYear`. */
  byYear: { year: number; net: number }[];
  /** Profit actually taken per year, average-cost basis. */
  realisedByYear: { year: number; realised: number }[];
};

/**
 * Statistics derived from the transaction log alone — no market data, so this
 * answers instantly while the valuation and series calls are still running.
 *
 * It lives beside `valuation` and `snapshot` rather than in `portfolios.ts`
 * because it is the same kind of thing they are: one portfolio's figures,
 * already converted into the display currency. `portfolios.ts` is storage in,
 * storage out, and this needs a `Net` to price the currency.
 */
export async function insights(store: Store, net: Net, id: string): Promise<Insights> {
  const portfolio = await getPortfolio(store, id);
  const { currency, toDisplay, displayUsd } = await displayContext(store, net);

  // Moving euros between a bank and an exchange is not a trade, and counting
  // it as one inflated every figure here.
  const txs = toDisplayTxs(
    portfolio.transactions.filter((t) => t.assetType !== "cash"),
    currency,
    toDisplay,
  );

  return {
    // Same relabelling as `valuation`: a failed EUR lookup leaves the figures
    // in USD, so the label has to follow. `displayContext` keeps `currency`
    // raw because it also decides which stored trades count as natively
    // priced.
    currency: displayUsd > 0 ? currency : "USD",
    stats: tradeStats(txs),
    byYear: flowsByYear(txs),
    realisedByYear: realisedByYear(txs),
  };
}

import { describe, expect, it } from "vitest";
import {
  evaluatePortfolioMove, expandPortfolioRules, expandRules, latchUnpriced, unpricedSymbols,
  type AlertRule, type HeldAsset,
} from "./alert-rules";
import { evaluatePositionPnl } from "./alerts";

/**
 * The alert that fires on the number a person actually watches.
 *
 * Not because per-asset rules miss broad falls — they cannot. A portfolio's
 * move is the value-weighted average of its holdings' moves, so it is bounded
 * by its largest mover: if the total falls 4%, something in it fell at least
 * 4%, and a 4% per-asset rule would have fired. At one threshold this kind
 * fires strictly *less* often than `pct_move`.
 *
 * Its value is that the two thresholds are not the same question. "Any holding
 * moved 5%" is noise from whichever position happens to be smallest — a 5%
 * move in 2% of the book is 0.1% of the money. "My portfolio moved 2%" is a
 * statement about wealth, and it cannot be expressed today at any threshold,
 * because there is no rule whose subject is the total.
 *
 * So: fewer notifications, each naming the portfolio rather than a ticker, at
 * a threshold set against what a bad day actually looks like.
 */

const rule = (params: unknown, over: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1", kind: "portfolio_move", symbol: null, portfolioId: "p1", params: params as never, ...over,
});
const held: HeldAsset[] = [
  { symbol: "BTC", assetType: "crypto", quantity: 0.5 },
  { symbol: "ASML.AS", assetType: "equity", quantity: 10 },
];

describe("expanding a portfolio-level rule", () => {
  it("produces one check for the rule, not one per holding", () => {
    const out = expandPortfolioRules([rule({ threshold: 3 })], held);
    expect(out).toHaveLength(1);
    expect(out[0]!.holdings).toHaveLength(2);
  });

  /** The whole point: `expandRules` must not also see it, or it fires twice. */
  it("is invisible to the per-symbol expander", () => {
    expect(expandRules([rule({ threshold: 3 })], held)).toEqual([]);
  });

  /**
   * A coin is priced as a Binance pair and a share as its bare ticker — the
   * same asymmetry `expandRules` documents, for the same reason: `ASML.ASUSDT`
   * is not a market and the equity providers want `ASML.AS`.
   */
  it("asks each venue for the symbol it understands", () => {
    const [check] = expandPortfolioRules([rule({ threshold: 3 })], held);
    expect(check!.holdings.map((h) => h.symbol)).toEqual(["BTCUSDT", "ASML.AS"]);
  });

  /**
   * Cash does not move against itself. Including it would damp every
   * percentage by the share of the book sitting in currency — a 4% fall in the
   * assets arriving as 3% because a quarter is euros.
   */
  it("leaves cash out of the total", () => {
    const withCash: HeldAsset[] = [...held, { symbol: "EUR", assetType: "crypto", quantity: 5000 }];
    const [check] = expandPortfolioRules([rule({ threshold: 3 })], withCash);
    expect(check!.holdings.map((h) => h.symbol)).not.toContain("EURUSDT");
  });

  it("skips a rule that names a symbol, a rule with no portfolio, and bad params", () => {
    expect(expandPortfolioRules([rule({ threshold: 3 }, { symbol: "BTC" })], held)).toEqual([]);
    expect(expandPortfolioRules([rule({ threshold: 3 }, { portfolioId: null })], held)).toEqual([]);
    expect(expandPortfolioRules([rule({ threshold: -1 })], held)).toEqual([]);
    expect(expandPortfolioRules([rule({ threshold: 3 }, { enabled: false })], held)).toEqual([]);
  });

  /** No quantity means no total worth computing. */
  it("produces nothing when the holdings carry no quantities", () => {
    const noQty: HeldAsset[] = [{ symbol: "BTC", assetType: "crypto" }];
    expect(expandPortfolioRules([rule({ threshold: 3 })], noQty)).toEqual([]);
  });
});

describe("evaluating it", () => {
  const [check] = expandPortfolioRules([rule({ threshold: 3 })], held);
  // 0.5 BTC at 40,000 and 10 ASML at 600 → 26,000 the day before.
  const before = { BTCUSDT: 40_000, "ASML.AS": 600 };

  it("weights by position size, so a big move in a small holding is not a big move", () => {
    // ASML is 6,000 of the 26,000 book. Down 10% on its own is 2.3% of the
    // money — under a 3% rule, while a per-asset rule at 3% would have fired.
    expect(evaluatePortfolioMove(check!, { BTCUSDT: 40_000, "ASML.AS": 540 }, before)).toBeNull();
    // The same 10%, on the holding that is 20,000 of it, is 7.7%.
    expect(evaluatePortfolioMove(check!, { BTCUSDT: 36_000, "ASML.AS": 600 }, before))
      .toEqual({ direction: "down", pct: expect.closeTo(-7.6923, 3) });
  });

  it("fires on a broad fall as one notification rather than several", () => {
    // Both down 4%: two per-asset alerts today, one portfolio alert here.
    expect(evaluatePortfolioMove(check!, { BTCUSDT: 38_400, "ASML.AS": 576 }, before))
      .toEqual({ direction: "down", pct: expect.closeTo(-4, 6) });
  });

  it("reports direction, so a fall after a rise is different news", () => {
    expect(evaluatePortfolioMove(check!, { BTCUSDT: 44_000, "ASML.AS": 660 }, before))
      .toEqual({ direction: "up", pct: expect.closeTo(10, 6) });
  });

  /**
   * The honest failure. A total computed from some of its parts is a different
   * portfolio's move, so a missing price answers null rather than reporting the
   * sum of whatever happened to price.
   */
  it("answers null when any holding is unpriced, rather than totalling the rest", () => {
    expect(evaluatePortfolioMove(check!, { BTCUSDT: 30_000 }, before)).toBeNull();
    expect(evaluatePortfolioMove(check!, { BTCUSDT: 30_000, "ASML.AS": 600 }, { BTCUSDT: 40_000 }))
      .toBeNull();
    expect(evaluatePortfolioMove(check!, { BTCUSDT: NaN, "ASML.AS": 600 }, before)).toBeNull();
  });

  it("answers null when the earlier total is not positive", () => {
    expect(evaluatePortfolioMove(check!, { BTCUSDT: 1, "ASML.AS": 1 }, { BTCUSDT: 0, "ASML.AS": 0 }))
      .toBeNull();
  });
});

/**
 * The kind that reads the ledger rather than the market.
 *
 * A price target asks what something is worth; this asks what it has done for
 * the person holding it. Two people watching the same ticker want different
 * numbers, and only one of them is in this app.
 */
describe("a position's return against a threshold", () => {
  const heldWithCost: HeldAsset[] = [
    { symbol: "ETH", assetType: "crypto", quantity: 2, avgCost: 2000 },
  ];
  const pnl = (params: unknown, over: Partial<AlertRule> = {}): AlertRule => ({
    id: "n1", kind: "position_pnl", symbol: null, portfolioId: "p1", params: params as never, ...over,
  });

  it("carries the average cost onto the check, since a return needs one", () => {
    const [check] = expandRules([pnl({ direction: "up", pct: 50 })], heldWithCost);
    expect(check).toMatchObject({ kind: "position_pnl", avgCost: 2000, pnlPct: 50, pnlDirection: "up" });
  });

  /**
   * You cannot be up 50% on something you do not own. A rule about an unheld
   * asset produces no check rather than an unanswerable one — and costs no
   * price request either.
   */
  it("produces nothing for an asset that is not held", () => {
    const named = pnl({ direction: "up", pct: 50 }, { symbol: "BTC", portfolioId: null });
    expect(expandRules([named], heldWithCost)).toEqual([]);
  });

  /** A grant recorded at zero would otherwise report an infinite gain. */
  it("produces nothing when the position has no cost to measure against", () => {
    const free: HeldAsset[] = [{ symbol: "ETH", assetType: "crypto", quantity: 2, avgCost: 0 }];
    expect(expandRules([pnl({ direction: "up", pct: 50 })], free)).toEqual([]);
  });

  it("fires up and down on their own sides, and not on the other's", () => {
    expect(evaluatePositionPnl({ direction: "up", pct: 50 }, 2000, 3000)).toEqual({ pct: 50 });
    expect(evaluatePositionPnl({ direction: "up", pct: 50 }, 2000, 2999)).toBeNull();
    expect(evaluatePositionPnl({ direction: "down", pct: 20 }, 2000, 1600)).toEqual({ pct: -20 });
    expect(evaluatePositionPnl({ direction: "down", pct: 20 }, 2000, 1601)).toBeNull();
    // A loss does not satisfy a gain rule, however large.
    expect(evaluatePositionPnl({ direction: "up", pct: 50 }, 2000, 100)).toBeNull();
  });

  it("refuses a cost that cannot produce a percentage", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(evaluatePositionPnl({ direction: "up", pct: 10 }, bad, 100)).toBeNull();
    }
    expect(evaluatePositionPnl({ direction: "up", pct: 10 }, 100, NaN)).toBeNull();
  });
});

/**
 * Saying the alerts are blind, which is the one thing silence cannot say.
 */
describe("reporting symbols that could not be priced", () => {
  const wanted = [
    { symbol: "BTCUSDT", name: "BTC" },
    { symbol: "ETHUSDT", name: "ETH" },
  ];

  it("names the ones missing from the answer", () => {
    expect(unpricedSymbols(wanted, { BTCUSDT: 40_000 })).toEqual([{ symbol: "ETHUSDT", name: "ETH" }]);
  });

  /**
   * The distinction the whole thing rests on. Nothing priced means the network
   * or a provider was down — telling somebody their portfolio is broken
   * because their train went into a tunnel is worse than silence, and it
   * teaches them to ignore the message that matters.
   */
  it("says nothing when nothing priced, because that is not the symbols' fault", () => {
    expect(unpricedSymbols(wanted, {})).toEqual([]);
  });

  it("says nothing when everything priced", () => {
    expect(unpricedSymbols(wanted, { BTCUSDT: 1, ETHUSDT: 2 })).toEqual([]);
  });

  /** A portfolio rule expands to many checks on one symbol; one report. */
  it("reports a symbol once however many rules watch it", () => {
    const twice = [...wanted, { symbol: "ETHUSDT", name: "ETH" }];
    expect(unpricedSymbols(twice, { BTCUSDT: 1 })).toHaveLength(1);
  });

  /** Falls back to the asset, so a coin is named ETH rather than ETHUSDT. */
  it("names the asset when the caller gives no name", () => {
    expect(unpricedSymbols([{ symbol: "ETHUSDT" }, { symbol: "BTCUSDT" }], { BTCUSDT: 1 }))
      .toEqual([{ symbol: "ETHUSDT", name: "ETH" }]);
  });
});

/**
 * Once per outage, not once a day forever.
 *
 * The stale notice first shipped on the day-based dedupe every other kind
 * uses, which is right for a market doing something and wrong for a delisted
 * coin: that fails to price every morning for good, and saying so every
 * morning is a machine nagging about something nobody can fix.
 */
describe("latching the unpriced report", () => {
  const dead = [{ symbol: "DEADUSDT", name: "DEAD" }];

  it("reports a symbol the first time and not the second", () => {
    const first = latchUnpriced(dead, ["BTCUSDT"], {}, 1000);
    expect(first.report).toEqual(dead);
    const second = latchUnpriced(dead, ["BTCUSDT"], first.reported, 2000);
    expect(second.report).toEqual([]);
    // And the mark survives, so the third morning is quiet too.
    expect(second.reported).toHaveProperty("DEADUSDT");
  });

  /** A market that comes back and breaks again is news a second time. */
  it("forgets a symbol that prices again, so a later break is reported", () => {
    const first = latchUnpriced(dead, ["BTCUSDT"], {}, 1000);
    const recovered = latchUnpriced([], ["BTCUSDT", "DEADUSDT"], first.reported, 2000);
    expect(recovered.reported).toEqual({});
    expect(latchUnpriced(dead, ["BTCUSDT"], recovered.reported, 3000).report).toEqual(dead);
  });

  it("keeps marks for symbols that are still unpriced", () => {
    const state = { DEADUSDT: 1000, OTHERUSDT: 900 };
    const out = latchUnpriced([], ["BTCUSDT"], state, 2000);
    expect(out.reported).toEqual(state);
  });
});

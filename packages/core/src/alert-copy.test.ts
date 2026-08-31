import { describe, expect, it } from "vitest";
import {
  indicatorNotice, moveNotice, portfolioMoveNotice, priceTargetNotice,
} from "./alert-copy";

/**
 * The failure being designed against is not an ugly sentence. It is a figure
 * somebody acts on and is wrong about: every notification this app sent
 * carried a bare number, and the currency behind it depended on the asset —
 * dollars for AMD, euros for ASML.AS, USDT for a coin — with nothing on screen
 * to say which.
 */
describe("priceTargetNotice", () => {
  it("names the currency, because the number alone means nothing", () => {
    expect(priceTargetNotice({
      name: "AMD", direction: "above", target: 500, price: 512.06,
      currency: "USD", oneShot: true,
    })).toEqual({
      title: "AMD rose above 500 USD",
      body: "Now 512.06 USD · this one-shot alert has switched itself off",
    });
  });

  it("says a standing alert is still watching, so silence is not ambiguous", () => {
    // The two are otherwise identical, and the difference decides whether
    // somebody expects to hear about this again.
    expect(priceTargetNotice({
      name: "BTC", direction: "below", target: 90_000, price: 89_500,
      currency: "USDT", oneShot: false,
    })).toEqual({
      title: "BTC fell below 90,000 USDT",
      body: "Now 89,500 USDT · still watching",
    });
  });

  it("keeps a sub-cent coin readable rather than rounding it to nothing", () => {
    const n = priceTargetNotice({
      name: "SHIB", direction: "above", target: 0.000024, price: 0.0000241,
      currency: "USDT", oneShot: true,
    });
    expect(n.title).toContain("0.000024 USDT");
    expect(n.body).toContain("0.0000241 USDT");
  });
});

describe("moveNotice", () => {
  it("states the period, because a percentage without one is not a fact", () => {
    expect(moveNotice({
      name: "ETH", direction: "up", pct: 5.23, from: 2388.2, price: 2512.4,
      currency: "USDT",
    })).toEqual({
      title: "ETH up 5.2% in 24 hours",
      body: "2,388.2 USDT → 2,512.4 USDT",
    });
  });

  it("names the rule when it watches everything, not just the asset it fired on", () => {
    // These fire on a symbol nobody chose. Without the rule's name there is no
    // route from the notification to the switch that turns it off.
    const n = moveNotice({
      name: "SHIB", direction: "up", pct: 12.4, from: 0.0000214, price: 0.0000241,
      currency: "USDT", portfolio: "Main",
    });
    expect(n.body).toContain("From your daily move rule on Main");
  });

  it("reports a fall as a fall, with the size unsigned", () => {
    const n = moveNotice({
      name: "BTC", direction: "down", pct: -7.8, from: 100_000, price: 92_200,
      currency: "USDT",
    });
    expect(n.title).toBe("BTC down 7.8% in 24 hours");
  });
});

describe("indicatorNotice", () => {
  it("keeps the script's own vocabulary rather than inventing friendlier words", () => {
    expect(indicatorNotice({
      name: "BTC", signal: "long", price: 118_234.5, currency: "USDT", timeframe: "1d",
    })).toEqual({
      title: "BTC long signal",
      body: "118,234.5 USDT on the 1d chart",
    });
  });
});

/**
 * The portfolio notice has one job the others do not: saying what its own
 * number leaves out.
 *
 * A delisted holding is excluded from the total rather than silencing the
 * alert, so the percentage is about part of the book. Unsaid, that is a figure
 * describing a portfolio the reader does not have — which is the failure this
 * whole file is written against, arriving by a new route.
 */
describe("portfolioMoveNotice", () => {
  const base = {
    portfolio: "Main", direction: "down" as const, pct: -4.2,
    from: 26_000, value: 24_908, currency: "EUR",
  };

  it("says nothing extra when every holding priced", () => {
    expect(portfolioMoveNotice(base)).toEqual({
      title: "Main down 4.2% in 24 hours",
      body: "26,000 EUR → 24,908 EUR",
    });
    // An empty list is the same as no list — a caller that always passes the
    // field must not produce a dangling clause.
    expect(portfolioMoveNotice({ ...base, skipped: [] }).body).toBe("26,000 EUR → 24,908 EUR");
  });

  it("names what the total was computed without, as an asset rather than a pair", () => {
    expect(portfolioMoveNotice({ ...base, skipped: ["LUNAUSDT"] }).body)
      .toBe("26,000 EUR → 24,908 EUR · excludes LUNA, not priced");
    expect(portfolioMoveNotice({ ...base, skipped: ["LUNAUSDT", "FTTUSDT"] }).body)
      .toContain("excludes LUNA and FTT, not priced");
  });

  /** Six tickers in a notification body is a list nobody reads. */
  it("counts them once there are too many to name", () => {
    expect(portfolioMoveNotice({ ...base, skipped: ["A", "B", "C"] }).body)
      .toContain("excludes 3 holdings, not priced");
  });
});

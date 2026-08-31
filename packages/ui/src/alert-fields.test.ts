import { describe, expect, it } from "vitest";
import { alertFields, alertSymbol } from "./alert-fields";

describe("alertSymbol", () => {
  it("keeps the pair for a coin, because the alert addresses a market", () => {
    expect(alertSymbol("BTC", "crypto")).toBe("BTCUSDT");
    // Idempotent: the page may hand it either spelling.
    expect(alertSymbol("BTCUSDT", "crypto")).toBe("BTCUSDT");
  });

  it("keeps the bare ticker for a share, which has no pair", () => {
    // `pricingPair` answers ASML.ASUSDT, which is not a market and which
    // nothing can price. This asymmetry is the whole point of the function.
    expect(alertSymbol("ASML.AS", "equity")).toBe("ASML.AS");
    expect(alertSymbol("AMD", "equity")).toBe("AMD");
  });
});

describe("alertFields", () => {
  const draft = { direction: "above" as const, price: "100", repeat: false };

  it("passes a coin through as a pair and a share as itself", () => {
    expect(alertFields("ETH", "crypto", draft)).toMatchObject({ ok: true, symbol: "ETHUSDT" });
    expect(alertFields("ASML.AS", "equity", draft)).toMatchObject({ ok: true, symbol: "ASML.AS" });
  });

  it("waits rather than guessing while the kind is unknown", () => {
    // Guessing from the ticker is how a renamed coin briefly opens as a stock
    // and draws another security's price.
    expect(alertFields("ETH", null, draft)).toEqual({
      ok: false, error: "Still working out what this asset is.",
    });
  });

  it("refuses a price that is not one", () => {
    for (const price of ["", "0", "-5", "abc"]) {
      expect(alertFields("ETH", "crypto", { ...draft, price })).toMatchObject({ ok: false });
    }
  });

  it("reads a comma as a decimal point, which half of Europe types", () => {
    expect(alertFields("ETH", "crypto", { ...draft, price: "3200,50" }))
      .toMatchObject({ ok: true, price: 3200.5 });
  });

  it("carries the direction through", () => {
    expect(alertFields("ETH", "crypto", { direction: "below", price: "1", repeat: false }))
      .toMatchObject({ ok: true, direction: "below" });
  });
});


/**
 * One-shot or standing is the person's choice now, and the draft is the only
 * place that says which. A field that did not travel would silently make every
 * alert one-shot again — the behaviour it replaced — with the switch still
 * moving.
 */
describe("repeat", () => {
  it("carries the choice through to the alert", () => {
    const standing = alertFields("BTC", "crypto", { direction: "above", price: "70000", repeat: true });
    expect(standing).toMatchObject({ ok: true, repeat: true });

    const oneShot = alertFields("BTC", "crypto", { direction: "above", price: "70000", repeat: false });
    expect(oneShot).toMatchObject({ ok: true, repeat: false });
  });
});

/**
 * The return question, which the same form asks about the holder rather than
 * the market. Two gates, and both matter: the mode is only *offered* where
 * there is a position, and validated here even so — a form that can only be
 * reached one way is still a form.
 */
describe("a return rule from the asset page", () => {
  const draft = {
    mode: "return" as const, direction: "above" as const, price: "",
    pnlDirection: "up" as const, pnlPct: "50", repeat: true,
  };

  it("builds a position_pnl rule against the portfolio holding it", () => {
    expect(alertFields("ETH", "crypto", draft, "p1")).toEqual({
      ok: true, kind: "position_pnl", symbol: "ETHUSDT", assetType: "crypto",
      portfolioId: "p1", direction: "up", pct: 50, repeat: true,
    });
  });

  /** A return needs a position, and a position lives in a portfolio. */
  it("refuses without a portfolio, in words rather than silently", () => {
    expect(alertFields("ETH", "crypto", draft, null))
      .toEqual({ ok: false, error: "This only works on something you hold." });
  });

  it("refuses a percentage that is not one", () => {
    for (const pct of ["", "0", "-5", "abc"]) {
      const r = alertFields("ETH", "crypto", { ...draft, pnlPct: pct }, "p1");
      expect(r.ok).toBe(false);
    }
    // A comma decimal is a percentage, and half of Europe types it.
    expect(alertFields("ETH", "crypto", { ...draft, pnlPct: "12,5" }, "p1"))
      .toMatchObject({ ok: true, pct: 12.5 });
  });

  /** The same asymmetry the price path has: a pair for a coin, a bare ticker
   *  for a share. `ASML.ASUSDT` is not a market. */
  it("keeps the venue's own spelling", () => {
    expect(alertFields("ASML.AS", "equity", draft, "p1")).toMatchObject({ symbol: "ASML.AS" });
  });

  /** Absent the mode, this is the form it has always been. */
  it("still builds a price target when the mode is not set", () => {
    expect(alertFields("ETH", "crypto", { direction: "above", price: "4000", repeat: false }, "p1"))
      .toMatchObject({ ok: true, price: 4000, direction: "above" });
  });
});

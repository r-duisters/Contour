import { describe, expect, it } from "vitest";
import { TxInput, TxPatch } from "./tx";

describe("TxPatch", () => {
  /**
   * The guard that matters. `.partial()` makes keys optional but keeps their
   * defaults, so any `.default()` added to `TxInput` later would start
   * appearing in patch bodies that never mentioned it — silently overwriting
   * a stored value with the default. Asserting the whole object is empty
   * catches the next such field, not just `fee`.
   */
  it("invents no fields from an empty body", () => {
    expect(TxPatch.parse({})).toEqual({});
  });

  it("leaves an unmentioned fee absent so the update cannot clear it", () => {
    const parsed = TxPatch.parse({ price: 5 });
    expect(parsed).toEqual({ price: 5 });
    expect("fee" in parsed).toBe(false);
  });

  it("still accepts and validates a fee that is sent", () => {
    expect(TxPatch.parse({ fee: 2.5 })).toEqual({ fee: 2.5 });
    expect(TxPatch.safeParse({ fee: -1 }).success).toBe(false);
  });

  it("keeps every other field optional and validated", () => {
    expect(TxPatch.parse({ side: "sell" })).toEqual({ side: "sell" });
    expect(TxPatch.safeParse({ quantity: 0 }).success).toBe(false);
  });
});

describe("TxInput", () => {
  /** Creation is the one place the default belongs: a new row needs a number. */
  it("defaults a missing fee to 0 on create", () => {
    const parsed = TxInput.parse({
      symbol: "BTCUSDT", side: "buy", quantity: 1, price: 100, time: 1_700_000_000_000,
    });
    expect(parsed.fee).toBe(0);
  });
});

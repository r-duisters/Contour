import { describe, expect, it } from "vitest";
import { TxInput, TxPatch } from "./tx";

/**
 * `TxPatch` exists because `.partial()` keeps defaults. `carried-forward.md`
 * records what that cost: a PATCH that only changed a price arrived carrying
 * `fee: 0`, and the update wrote that zero over the stored fee — editing a
 * price silently erased part of a cost basis.
 *
 * Every optional field added to `TxInput` since is another chance to make the
 * same mistake, so the guard is one assertion over the whole schema rather
 * than one per field.
 */
describe("TxPatch", () => {
  it("stays empty for an empty body", () => {
    expect(TxPatch.parse({})).toEqual({});
  });

  it("carries only what was named", () => {
    expect(TxPatch.parse({ price: 5 })).toEqual({ price: 5 });
  });

  it("still lets a PATCH set the asset type and source deliberately", () => {
    expect(TxPatch.parse({ assetType: "cash", sourceSymbol: "SHELL.AS" }))
      .toEqual({ assetType: "cash", sourceSymbol: "SHELL.AS" });
  });

  it("accepts an explicit null source, which is how one is cleared", () => {
    expect(TxPatch.parse({ sourceSymbol: null })).toEqual({ sourceSymbol: null });
  });
});

describe("TxInput", () => {
  it("keeps the fee default, because a created row needs a number", () => {
    const parsed = TxInput.parse({
      symbol: "BTC", side: "buy", quantity: 1, price: 100, time: 1_700_000_000_000,
    });
    expect(parsed.fee).toBe(0);
    // The asset type is not defaulted here: the POST route supplies "crypto"
    // itself, so a default would only serve to reach TxPatch.
    expect(parsed.assetType).toBeUndefined();
  });

  it("accepts income as a side", () => {
    expect(TxInput.parse({
      symbol: "EUR", side: "income", quantity: 120, price: 0,
      time: 1_700_000_000_000, assetType: "cash", sourceSymbol: "SHELL.AS",
    }).side).toBe("income");
  });
});

import { describe, expect, it } from "vitest";
import { priceCurrency, toNewTx } from "./tx-fields";

describe("priceCurrency", () => {
  it("is the chosen quote for a coin", () => {
    expect(priceCurrency("ETH", "crypto", "EUR")).toBe("EUR");
  });

  it("is the venue's currency for an equity, whatever was chosen", () => {
    // ASML trades in euros and cannot trade in anything else. A quote picked
    // for a previous coin must not leak onto it.
    expect(priceCurrency("ASML.AS", "equity", "USDT")).toBe("EUR");
    expect(priceCurrency("AMD", "equity", "EUR")).toBe("USD");
  });

  it("defaults a coin to USDT, which is what a price usually means", () => {
    expect(priceCurrency("ETH", "crypto", null)).toBe("USDT");
  });
});

describe("toNewTx", () => {
  const fields = {
    symbol: "eth", side: "buy" as const, quantity: "2", price: "2000",
    fee: "1.5", when: "2024-03-01T12:00", currency: "EUR",
  };

  it("carries the typed figure and the currency it was typed in", () => {
    const tx = toNewTx(fields)!;
    expect(tx).toMatchObject({
      symbol: "ETH", side: "buy", quantity: 2,
      nativeCurrency: "EUR", nativePrice: 2000, nativeFee: 1.5,
    });
  });

  it("does not convert — that is the service's job, on the trade's date", () => {
    // Two screens converting independently is how they come to disagree, and
    // a browser has no business knowing March's exchange rate.
    const tx = toNewTx(fields)!;
    expect(tx.price).toBe(2000);
    expect(tx.nativePrice).toBe(2000);
  });

  it("refuses a row that is not a transaction", () => {
    expect(toNewTx({ ...fields, quantity: "" })).toBeNull();
    expect(toNewTx({ ...fields, quantity: "0" })).toBeNull();
    expect(toNewTx({ ...fields, quantity: "-1" })).toBeNull();
    expect(toNewTx({ ...fields, price: "abc" })).toBeNull();
    expect(toNewTx({ ...fields, when: "" })).toBeNull();
  });

  it("treats an empty fee as zero, not as missing", () => {
    expect(toNewTx({ ...fields, fee: "" })!.fee).toBe(0);
  });
});

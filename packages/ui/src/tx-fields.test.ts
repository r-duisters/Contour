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
    mode: "trade" as const, sourceSymbol: "",
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

describe("cash and income", () => {
  it("builds a cash deposit from an amount and a currency", () => {
    const tx = toNewTx({
      mode: "cash", symbol: "EUR", side: "transfer_in", quantity: "500",
      price: "", fee: "", when: "2025-06-02T10:00", currency: "EUR", sourceSymbol: "",
    })!;
    expect(tx).toMatchObject({
      symbol: "EUR", assetType: "cash", side: "transfer_in", quantity: 500,
      price: 0, fee: 0, nativeCurrency: "EUR", nativePrice: 1, sourceSymbol: null,
    });
  });

  it("attributes income to its source security, uppercased", () => {
    const tx = toNewTx({
      mode: "cash", symbol: "EUR", side: "income", quantity: "120.50",
      price: "", fee: "", when: "2025-06-02T10:00", currency: "EUR",
      sourceSymbol: "shell.as",
    })!;
    expect(tx).toMatchObject({ side: "income", quantity: 120.5, sourceSymbol: "SHELL.AS" });
  });

  it("leaves the source null when none is given", () => {
    const tx = toNewTx({
      mode: "cash", symbol: "EUR", side: "income", quantity: "4.5",
      price: "", fee: "", when: "2025-06-02T10:00", currency: "EUR", sourceSymbol: "  ",
    })!;
    expect(tx!.sourceSymbol).toBeNull();
  });

  it("refuses a cash row with no currency, rather than inventing one", () => {
    expect(toNewTx({
      mode: "cash", symbol: "", side: "transfer_in", quantity: "500",
      price: "", fee: "", when: "2025-06-02T10:00", currency: null, sourceSymbol: "",
    })).toBeNull();
  });

  it("still builds a trade exactly as before", () => {
    // The regression guard: adding a mode must not change what the old one
    // produces.
    const before = toNewTx({
      mode: "trade", symbol: "ETH", side: "buy", quantity: "2", price: "2000",
      fee: "1", when: "2025-06-02T10:00", currency: "EUR", sourceSymbol: "",
    })!;
    expect(before).toMatchObject({
      symbol: "ETH", assetType: "crypto", price: 2000, nativePrice: 2000, sourceSymbol: null,
    });
  });
});

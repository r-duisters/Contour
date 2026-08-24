import { describe, expect, it } from "vitest";
import { auditLedger, type AuditTx } from "./ledger-audit";

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const at = (d: number) => T0 + d * DAY;

const deposit = (day: number, amount: number, currency = "EUR"): AuditTx => ({
  symbol: currency, assetType: "cash", side: "transfer_in",
  quantity: amount, price: 1, fee: 0, time: at(day), nativeCurrency: currency,
  nativePrice: 1, nativeFee: 0,
});

const trade = (
  day: number, symbol: string, side: "buy" | "sell", qty: number, price: number,
  currency = "EUR", fee = 0,
): AuditTx => ({
  symbol, assetType: "crypto", side, quantity: qty, price, fee, time: at(day),
  nativeCurrency: currency, nativePrice: price, nativeFee: fee,
});

/** The fiat row a broker writes beside a trade. Same timestamp, opposite sign. */
const leg = (day: number, amount: number, currency = "EUR"): AuditTx => ({
  symbol: currency, assetType: "cash", side: amount > 0 ? "transfer_in" : "transfer_out",
  quantity: Math.abs(amount), price: 1, fee: 0, time: at(day), nativeCurrency: currency,
  nativePrice: 1, nativeFee: 0,
});

describe("auditLedger", () => {
  it("says nothing about a ledger that funds itself", () => {
    const txs = [deposit(0, 10_000), trade(1, "BTCUSDT", "buy", 0.1, 50_000)];
    expect(auditLedger(txs)).toEqual([]);
  });

  it("is quiet when sale proceeds cover a later purchase", () => {
    // No second deposit, and none needed: the first sale funds the second buy.
    const txs = [
      deposit(0, 5_000),
      trade(1, "BTCUSDT", "buy", 0.1, 50_000),
      trade(2, "BTCUSDT", "sell", 0.1, 80_000),
      trade(3, "ETHUSDT", "buy", 2, 3_000),
    ];
    expect(auditLedger(txs)).toEqual([]);
  });
});

describe("auditLedger: underfunded currency", () => {
  it("reports the shortfall, its currency and when it was first reached", () => {
    const txs = [deposit(0, 1_000), trade(1, "BTCUSDT", "buy", 0.1, 50_000)];
    const [f] = auditLedger(txs);
    expect(f).toMatchObject({
      kind: "underfunded-currency",
      currency: "EUR",
      shortfall: 4_000,
      at: at(1),
    });
  });

  it("reports the deepest point, not the closing balance", () => {
    // Dips to -4,000 and then recovers to +1,000. A closing figure would call
    // this healthy; the account was still overdrawn on day 1.
    const txs = [
      deposit(0, 1_000),
      trade(1, "BTCUSDT", "buy", 0.1, 50_000),
      trade(2, "BTCUSDT", "sell", 0.1, 50_000),
      deposit(3, 1_000),
    ];
    const [f] = auditLedger(txs);
    expect(f).toMatchObject({ kind: "underfunded-currency", shortfall: 4_000, at: at(1) });
  });

  it("keeps currencies apart rather than netting one against another", () => {
    // Plenty of USD, no EUR. Summing the two would hide the EUR hole.
    const txs = [
      deposit(0, 50_000, "USD"),
      trade(1, "BTCUSDT", "buy", 0.1, 50_000, "EUR"),
    ];
    const kinds = auditLedger(txs).filter((f) => f.kind === "underfunded-currency");
    expect(kinds).toHaveLength(1);
    expect(kinds[0]).toMatchObject({ currency: "EUR", shortfall: 5_000 });
  });

  it("counts fees against the balance", () => {
    const txs = [deposit(0, 5_000), trade(1, "BTCUSDT", "buy", 0.1, 50_000, "EUR", 25)];
    expect(auditLedger(txs)[0]).toMatchObject({ kind: "underfunded-currency", shortfall: 25 });
  });

  it("ignores a rounding-sized overdraft", () => {
    const txs = [deposit(0, 4_999.999), trade(1, "BTCUSDT", "buy", 0.1, 50_000)];
    expect(auditLedger(txs)).toEqual([]);
  });

  it("ignores trades settled in another asset, which touch no cash", () => {
    // Paying for ETH in BTC moves no fiat, so it cannot overdraw a fiat balance.
    const txs = [trade(0, "ETHBTC", "buy", 10, 0.05, "BTC")];
    expect(auditLedger(txs)).toEqual([]);
  });
});

describe("auditLedger: inconsistent cash legs", () => {
  const legged = [
    deposit(0, 100_000),
    trade(1, "BTCUSDT", "buy", 0.1, 50_000), leg(1, -5_000),
    trade(2, "ETHUSDT", "buy", 2, 3_000), leg(2, -6_000),
  ];

  it("is quiet when every trade carries a fiat leg", () => {
    expect(auditLedger(legged)).toEqual([]);
  });

  it("is quiet when no trade carries one", () => {
    const txs = [deposit(0, 100_000), trade(1, "BTCUSDT", "buy", 0.1, 50_000)];
    expect(auditLedger(txs)).toEqual([]);
  });

  it("warns when a currency has both, because no cash total can then be trusted", () => {
    const txs = [...legged, trade(3, "SOLUSDT", "buy", 10, 100)];
    const [f] = auditLedger(txs).filter((x) => x.kind === "inconsistent-cash-legs");
    expect(f).toMatchObject({ kind: "inconsistent-cash-legs", currency: "EUR", withLeg: 2, total: 3 });
  });
});

describe("auditLedger: oversold asset", () => {
  it("reports selling more than was ever acquired", () => {
    const txs = [
      deposit(0, 100_000),
      trade(1, "BTCUSDT", "buy", 0.1, 50_000),
      trade(2, "BTCUSDT", "sell", 0.3, 50_000),
    ];
    const [f] = auditLedger(txs).filter((x) => x.kind === "oversold-asset");
    expect(f).toMatchObject({ kind: "oversold-asset", symbol: "BTCUSDT", at: at(2) });
    // Not rounded in the implementation: a crypto quantity carries eight
    // decimals, and rounding the shortfall to money precision would erase them.
    expect((f as { shortfall: number }).shortfall).toBeCloseTo(0.2, 8);
  });

  it("counts a transfer in as an acquisition", () => {
    // Coins moved in from another wallet were never bought here, but they are
    // held, and selling them is not an error.
    const txs: AuditTx[] = [
      { symbol: "BTCUSDT", assetType: "crypto", side: "transfer_in", quantity: 1,
        price: 0, fee: 0, time: at(0), nativeCurrency: null, nativePrice: null, nativeFee: null },
      trade(1, "BTCUSDT", "sell", 1, 50_000),
    ];
    expect(auditLedger(txs).filter((x) => x.kind === "oversold-asset")).toEqual([]);
  });

  it("treats a dip repaired within the day as export ordering, not a missing buy", () => {
    // Seen in a real export: a sale recorded three minutes before the incoming
    // transfer that supplied the coins. The position nets to zero and nothing
    // is missing — only the order is wrong.
    const txs: AuditTx[] = [
      trade(1, "ALGOUSDT", "sell", 6_023, 0.26, "EUR"),
      { symbol: "ALGOUSDT", assetType: "crypto", side: "transfer_in", quantity: 6_023,
        price: 0, fee: 0, time: at(1) + 180_000, nativeCurrency: null, nativePrice: null, nativeFee: null },
    ];
    expect(auditLedger(txs).filter((x) => x.kind === "oversold-asset")).toEqual([]);
  });

  it("still reports a dip that takes longer than a day to repair", () => {
    const txs: AuditTx[] = [
      trade(1, "ALGOUSDT", "sell", 100, 1, "EUR"),
      { symbol: "ALGOUSDT", assetType: "crypto", side: "transfer_in", quantity: 100,
        price: 0, fee: 0, time: at(5), nativeCurrency: null, nativePrice: null, nativeFee: null },
    ];
    const [f] = auditLedger(txs).filter((x) => x.kind === "oversold-asset");
    expect(f).toMatchObject({ kind: "oversold-asset", symbol: "ALGOUSDT" });
  });

  it("ignores a dust-sized negative from rounded quantities", () => {
    const txs = [
      deposit(0, 100_000),
      trade(1, "BTCUSDT", "buy", 0.10000001, 50_000),
      trade(2, "BTCUSDT", "sell", 0.10000002, 50_000),
    ];
    expect(auditLedger(txs).filter((x) => x.kind === "oversold-asset")).toEqual([]);
  });
});

describe("auditLedger: the shape this repository actually met", () => {
  it("reports both the shortfall and the mixed legs on a Delta-style export", () => {
    // EUR trades carry a fiat leg, USD trades do not, and deposits fall well
    // short of what was spent. Both findings must fire, independently.
    const txs = [
      deposit(0, 1_000),
      trade(1, "ASML.AS", "buy", 1, 5_000, "EUR"), leg(1, -5_000),
      trade(2, "SHELL.AS", "buy", 1, 3_000, "EUR"),
      trade(3, "AMD", "buy", 10, 170, "USD"),
    ];
    const kinds = auditLedger(txs).map((f) => f.kind).sort();
    expect(kinds).toEqual(["inconsistent-cash-legs", "underfunded-currency", "underfunded-currency"]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { MemoryStore } from "../testing/memory-store";
import { FakeNet } from "../testing/fake-net";
import { addTransaction } from "./transactions";

beforeEach(() => invalidate());

const DAY_MS = 86_400_000;
const TRADE = Date.parse("2024-03-01T12:00:00Z");

/** One daily bar per UTC day at a fixed close. */
function klines(close: number) {
  return (url: string) => {
    const p = new URL(url).searchParams;
    const from = Number(p.get("startTime")), to = Number(p.get("endTime"));
    const out: unknown[] = [];
    for (let t = Math.floor(from / DAY_MS) * DAY_MS; t <= to; t += DAY_MS) {
      out.push([t, "1", "1", "1", String(close), "1", t + DAY_MS - 1, "0", 0, "0", "0", "0"]);
    }
    return out;
  };
}

function base() {
  return {
    symbol: "ETH", assetType: "crypto" as const, side: "buy" as const,
    quantity: 2, price: 0, fee: 0, time: TRADE,
    nativeCurrency: null, nativePrice: null, nativeFee: null, note: null,
  };
}

describe("addTransaction", () => {
  it("converts a EUR price at that day's rate, keeping the native figures", async () => {
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    // EUR was worth 1.10 USD on the trade's date.
    const net = FakeNet({ "symbol=EURUSDT": klines(1.1) });

    const tx = await addTransaction(store, net, p.id, {
      ...base(), nativeCurrency: "EUR", nativePrice: 2000, nativeFee: 10,
    });

    expect(tx.price).toBeCloseTo(2200, 6);
    expect(tx.fee).toBeCloseTo(11, 6);
    expect(tx.nativePrice).toBe(2000);
    expect(tx.nativeCurrency).toBe("EUR");
  });

  it("uses the trade's date, not today's", async () => {
    // The whole point of the conversion living here. A trade entered a week
    // late must not be priced at this morning's rate — and a test that scripts
    // one flat rate cannot tell the two apart, so this asserts the window.
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    const net = FakeNet({ "symbol=EURUSDT": klines(1.1) });

    await addTransaction(store, net, p.id, {
      ...base(), nativeCurrency: "EUR", nativePrice: 2000, nativeFee: 0,
    });

    const asked = new URL(net.calls.find((c) => c.url.includes("klines"))!.url);
    const from = Number(asked.searchParams.get("startTime"));
    const to = Number(asked.searchParams.get("endTime"));
    expect(from).toBeLessThanOrEqual(TRADE);
    expect(to).toBeGreaterThanOrEqual(TRADE);
    expect(to - TRADE).toBeLessThan(7 * DAY_MS); // not a window ending at now
  });

  it("leaves a USD-stable price alone and asks nothing", async () => {
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    const net = FakeNet({});   // any request at all throws

    const tx = await addTransaction(store, net, p.id, {
      ...base(), price: 3000, nativeCurrency: "USDT", nativePrice: 3000,
    });

    expect(tx.price).toBe(3000);
    expect(net.calls).toHaveLength(0);
  });

  it("stores the native figures and a zero price when no rate can be had", async () => {
    // Losing the euro figure would be worse than an unpriced row: the row can
    // be repriced later, but only if what was actually paid survives.
    const store = MemoryStore();
    const p = await store.portfolios.create("Main");
    const net = FakeNet({ "symbol=ZWLUSDT": [] });

    const tx = await addTransaction(store, net, p.id, {
      ...base(), nativeCurrency: "ZWL", nativePrice: 500, nativeFee: 0,
    });

    expect(tx.price).toBe(0);
    expect(tx.nativePrice).toBe(500);
    expect(tx.nativeCurrency).toBe("ZWL");
  });

  it("still refuses a portfolio that does not exist", async () => {
    const store = MemoryStore();
    const net = FakeNet({});
    await expect(addTransaction(store, net, "nope", base())).rejects.toThrow();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { invalidate } from "@/core/cache";
import { FakeNet } from "../testing/fake-net";
import { fetchEcbRates } from "./fx";

/**
 * The widening FX store, `binance.test.ts`'s sibling. A published ECB rate
 * never changes, so the multi-year series a phone downloaded on every launch
 * — and again every hour — was immutable data on a schedule. What is pinned
 * here is the call log, because a store that refetches everything still
 * returns the right rates.
 */
describe("the widening FX store", () => {
  const DAY = 86_400_000;
  const FROM = Date.parse("2023-01-02T00:00:00Z"); // a Monday

  beforeEach(() => invalidate());

  /** Frankfurter's shape over a weekday grid: no rows on Saturday or Sunday. */
  function frankfurterNet(rate: (day: string) => number = () => 1.1) {
    return FakeNet({
      "api.frankfurter.dev": (url: string) => {
        const m = /v1\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(url);
        const from = Date.parse(`${m![1]}T00:00:00Z`);
        const to = Date.parse(`${m![2]}T00:00:00Z`);
        const rates: Record<string, Record<string, number>> = {};
        for (let t = from; t <= to; t += DAY) {
          const day = new Date(t).toISOString().slice(0, 10);
          if (new Date(t).getUTCDay() % 6 !== 0) rates[day] = { USD: rate(day) };
        }
        return { rates };
      },
    });
  }

  it("answers a window it already holds without the network", async () => {
    const net = frankfurterNet();
    const to = FROM + 700 * DAY;
    const first = await fetchEcbRates(net, "EUR", "USD", FROM, to);
    expect(net.calls).toHaveLength(1);
    const again = await fetchEcbRates(net, "EUR", "USD", FROM, to);
    expect(net.calls).toHaveLength(1);
    expect(again).toEqual(first);
    // And a narrower window is a slice of the same entry, not a second key.
    const inner = await fetchEcbRates(net, "EUR", "USD", FROM + 100 * DAY, FROM + 130 * DAY);
    expect(net.calls).toHaveLength(1);
    expect(inner.size).toBeGreaterThan(0);
    for (const t of inner.keys()) {
      expect(t).toBeGreaterThanOrEqual(FROM + 100 * DAY);
      expect(t).toBeLessThanOrEqual(FROM + 130 * DAY);
    }
  });

  it("fetches only the missing days when asked past what it holds", async () => {
    const net = frankfurterNet();
    await fetchEcbRates(net, "EUR", "USD", FROM, FROM + 700 * DAY);
    const rates = await fetchEcbRates(net, "EUR", "USD", FROM, FROM + 730 * DAY);
    expect(net.calls).toHaveLength(2);
    // The tail request starts at the last published day it held, not at the
    // beginning of the series it would otherwise re-download.
    const tailFrom = Date.parse(`${/v1\/(\d{4}-\d{2}-\d{2})/.exec(net.calls[1]!.url)![1]}T00:00:00Z`);
    expect(tailFrom).toBeGreaterThanOrEqual(FROM + 695 * DAY);
    expect(rates.size).toBeGreaterThan(500);
  });

  it("widens once when asked for earlier days than it holds", async () => {
    const net = frankfurterNet();
    await fetchEcbRates(net, "EUR", "USD", FROM + 300 * DAY, FROM + 400 * DAY);
    const wide = await fetchEcbRates(net, "EUR", "USD", FROM, FROM + 400 * DAY);
    expect(net.calls).toHaveLength(2);
    expect(Math.min(...wide.keys())).toBeLessThan(FROM + 7 * DAY);
    await fetchEcbRates(net, "EUR", "USD", FROM, FROM + 400 * DAY);
    expect(net.calls).toHaveLength(2);
  });
});

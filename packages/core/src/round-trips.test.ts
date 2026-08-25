import { describe, expect, it } from "vitest";
import { roundTrips, tripStats } from "./round-trips";
import type { Tx } from "./portfolio";

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const buy = (day: number, quantity: number, price: number, fee = 0, symbol = "BTC"): Tx =>
  ({ symbol, side: "buy", quantity, price, fee, time: T0 + day * DAY });
const sell = (day: number, quantity: number, price: number, fee = 0, symbol = "BTC"): Tx =>
  ({ symbol, side: "sell", quantity, price, fee, time: T0 + day * DAY });

describe("roundTrips", () => {
  it("pairs a sale with the units it sold, and knows how long they were held", () => {
    const [t] = roundTrips([buy(0, 1, 100), sell(10, 1, 150)]);
    expect(t).toMatchObject({ symbol: "BTC", quantity: 1, pnl: 50, days: 10 });
  });

  it("consumes the oldest lot first, which is what makes a holding period meaningful", () => {
    // Two lots, one sale across both. Average cost would give one number and no
    // dates; FIFO gives two trips, each with the age of the units it sold.
    const trips = roundTrips([buy(0, 1, 100), buy(10, 1, 200), sell(20, 2, 300)]);
    expect(trips).toHaveLength(2);
    expect(trips[0]).toMatchObject({ pnl: 200, days: 20 });
    expect(trips[1]).toMatchObject({ pnl: 100, days: 10 });
  });

  it("leaves the rest of a lot open when only part is sold", () => {
    const trips = roundTrips([buy(0, 2, 100), sell(5, 1, 150), sell(15, 1, 50)]);
    expect(trips.map((t) => t.pnl)).toEqual([50, -50]);
    expect(trips.map((t) => t.days)).toEqual([5, 15]);
  });

  it("folds a buy's fee into what the units cost", () => {
    // Parity with average cost, which adds the buy fee to cost basis. Without
    // it every trip overstates its profit by the fee.
    const [t] = roundTrips([buy(0, 1, 100, 10), sell(1, 1, 150)]);
    expect(t!.pnl).toBe(40);
  });

  it("splits a sale's fee across the lots it consumed", () => {
    const trips = roundTrips([buy(0, 1, 100), buy(1, 1, 100), sell(2, 2, 200, 20)]);
    expect(trips.map((t) => t.pnl)).toEqual([90, 90]);
  });

  it("treats an inbound transfer as units acquired at the price it carries", () => {
    const trips = roundTrips([
      { symbol: "BTC", side: "transfer_in", quantity: 1, price: 100, fee: 0, time: T0 },
      sell(10, 1, 250),
    ]);
    expect(trips[0]!.pnl).toBe(150);
  });

  it("lets an outbound transfer consume units without calling it a trade", () => {
    // Moving coins to another wallet is not a disposal. It has to take the
    // lot — the units really are gone — but it made nothing.
    const trips = roundTrips([
      buy(0, 1, 100),
      { symbol: "BTC", side: "transfer_out", quantity: 1, price: 999, fee: 0, time: T0 + DAY },
      buy(2, 1, 200), sell(3, 1, 250),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.pnl).toBe(50);
  });

  it("keeps each asset's lots to itself", () => {
    const trips = roundTrips([
      buy(0, 1, 100, 0, "BTC"), buy(0, 1, 10, 0, "ETH"), sell(5, 1, 20, 0, "ETH"),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ symbol: "ETH", pnl: 10 });
  });

  it("ignores a sale with nothing to sell rather than inventing a lot", () => {
    expect(roundTrips([sell(0, 1, 100)])).toEqual([]);
    expect(roundTrips([])).toEqual([]);
  });
});

describe("tripStats", () => {
  const trip = (pnl: number, days: number) =>
    ({ symbol: "X", quantity: 1, inAt: 0, outAt: 0, buyPrice: 0, sellPrice: 0, pnl, days });

  it("counts what worked, and how long each kind was held", () => {
    const s = tripStats([trip(100, 400), trip(50, 300), trip(-20, 100), trip(-10, 200)]);
    expect(s.trips).toBe(4);
    expect(s.winRatePct).toBe(50);
    expect(s.medianWinnerDays).toBe(400);
    expect(s.medianLoserDays).toBe(200);
  });

  it("names the best and the worst", () => {
    const s = tripStats([trip(100, 10), trip(-500, 20), trip(30, 5)]);
    expect(s.best?.pnl).toBe(100);
    expect(s.worst?.pnl).toBe(-500);
  });

  it("treats a scratch as a loss, because it did not make money", () => {
    expect(tripStats([trip(0, 10)]).winRatePct).toBe(0);
  });

  it("answers nothing rather than zero for an empty history", () => {
    const s = tripStats([]);
    expect(s).toMatchObject({ trips: 0, winRatePct: null, medianWinnerDays: null, best: null });
  });
});

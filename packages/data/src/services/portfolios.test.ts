import { describe, expect, it } from "vitest";
import { NotFoundError } from "../errors";
import { MemoryStore } from "../testing/memory-store";
import { createPortfolio, deletePortfolio, getPortfolio, listPortfolios, renamePortfolio } from "./portfolios";

describe("listPortfolios", () => {
  it("returns the store's portfolios", async () => {
    const store = MemoryStore({ portfolios: [{ name: "Main" }, { name: "Other" }] });
    const list = await listPortfolios(store);
    expect(list.map((p) => p.name)).toEqual(["Main", "Other"]);
  });
});

describe("getPortfolio", () => {
  it("returns the portfolio with its transactions", async () => {
    const store = MemoryStore({
      portfolios: [
        {
          id: "pf_1",
          name: "Main",
          transactions: [
            {
              symbol: "BTCUSDT",
              assetType: "crypto",
              side: "buy",
              quantity: 1,
              price: 30_000,
              fee: 5,
              time: 1_000,
              nativeCurrency: null,
              nativePrice: null,
              nativeFee: null,
              note: null,
            },
          ],
        },
      ],
    });

    const portfolio = await getPortfolio(store, "pf_1");

    expect(portfolio.name).toBe("Main");
    expect(portfolio.transactions).toHaveLength(1);
  });

  // The `/api/portfolios/[id]` route today turns a missing row into a 404
  // with body `{ error: "not found" }`; the route only knows how to do that
  // mapping if the service raises something more specific than `Error`.
  it("throws NotFoundError, not a generic Error, on an unknown id", async () => {
    const store = MemoryStore();
    await expect(getPortfolio(store, "does-not-exist")).rejects.toThrow(NotFoundError);
  });
});

describe("createPortfolio", () => {
  it("creates and returns a portfolio", async () => {
    const store = MemoryStore();
    const created = await createPortfolio(store, "Main");
    expect(created.name).toBe("Main");
    expect(await listPortfolios(store)).toHaveLength(1);
  });

  // The current route rejects an empty name with a 400 before Prisma is ever
  // called (Zod's `min(1)`), and that validation stays in the route per the
  // brief. The service itself has no opinion on the name — it is exactly as
  // permissive as `store.portfolios.create`, which never validated at all.
  it("does not itself reject an empty name — that guard lives in the route's Zod schema", async () => {
    const store = MemoryStore();
    const created = await createPortfolio(store, "");
    expect(created.name).toBe("");
  });
});

describe("renamePortfolio", () => {
  it("renames and returns the updated portfolio", async () => {
    const store = MemoryStore({ portfolios: [{ id: "pf_1", name: "Main" }] });
    const renamed = await renamePortfolio(store, "pf_1", "Retirement");
    expect(renamed.name).toBe("Retirement");
  });

  // Today's PATCH has no existence check of its own: an unknown id reaches
  // Prisma's throwing `update` uncaught, which is a 500. `MemoryStore.rename`
  // throws a plain `Error` on the same input (see store-contract.ts), and this
  // service must not paper over that with a NotFoundError the route would
  // then turn into a 404 that never existed.
  it("propagates the store's rejection of an unknown id rather than mapping it", async () => {
    const store = MemoryStore();
    await expect(renamePortfolio(store, "does-not-exist", "x")).rejects.toThrow();
    await expect(renamePortfolio(store, "does-not-exist", "x")).rejects.not.toThrow(NotFoundError);
  });
});

describe("deletePortfolio", () => {
  it("removes the portfolio", async () => {
    const store = MemoryStore({ portfolios: [{ id: "pf_1", name: "Main" }] });
    await deletePortfolio(store, "pf_1");
    expect(await listPortfolios(store)).toHaveLength(0);
  });

  // Same reasoning as renamePortfolio: today's DELETE has no existence check,
  // so an unknown id is a 500, not a 404. The service must let that through.
  it("propagates the store's rejection of an unknown id rather than mapping it", async () => {
    const store = MemoryStore();
    await expect(deletePortfolio(store, "does-not-exist")).rejects.toThrow();
    await expect(deletePortfolio(store, "does-not-exist")).rejects.not.toThrow(NotFoundError);
  });
});

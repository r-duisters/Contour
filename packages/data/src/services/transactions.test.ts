import { describe, expect, it } from "vitest";
import { NotFoundError } from "../errors";
import { MemoryStore } from "../testing/memory-store";
import { addTransaction, deleteTransaction, updateTransaction } from "./transactions";

function tx(partial: Partial<Parameters<typeof addTransaction>[2]> = {}) {
  return {
    symbol: "BTCUSDT",
    assetType: "crypto" as const,
    side: "buy" as const,
    quantity: 1,
    price: 30_000,
    fee: 5,
    time: 1_700_000_000_000,
    nativeCurrency: null,
    nativePrice: null,
    nativeFee: null,
    note: null,
    ...partial,
  };
}

describe("addTransaction", () => {
  it("adds a transaction to the portfolio", async () => {
    const store = MemoryStore({ portfolios: [{ id: "pf_1", name: "Main" }] });
    const created = await addTransaction(store, "pf_1", tx());
    expect(created.portfolioId).toBe("pf_1");
    expect(created.symbol).toBe("BTCUSDT");
  });

  // The current POST checks `prisma.portfolio.findUnique` first and returns a
  // 404 `{ error: "not found" }` before ever touching `transaction.create`.
  // The service has to reproduce that check itself, since `store.transactions
  // .add` has no opinion about whether the portfolio exists.
  it("throws NotFoundError when the portfolio does not exist", async () => {
    const store = MemoryStore();
    await expect(addTransaction(store, "does-not-exist", tx())).rejects.toThrow(NotFoundError);
  });
});

describe("updateTransaction", () => {
  it("applies a partial patch and leaves the other fields alone", async () => {
    const store = MemoryStore({
      portfolios: [{ id: "pf_1", name: "Main", transactions: [tx({ quantity: 1, price: 30_000, note: "keep" })] }],
    });
    const [existing] = (await store.portfolios.get("pf_1"))!.transactions;

    const updated = await updateTransaction(store, existing!.id, { quantity: 4 });

    expect(updated.quantity).toBe(4);
    expect(updated.price).toBe(30_000);
    expect(updated.note).toBe("keep");
    expect(updated.symbol).toBe("BTCUSDT");
  });

  // Today's PATCH has no existence check: an unknown id reaches Prisma's
  // throwing `update` uncaught, which is a 500, not a 404. Pinning "not
  // NotFoundError" keeps the route from acquiring a mapping that would change
  // that status code.
  it("propagates the store's rejection of an unknown id rather than mapping it", async () => {
    const store = MemoryStore();
    await expect(updateTransaction(store, "does-not-exist", { note: "x" })).rejects.toThrow();
    await expect(updateTransaction(store, "does-not-exist", { note: "x" })).rejects.not.toThrow(NotFoundError);
  });
});

describe("deleteTransaction", () => {
  it("removes the transaction", async () => {
    const store = MemoryStore({ portfolios: [{ id: "pf_1", name: "Main", transactions: [tx()] }] });
    const [existing] = (await store.portfolios.get("pf_1"))!.transactions;

    await deleteTransaction(store, existing!.id);

    expect((await store.portfolios.get("pf_1"))!.transactions).toHaveLength(0);
  });

  it("propagates the store's rejection of an unknown id rather than mapping it", async () => {
    const store = MemoryStore();
    await expect(deleteTransaction(store, "does-not-exist")).rejects.toThrow();
    await expect(deleteTransaction(store, "does-not-exist")).rejects.not.toThrow(NotFoundError);
  });
});

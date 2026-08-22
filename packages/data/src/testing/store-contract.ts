import { beforeEach, describe, expect, it } from "vitest";
import type { NewTransaction, Store } from "../ports/store";

/**
 * One suite, run against every `Store` implementation. Phase 4 replaces Prisma
 * with SQLite-on-device; the only thing that will keep the swap honest is a
 * behavioural description that neither implementation authored.
 *
 * The contract deliberately says nothing about `venue`: the current Prisma
 * schema has no column for it (see the note in `prisma-store.ts`), so asserting
 * a round-trip would encode a lie rather than expose one.
 */
export function runStoreContract(name: string, makeStore: () => Promise<Store>): void {
  describe(`${name} satisfies the Store contract`, () => {
    let store: Store;

    beforeEach(async () => {
      store = await makeStore();
    });

    function tx(partial: Partial<NewTransaction> = {}): NewTransaction {
      return {
        symbol: "BTCUSDT",
        assetType: "crypto",
        side: "buy",
        quantity: 1,
        price: 30_000,
        fee: 5,
        time: 1_700_000_000_000,
        venue: null,
        note: null,
        ...partial,
      };
    }

    it("lists and counts a portfolio it has created", async () => {
      const created = await store.portfolios.create("Main");
      expect(created.name).toBe("Main");
      expect(await store.portfolios.count()).toBe(1);
      const list = await store.portfolios.list();
      expect(list.map((p) => p.id)).toContain(created.id);
      expect(list.find((p) => p.id === created.id)?.name).toBe("Main");
    });

    it("renames a portfolio", async () => {
      const created = await store.portfolios.create("Main");
      const renamed = await store.portfolios.rename(created.id, "Retirement");
      expect(renamed.name).toBe("Retirement");
      expect((await store.portfolios.get(created.id))?.name).toBe("Retirement");
    });

    it("returns null for an unknown portfolio rather than throwing", async () => {
      await expect(store.portfolios.get("does-not-exist")).resolves.toBeNull();
    });

    it("includes transactions ordered by time ascending", async () => {
      const p = await store.portfolios.create("Main");
      await store.transactions.add(p.id, tx({ time: 3_000, note: "third" }));
      await store.transactions.add(p.id, tx({ time: 1_000, note: "first" }));
      await store.transactions.add(p.id, tx({ time: 2_000, note: "second" }));
      const loaded = await store.portfolios.get(p.id);
      expect(loaded?.transactions.map((t) => t.note)).toEqual(["first", "second", "third"]);
    });

    it("returns timestamps as numbers, not BigInt or Date", async () => {
      const p = await store.portfolios.create("Main");
      const added = await store.transactions.add(p.id, tx());
      expect(typeof added.time).toBe("number");
      expect(typeof p.createdAt).toBe("number");
      const loaded = await store.portfolios.get(p.id);
      expect(typeof loaded!.createdAt).toBe("number");
      expect(typeof loaded!.transactions[0]!.time).toBe("number");
    });

    it("cascades a portfolio removal to its transactions", async () => {
      const p = await store.portfolios.create("Main");
      const other = await store.portfolios.create("Other");
      await store.transactions.add(p.id, tx());
      await store.transactions.add(other.id, tx());
      await store.portfolios.remove(p.id);
      expect(await store.portfolios.get(p.id)).toBeNull();
      expect(await store.portfolios.count()).toBe(1);
      expect((await store.portfolios.get(other.id))?.transactions).toHaveLength(1);
    });

    it("stores a transaction and gives it an id", async () => {
      const p = await store.portfolios.create("Main");
      const added = await store.transactions.add(
        p.id,
        tx({ symbol: "ETHUSDT", assetType: "crypto", side: "sell", quantity: 2, price: 1_800, fee: 1.5, note: "hi" }),
      );
      expect(added.id).toBeTruthy();
      expect(added.portfolioId).toBe(p.id);
      expect(added).toMatchObject({
        symbol: "ETHUSDT",
        assetType: "crypto",
        side: "sell",
        quantity: 2,
        price: 1_800,
        fee: 1.5,
        note: "hi",
      });
      const loaded = await store.portfolios.get(p.id);
      expect(loaded?.transactions).toHaveLength(1);
      expect(loaded?.transactions[0]!.id).toBe(added.id);
    });

    it("reports how many rows addMany inserted", async () => {
      const p = await store.portfolios.create("Main");
      const n = await store.transactions.addMany(p.id, [tx({ time: 1 }), tx({ time: 2 }), tx({ time: 3 })]);
      expect(n).toBe(3);
      expect((await store.portfolios.get(p.id))?.transactions).toHaveLength(3);
    });

    it("applies a partial patch and leaves the other fields alone", async () => {
      const p = await store.portfolios.create("Main");
      const added = await store.transactions.add(p.id, tx({ quantity: 1, price: 30_000, note: "keep" }));
      const updated = await store.transactions.update(added.id, { quantity: 4 });
      expect(updated.quantity).toBe(4);
      expect(updated.price).toBe(30_000);
      expect(updated.note).toBe("keep");
      expect(updated.symbol).toBe("BTCUSDT");
    });

    it("removes exactly one transaction", async () => {
      const p = await store.portfolios.create("Main");
      const a = await store.transactions.add(p.id, tx({ time: 1 }));
      await store.transactions.add(p.id, tx({ time: 2 }));
      await store.transactions.remove(a.id);
      const left = (await store.portfolios.get(p.id))!.transactions;
      expect(left).toHaveLength(1);
      expect(left[0]!.id).not.toBe(a.id);
    });

    it("empties one portfolio with removeAllIn and leaves another intact", async () => {
      const p = await store.portfolios.create("Main");
      const other = await store.portfolios.create("Other");
      await store.transactions.addMany(p.id, [tx({ time: 1 }), tx({ time: 2 })]);
      await store.transactions.add(other.id, tx());
      await store.transactions.removeAllIn(p.id);
      expect((await store.portfolios.get(p.id))?.transactions).toEqual([]);
      expect((await store.portfolios.get(other.id))?.transactions).toHaveLength(1);
    });

    it("returns the documented defaults from an empty store", async () => {
      expect(await store.settings.get()).toEqual({
        displayCurrency: "USD",
        equityProvider: "yahoo",
        equityApiKey: null,
        haUrl: null,
        haWebhookId: null,
        mqttBrokerUrl: null,
        mqttTopicPrefix: null,
      });
    });

    it("merges a settings patch rather than replacing the row", async () => {
      await store.settings.save({ displayCurrency: "EUR" });
      await store.settings.save({ haUrl: "http://ha.local:8123" });
      const s = await store.settings.get();
      expect(s.displayCurrency).toBe("EUR");
      expect(s.haUrl).toBe("http://ha.local:8123");
      expect(s.equityProvider).toBe("yahoo");
      expect(s.mqttBrokerUrl).toBeNull();
    });

    it("returns the merged settings from save itself", async () => {
      const saved = await store.settings.save({ equityApiKey: "abc" });
      expect(saved.equityApiKey).toBe("abc");
      expect(saved.displayCurrency).toBe("USD");
    });
  });
}

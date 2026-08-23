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
        nativeCurrency: null,
        nativePrice: null,
        nativeFee: null,
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

    it("stamps createdAt and updatedAt on create, and advances updatedAt (not createdAt) on rename", async () => {
      const created = await store.portfolios.create("Main");
      expect(created.updatedAt).toBe(created.createdAt);

      // A real clock can tick between create and rename, so this only pins
      // direction, not a minimum delta.
      const renamed = await store.portfolios.rename(created.id, "Retirement");
      expect(renamed.createdAt).toBe(created.createdAt);
      expect(renamed.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
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

    it("counts transactions per portfolio in one aggregate, omitting a portfolio with none", async () => {
      const a = await store.portfolios.create("A");
      const b = await store.portfolios.create("B");
      const empty = await store.portfolios.create("Empty");
      await store.transactions.addMany(a.id, [tx({ time: 1 }), tx({ time: 2 }), tx({ time: 3 })]);
      await store.transactions.add(b.id, tx());

      const counts = await store.transactions.countByPortfolio();

      expect(counts[a.id]).toBe(3);
      expect(counts[b.id]).toBe(1);
      expect(counts[empty.id]).toBeUndefined();
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

    it("removes a named set of transactions in one call and reports how many", async () => {
      const p = await store.portfolios.create("Main");
      await store.transactions.addMany(p.id, [tx({ time: 1 }), tx({ time: 2 }), tx({ time: 3 })]);
      const rows = (await store.portfolios.get(p.id))!.transactions;
      const removed = await store.transactions.removeMany([rows[0]!.id, rows[2]!.id]);
      expect(removed).toBe(2);
      const left = (await store.portfolios.get(p.id))!.transactions;
      expect(left.map((t) => t.id)).toEqual([rows[1]!.id]);
    });

    /**
     * Deliberately unlike `remove`, which throws on an unknown id. `removeMany`
     * is the "delete this set" primitive a clear-out is built on, and its
     * caller has just read the ids it is passing: a row that vanished in
     * between is the outcome asked for, not an error. Both stores must agree,
     * and the count is of rows actually deleted, never of ids handed in.
     */
    it("skips an id that does not exist, counting only what it deleted", async () => {
      const p = await store.portfolios.create("Main");
      const row = await store.transactions.add(p.id, tx());
      expect(await store.transactions.removeMany([row.id, "no-such-id"])).toBe(1);
      expect((await store.portfolios.get(p.id))!.transactions).toEqual([]);
      expect(await store.transactions.removeMany(["no-such-id"])).toBe(0);
    });

    it("treats an empty id list as a no-op", async () => {
      const p = await store.portfolios.create("Main");
      await store.transactions.add(p.id, tx());
      expect(await store.transactions.removeMany([])).toBe(0);
      expect((await store.portfolios.get(p.id))!.transactions).toHaveLength(1);
    });

    /**
     * `id IN (...)` binds one SQLite variable per id, so a list long enough to
     * pass the driver's parameter ceiling has to be split. 1200 is past the
     * conservative 999 limit an older SQLite build enforces, which is what
     * `PrismaStore` chunks against.
     */
    it("removes an id list longer than one SQLite statement can bind", async () => {
      const p = await store.portfolios.create("Main");
      await store.transactions.addMany(p.id, Array.from({ length: 1200 }, (_, i) => tx({ time: i + 1 })));
      const rows = (await store.portfolios.get(p.id))!.transactions;
      expect(await store.transactions.removeMany(rows.slice(0, 1150).map((t) => t.id))).toBe(1150);
      expect((await store.portfolios.get(p.id))!.transactions).toHaveLength(50);
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

    it("orders list() by createdAt, breaking ties by id", async () => {
      const a = await store.portfolios.create("A");
      const b = await store.portfolios.create("B");
      const c = await store.portfolios.create("C");
      // Created within the same millisecond, so this is entirely the tie-break.
      expect((await store.portfolios.list()).map((p) => p.id)).toEqual([a.id, b.id, c.id]);
    });

    it("breaks a tie on time by id, so same-timestamp rows keep a stable order", async () => {
      const p = await store.portfolios.create("Main");
      const first = await store.transactions.add(p.id, tx({ time: 1_000, note: "first" }));
      const second = await store.transactions.add(p.id, tx({ time: 1_000, note: "second" }));
      const third = await store.transactions.add(p.id, tx({ time: 1_000, note: "third" }));
      const ids = (await store.portfolios.get(p.id))!.transactions.map((t) => t.id);
      expect(ids).toEqual([first.id, second.id, third.id]);
    });

    it("round-trips the native-currency fields", async () => {
      const p = await store.portfolios.create("Main");
      const added = await store.transactions.add(
        p.id,
        tx({ nativeCurrency: "EUR", nativePrice: 27_500.5, nativeFee: 4.25 }),
      );
      expect(added).toMatchObject({ nativeCurrency: "EUR", nativePrice: 27_500.5, nativeFee: 4.25 });
      const loaded = (await store.portfolios.get(p.id))!.transactions[0]!;
      expect(loaded).toMatchObject({ nativeCurrency: "EUR", nativePrice: 27_500.5, nativeFee: 4.25 });
    });

    it("treats an explicit undefined in a patch as leave-alone, not set-null", async () => {
      const p = await store.portfolios.create("Main");
      const added = await store.transactions.add(p.id, tx({ price: 1, note: "keep", nativeCurrency: "EUR" }));
      const updated = await store.transactions.update(added.id, {
        price: 99,
        note: undefined,
        nativeCurrency: undefined,
      });
      expect(updated.price).toBe(99);
      expect(updated.note).toBe("keep");
      expect(updated.nativeCurrency).toBe("EUR");
    });

    it("sets null when a patch says null, as opposed to undefined", async () => {
      const p = await store.portfolios.create("Main");
      const added = await store.transactions.add(p.id, tx({ note: "gone" }));
      expect((await store.transactions.update(added.id, { note: null })).note).toBeNull();
    });

    it("rejects a remove of an id that does not exist", async () => {
      // The routes call Prisma's throwing `delete` with no catch, so an unknown
      // id is a 500 today. Pinning "throws" keeps a MemoryStore-backed test
      // from passing on a path that fails in production.
      const p = await store.portfolios.create("Main");
      const added = await store.transactions.add(p.id, tx());
      await store.transactions.remove(added.id);
      await expect(store.transactions.remove(added.id)).rejects.toThrow();
      await expect(store.portfolios.remove("does-not-exist")).rejects.toThrow();
    });

    it("rejects a rename of an id that does not exist", async () => {
      await expect(store.portfolios.rename("does-not-exist", "x")).rejects.toThrow();
    });

    it("rejects an update of an id that does not exist", async () => {
      // Same reasoning as the remove and rename cases: `PATCH
      // /api/transactions/[id]` has no existence check of its own, so an
      // unknown id has always been a 500. A store that answered with a
      // no-op — or with a freshly invented row — would turn that into a
      // silent success only the device build ever sees.
      const p = await store.portfolios.create("Main");
      const added = await store.transactions.add(p.id, tx());
      await store.transactions.remove(added.id);
      await expect(store.transactions.update(added.id, { quantity: 2 })).rejects.toThrow();
      await expect(store.transactions.update("does-not-exist", { quantity: 2 })).rejects.toThrow();
    });

    it("treats removeAllIn on an empty or unknown portfolio as a no-op", async () => {
      const p = await store.portfolios.create("Main");
      await store.transactions.removeAllIn(p.id);
      await store.transactions.removeAllIn("does-not-exist");
      expect((await store.portfolios.get(p.id))?.transactions).toEqual([]);
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

    // `exists()` is the one thing `get()` cannot report, because it defaults
    // unconditionally. The settings screen renders a virgin install as
    // first-run rather than as a form full of defaults, so the difference has
    // to survive the port — and both implementations have to agree on when it
    // flips, or the web and device builds disagree about what a fresh install
    // looks like.
    it("reports no settings row before anything is saved", async () => {
      expect(await store.settings.exists()).toBe(false);
    });

    it("still reports no settings row after a read defaults one", async () => {
      await store.settings.get();
      expect(await store.settings.exists()).toBe(false);
    });

    it("reports a settings row once one is saved, and keeps reporting it", async () => {
      await store.settings.save({ displayCurrency: "EUR" });
      expect(await store.settings.exists()).toBe(true);
      await store.settings.save({ haUrl: "http://ha.local:8123" });
      expect(await store.settings.exists()).toBe(true);
    });

    it("reports a settings row after a save that patches nothing", async () => {
      // Existence tracks the row, not its contents. `save({})` still has to
      // create it — PrismaStore upserts, so it does — or a store could report
      // "no settings" for an install that has plainly been written to.
      await store.settings.save({});
      expect(await store.settings.exists()).toBe(true);
    });
  });
}

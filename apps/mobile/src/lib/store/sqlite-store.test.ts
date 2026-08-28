import { describe, expect, it } from "vitest";
import { runStoreContract } from "@/data/testing/store-contract";
import { SqliteStore } from "./sqlite-store";
import { openTestDb } from "./test-db";
import { MIGRATIONS, migrate } from "./schema";

/**
 * The third implementation of `Store`, held to the same suite as `MemoryStore`
 * and `PrismaStore`. That the suite is unchanged is the whole assertion: a
 * device store that needed its own expectations would not be the same port.
 */
describe("SqliteStore", () => {
  runStoreContract("SqliteStore", async () => SqliteStore(await openTestDb()));
});

describe("migrations", () => {
  it("opens an empty database, migrates forward, and reports its version", async () => {
    const db = await openTestDb();
    const [{ user_version }] = await db.query<{ user_version: number }>("PRAGMA user_version;");
    expect(user_version).toBe(MIGRATIONS.length);
  });

  it("is a no-op on an already-current database", async () => {
    const db = await openTestDb();
    const store = SqliteStore(db);
    const p = await store.portfolios.create("Main");
    // Running again must neither fail nor touch what is there.
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect((await store.portfolios.list()).map((x) => x.id)).toEqual([p.id]);
  });

  it("loses no rows migrating from each historical user_version", async () => {
    // Trivial with one migration, and that is the point: it costs nothing now
    // and it is the test nobody writes once there are four.
    for (let from = 0; from < MIGRATIONS.length; from++) {
      const db = await openTestDb();
      const store = SqliteStore(db);
      const p = await store.portfolios.create("Main");
      await store.transactions.add(p.id, {
        symbol: "BTC", assetType: "crypto", side: "buy", quantity: 1, price: 100,
        fee: 0, time: 1_700_000_000_000, nativeCurrency: null, nativePrice: null,
        nativeFee: null, note: null,
      });
      await db.execute(`PRAGMA user_version = ${from};`);
      await migrate(db);
      const back = await store.portfolios.get(p.id);
      expect(back!.transactions).toHaveLength(1);
    }
  });
});

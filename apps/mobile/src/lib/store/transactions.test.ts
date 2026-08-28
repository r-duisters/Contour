import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openTestDb } from "./test-db";
import { SqliteStore } from "./sqlite-store";

/**
 * Transaction control belongs to the driver, not to the store.
 *
 * `addMany` used to write `BEGIN;` and `COMMIT;` around its inserts. That is
 * correct against `node:sqlite`, which these tests use, and wrong against
 * `@capacitor-community/sqlite`, which the app ships on: the plugin wraps every
 * `run` in a transaction of its own and commits it, so the hand-written COMMIT
 * arrives with nothing open. It failed on a phone with "Cannot perform this
 * operation because there is no current transaction" while passing here.
 *
 * `test-db.ts` warned that it is not the shipping driver and that what it
 * proves is the SQL, not the plugin. This is the check that turns that warning
 * into something enforced.
 */
describe("the device store's transaction handling", () => {
  it("leaves BEGIN, COMMIT and ROLLBACK to the driver", () => {
    // Comments stripped first: the note above `batch` explains why these
    // keywords are not written here, and would otherwise trip its own rule.
    const source = readFileSync(join(__dirname, "sqlite-store.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const offenders = [...source.matchAll(/\b(BEGIN|COMMIT|ROLLBACK)\b/g)].map((m) => m[1]);
    expect(offenders).toEqual([]);
  });

  it("stores an absent optional field as null", async () => {
    // `NewTransaction` requires these as `null`, but `sourceSymbol` is
    // optional and JavaScript callers can omit any of them. `undefined` is not
    // a SQLite value — `node:sqlite` refuses to bind it and a driver that
    // accepts it is guessing — so `txValues` coerces every nullable column.
    const store = SqliteStore(await openTestDb());
    const p = await store.portfolios.create("Test");
    await store.transactions.add(p.id, {
      symbol: "BTC", assetType: "crypto", side: "buy",
      quantity: 1, price: 100, fee: 0, time: 1_700_000_000_000,
      nativeCurrency: null, nativePrice: null, nativeFee: null, note: null,
    });
    const [saved] = (await store.portfolios.get(p.id))!.transactions;
    expect(saved!.nativeCurrency).toBeNull();
    expect(saved!.note).toBeNull();
  });

  it("writes every row of a bulk insert, or none", async () => {
    const store = SqliteStore(await openTestDb());
    const p = await store.portfolios.create("Test");
    const row = (symbol: string) => ({
      symbol, assetType: "crypto" as const, side: "buy" as const,
      quantity: 1, price: 100, fee: 0, time: 1_700_000_000_000,
      nativeCurrency: null, nativePrice: null, nativeFee: null, note: null,
    });

    expect(await store.transactions.addMany(p.id, [row("BTC"), row("ETH"), row("SOL")])).toBe(3);
    expect((await store.portfolios.get(p.id))!.transactions).toHaveLength(3);

    // A set that cannot be applied leaves nothing behind. Without the
    // atomicity this is the case that silently half-imports a ledger.
    await expect(
      store.transactions.addMany("no-such-portfolio", [row("ADA")]),
    ).rejects.toThrow();
    expect((await store.portfolios.get(p.id))!.transactions).toHaveLength(3);
  });
});

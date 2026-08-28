import type { DataClient } from "@/data/client/data-client";
import { LocalClient } from "./local-client";
import { CapacitorNet } from "./net/capacitor-net";
import { SqliteStore, type DB } from "./store/sqlite-store";
import { ENABLE_FOREIGN_KEYS, migrate } from "./store/schema";

/**
 * The device's wiring of the ports: SQLite and CapacitorHttp, against the same
 * two interfaces the server hands `PrismaStore` and `WebNet` to.
 *
 * Unlike `apps/web`'s, this cannot be built at module scope. Opening a database
 * is asynchronous, and it must be migrated before anything reads it — so the
 * client is built once, lazily, and every caller awaits the same promise. A
 * second call while the first is still opening gets that same promise rather
 * than a second connection to the same file.
 */
const DB_NAME = "contour";

let pending: Promise<DataClient> | null = null;

/** Opens the database, migrates it, and wraps it in the shape the store wants. */
async function openDb(): Promise<DB> {
  const { CapacitorSQLite, SQLiteConnection } = await import("@capacitor-community/sqlite");
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  // `false` for encryption and `no-encryption` for the mode: a device database
  // holding a portfolio is protected by the device lock, and a key this app
  // invented would have to live beside the data it protects.
  const conn = await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);
  await conn.open();

  const db: DB = {
    async execute(statements) { await conn.execute(statements); },
    async query<T>(sql: string, values: unknown[] = []) {
      const res = await conn.query(sql, values as never[]);
      return (res.values ?? []) as T[];
    },
    async run(sql, values = []) {
      const res = await conn.run(sql, values as never[]);
      return { changes: res.changes?.changes ?? 0 };
    },
    // `executeSet` is the plugin's own bulk write: it opens one transaction
    // around the whole set and commits or rolls back as a unit. Issuing
    // BEGIN and COMMIT by hand around `run` does not work here — every `run`
    // already carries its own transaction and commits it, so the COMMIT lands
    // with nothing open and the plugin answers "Cannot perform this operation
    // because there is no current transaction".
    async batch(statements) {
      if (statements.length === 0) return;
      await conn.executeSet(
        statements.map((s) => ({ statement: s.sql, values: s.values as never[] })),
        true,
      );
    },
  };

  await db.execute(ENABLE_FOREIGN_KEYS);
  await migrate(db);
  return db;
}

export function client(): Promise<DataClient> {
  pending ??= (async () => LocalClient(SqliteStore(await openDb()), CapacitorNet()))();
  return pending;
}

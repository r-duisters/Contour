import { DatabaseSync } from "node:sqlite";
import { ENABLE_FOREIGN_KEYS, migrate } from "./schema";
import type { DB } from "./sqlite-store";

/**
 * An in-memory SQLite database for the tests, over Node's built-in driver.
 *
 * **This is not the driver the app ships on.** On a device the store runs
 * against `@capacitor-community/sqlite`; here it runs against `node:sqlite`.
 * Both are real SQLite and the store only uses statements common to any build
 * of it, but the gap is real and worth naming: what these tests prove is that
 * the SQL and the port's semantics are right, not that the plugin behaves.
 * Task 13 is what exercises the plugin, on a phone.
 *
 * `node:sqlite` was chosen over `better-sqlite3` because it needs no native
 * module, no install step and no separate binary per platform — the plan
 * offered `better-sqlite3` as the fallback before Node shipped one.
 */
export async function openTestDb(): Promise<DB> {
  const raw = new DatabaseSync(":memory:");
  const db: DB = {
    async execute(statements) { raw.exec(statements); },
    async query<T>(sql: string, values: unknown[] = []) {
      return raw.prepare(sql).all(...(values as never[])) as T[];
    },
    async run(sql, values = []) {
      const res = raw.prepare(sql).run(...(values as never[]));
      return { changes: Number(res.changes) };
    },
  };
  await db.execute(ENABLE_FOREIGN_KEYS);
  await migrate(db);
  return db;
}

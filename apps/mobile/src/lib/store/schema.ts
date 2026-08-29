/**
 * The device database's schema, and the migrations that build it.
 *
 * Migrations are hand-owned now. Prisma was doing this; on a device it is not
 * there, and that is the accepted cost of schema parity with the web build.
 *
 * The rules, and they are not negotiable once an APK is in someone's hands:
 * append only, never edit a shipped entry, and every entry survives being
 * interrupted. `user_version` is the only record of where a database got to.
 *
 * Three tables. `Alert`, `AlertEvent`, `BacktestRun`, `WebAuthnCredential` and
 * `PushSubscription` have no mobile use and are deliberately absent — the
 * strategy tooling, passkeys and Web Push all stay in `apps/web` (spec §5).
 */

/** The slice of a SQLite connection these migrations need. */
export type DB = {
  execute(statements: string): Promise<void>;
  query<T>(sql: string, values?: unknown[]): Promise<T[]>;
};

export const MIGRATIONS: ((db: DB) => Promise<void>)[] = [
  /**
   * Migration 0 carries `sourceSymbol` and a `side` that accepts `income`
   * rather than adding them in a second entry, because the cash-and-income
   * epic merged before this was written and no database exists anywhere to
   * migrate. `schema.prisma` is the thing this must match; the store contract
   * fails if they disagree.
   *
   * `"Transaction"` is quoted everywhere. It is a keyword in some SQLite
   * contexts, and half-quoting is the failure that looks like a typo.
   *
   * `IF NOT EXISTS` on every object is what makes the entry replayable, which
   * the rule above demands and which a plain `CREATE TABLE` does not give:
   * a run interrupted after two of the three tables would fail forever on the
   * first. The migration test rewinds `user_version` and re-runs to prove it.
   */
  async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS Portfolio (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "Transaction" (
        id TEXT PRIMARY KEY NOT NULL,
        portfolioId TEXT NOT NULL REFERENCES Portfolio(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        assetType TEXT NOT NULL DEFAULT 'crypto',
        side TEXT NOT NULL,
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        fee REAL NOT NULL DEFAULT 0,
        nativeCurrency TEXT,
        nativePrice REAL,
        nativeFee REAL,
        sourceSymbol TEXT,
        time INTEGER NOT NULL,
        note TEXT,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS Transaction_portfolioId_time ON "Transaction"(portfolioId, time);
      CREATE TABLE IF NOT EXISTS Settings (
        id INTEGER PRIMARY KEY NOT NULL,
        displayCurrency TEXT NOT NULL DEFAULT 'USD',
        equityProvider TEXT NOT NULL DEFAULT 'yahoo',
        equityApiKey TEXT,
        haUrl TEXT,
        haWebhookId TEXT,
        mqttBrokerUrl TEXT,
        mqttTopicPrefix TEXT
      );
    `);
  },

  /**
   * Migration 1: alerts.
   *
   * A separate entry, unlike `sourceSymbol`, because by the time this was
   * written a database existed on a real phone with a real ledger in it.
   * Folding it into migration 0 would have been correct only for installs
   * that did not yet exist.
   *
   * Narrower than the server's `Alert` table on purpose: no timeframe, no
   * JSON params, no indicator kind. The risk metric needs 1,460 daily bars to
   * warm up, which is not work for a phone, and a column for it would invite
   * one.
   */
  async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS Alert (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        symbol     TEXT NOT NULL,
        assetType  TEXT NOT NULL DEFAULT 'crypto',
        threshold  REAL NOT NULL,
        direction  TEXT,
        enabled    INTEGER NOT NULL DEFAULT 1,
        createdAt  INTEGER NOT NULL
      );
    `);
  },
];

/**
 * Bring a database up to the current schema, and report where it got to.
 *
 * `user_version` is read first and written after each step, so an interrupted
 * run resumes rather than repeating: a migration that half-applied and then
 * re-ran is the failure mode this pragma exists to prevent.
 */
export async function migrate(db: DB): Promise<number> {
  const rows = await db.query<{ user_version: number }>("PRAGMA user_version;");
  let version = rows[0]?.user_version ?? 0;
  for (let i = version; i < MIGRATIONS.length; i++) {
    await MIGRATIONS[i]!(db);
    version = i + 1;
    // Interpolated because SQLite does not accept a bound parameter in a
    // pragma. `version` is a loop index over a literal array, never input.
    await db.execute(`PRAGMA user_version = ${version};`);
  }
  return version;
}

/** Foreign keys are off by default in SQLite, and the cascade depends on them. */
export const ENABLE_FOREIGN_KEYS = "PRAGMA foreign_keys = ON;";

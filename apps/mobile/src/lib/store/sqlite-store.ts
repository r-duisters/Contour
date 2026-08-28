import {
  DEFAULT_SETTINGS,
  type AssetType,
  type NewTransaction,
  type Portfolio,
  type PortfolioWithTransactions,
  type Settings,
  type SettingsPatch,
  type Side,
  type Store,
  type Transaction,
  type TransactionPatch,
} from "@/data/ports/store";

/**
 * The device `Store`, over SQLite.
 *
 * The third implementation of a port that already had two, held to the same
 * `store-contract.ts` as `MemoryStore` and `PrismaStore`. That the suite is
 * unchanged is the whole assertion: a device store needing its own
 * expectations would not be the same port.
 *
 * Its job, like `PrismaStore`'s, is to be the last place a storage type
 * exists. Everything above works in `number` and `null`, so a service produces
 * the same JSON whether it ran on a server or here.
 *
 * Row order is pinned with an explicit `id` tie-break rather than left to
 * SQLite's rowid, matching `PrismaStore` — see `newId` below for why that
 * works.
 */

/** The slice of a SQLite connection this store needs. */
export type DB = {
  /** Statements with no result: DDL, and writes. */
  execute(statements: string): Promise<void>;
  /** A parameterised read. */
  query<T>(sql: string, values?: unknown[]): Promise<T[]>;
  /** A parameterised write. */
  run(sql: string, values?: unknown[]): Promise<{ changes: number }>;
};

/**
 * An id whose lexical order is creation order.
 *
 * `PrismaStore` gets this from cuid, and the contract depends on it: a pair of
 * transactions sharing a `time` must come back in the same order from every
 * implementation, and `ORDER BY time ASC, id ASC` is what makes that true.
 * So the milliseconds lead, zero-padded to a fixed width — an unpadded number
 * sorts "9" after "10" — followed by a counter for rows created inside the
 * same millisecond, and randomness last so two devices never collide.
 */
let seq = 0;
function newId(prefix: string): string {
  const at = Date.now().toString(36).padStart(9, "0");
  const n = (seq = (seq + 1) % 1_679_616).toString(36).padStart(4, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${at}${n}${rand}`;
}

type PortfolioRow = { id: string; name: string; createdAt: number; updatedAt: number };

function toPortfolio(row: PortfolioRow): Portfolio {
  return { id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

type TxRow = {
  id: string; portfolioId: string; symbol: string; assetType: string; side: string;
  quantity: number; price: number; fee: number;
  nativeCurrency: string | null; nativePrice: number | null; nativeFee: number | null;
  sourceSymbol: string | null; time: number; note: string | null;
};

function toTransaction(row: TxRow): Transaction {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    symbol: row.symbol,
    assetType: row.assetType as AssetType,
    side: row.side as Side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    time: row.time,
    nativeCurrency: row.nativeCurrency,
    nativePrice: row.nativePrice,
    nativeFee: row.nativeFee,
    sourceSymbol: row.sourceSymbol,
    note: row.note,
  };
}

const TX_COLUMNS =
  "id, portfolioId, symbol, assetType, side, quantity, price, fee, " +
  "nativeCurrency, nativePrice, nativeFee, sourceSymbol, time, note, createdAt";

function txValues(id: string, portfolioId: string, tx: NewTransaction, createdAt: number): unknown[] {
  return [
    id, portfolioId, tx.symbol, tx.assetType, tx.side, tx.quantity, tx.price, tx.fee,
    tx.nativeCurrency, tx.nativePrice, tx.nativeFee, tx.sourceSymbol ?? null,
    tx.time, tx.note, createdAt,
  ];
}

export function SqliteStore(db: DB): Store {
  async function readTx(id: string): Promise<Transaction> {
    const rows = await db.query<TxRow>(`SELECT ${TX_COLUMNS} FROM "Transaction" WHERE id = ?`, [id]);
    const row = rows[0];
    // Prisma's `update` and `delete` throw on a missing row and the contract
    // pins that, so the absence has to be raised rather than returned.
    if (!row) throw new Error(`no transaction ${id}`);
    return toTransaction(row);
  }

  async function readPortfolio(id: string): Promise<Portfolio> {
    const rows = await db.query<PortfolioRow>("SELECT * FROM Portfolio WHERE id = ?", [id]);
    const row = rows[0];
    if (!row) throw new Error(`no portfolio ${id}`);
    return toPortfolio(row);
  }

  return {
    portfolios: {
      async list() {
        const rows = await db.query<PortfolioRow>(
          "SELECT * FROM Portfolio ORDER BY createdAt ASC, id ASC",
        );
        return rows.map(toPortfolio);
      },

      async get(id) {
        const rows = await db.query<PortfolioRow>("SELECT * FROM Portfolio WHERE id = ?", [id]);
        const row = rows[0];
        // `get` answers null rather than throwing: an unknown id is a 404 the
        // caller renders, not a fault.
        if (!row) return null;
        const txs = await db.query<TxRow>(
          `SELECT ${TX_COLUMNS} FROM "Transaction" WHERE portfolioId = ? ORDER BY time ASC, id ASC`,
          [id],
        );
        return { ...toPortfolio(row), transactions: txs.map(toTransaction) } as PortfolioWithTransactions;
      },

      async create(name) {
        const now = Date.now();
        const id = newId("pf");
        await db.run(
          "INSERT INTO Portfolio (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)",
          [id, name, now, now],
        );
        return { id, name, createdAt: now, updatedAt: now };
      },

      async rename(id, name) {
        // `updatedAt` advances and `createdAt` does not — the contract checks
        // both, because Prisma's `@updatedAt` gives it for free and a hand
        // written store is where that quietly stops being true.
        const res = await db.run(
          "UPDATE Portfolio SET name = ?, updatedAt = ? WHERE id = ?",
          [name, Date.now(), id],
        );
        if (res.changes === 0) throw new Error(`no portfolio ${id}`);
        return readPortfolio(id);
      },

      async remove(id) {
        // The cascade is declared on the table and depends on `foreign_keys`
        // being ON, which the connection sets at open; deleting the rows here
        // as well would hide a pragma that was never applied.
        const res = await db.run("DELETE FROM Portfolio WHERE id = ?", [id]);
        if (res.changes === 0) throw new Error(`no portfolio ${id}`);
      },
    },

    transactions: {
      async add(portfolioId, tx) {
        const id = newId("tx");
        await db.run(
          `INSERT INTO "Transaction" (${TX_COLUMNS}) VALUES (${TX_COLUMNS.split(", ").map(() => "?").join(", ")})`,
          txValues(id, portfolioId, tx, Date.now()),
        );
        return readTx(id);
      },

      async addMany(portfolioId, txs) {
        if (txs.length === 0) return 0;
        const createdAt = Date.now();
        const placeholders = TX_COLUMNS.split(", ").map(() => "?").join(", ");
        // One SQL transaction, because a Delta import is hundreds of rows and
        // a half-applied import is worse than a failed one. This is the one
        // place the device store has to do by hand what Prisma does for free.
        await db.execute("BEGIN;");
        try {
          for (const tx of txs) {
            await db.run(
              `INSERT INTO "Transaction" (${TX_COLUMNS}) VALUES (${placeholders})`,
              txValues(newId("tx"), portfolioId, tx, createdAt),
            );
          }
          await db.execute("COMMIT;");
        } catch (err) {
          await db.execute("ROLLBACK;");
          throw err;
        }
        return txs.length;
      },

      async update(id, patch) {
        // Undefined means leave alone and null means set null — the same
        // distinction Prisma draws, and the reason `TxPatch` strips its
        // defaults. Building the SET list from the keys actually present is
        // what preserves it.
        const sets: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          sets.push(`${key} = ?`);
          values.push(value);
        }
        if (sets.length > 0) {
          const res = await db.run(
            `UPDATE "Transaction" SET ${sets.join(", ")} WHERE id = ?`,
            [...values, id],
          );
          if (res.changes === 0) throw new Error(`no transaction ${id}`);
        }
        return readTx(id);
      },

      async remove(id) {
        const res = await db.run(`DELETE FROM "Transaction" WHERE id = ?`, [id]);
        if (res.changes === 0) throw new Error(`no transaction ${id}`);
      },

      async removeMany(ids) {
        if (ids.length === 0) return 0;
        // Chunked under SQLite's variable limit, which is 999 on older builds.
        // The Delta clear-out passes every row of a portfolio, and the
        // contract exercises a list longer than one statement can bind.
        let removed = 0;
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const res = await db.run(
            `DELETE FROM "Transaction" WHERE id IN (${chunk.map(() => "?").join(", ")})`,
            chunk,
          );
          removed += res.changes;
        }
        return removed;
      },

      async countByPortfolio() {
        const rows = await db.query<{ portfolioId: string; n: number }>(
          `SELECT portfolioId, COUNT(*) AS n FROM "Transaction" GROUP BY portfolioId`,
        );
        const out: Record<string, number> = {};
        // A portfolio with no rows is absent rather than zero, which is what
        // the aggregate naturally produces and what the contract expects.
        for (const row of rows) out[row.portfolioId] = row.n;
        return out;
      },
    },

    settings: {
      async get() {
        const rows = await db.query<Record<string, unknown>>("SELECT * FROM Settings WHERE id = 1");
        const row = rows[0];
        if (!row) return { ...DEFAULT_SETTINGS };
        return {
          ...DEFAULT_SETTINGS,
          ...Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id")),
        } as Settings;
      },

      async save(patch) {
        const current = await this.get();
        const next: Settings = { ...current };
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) (next as Record<string, unknown>)[key] = value;
        }
        const keys = Object.keys(next);
        await db.run(
          `INSERT INTO Settings (id, ${keys.join(", ")}) VALUES (1, ${keys.map(() => "?").join(", ")})
           ON CONFLICT(id) DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(", ")}`,
          keys.map((k) => (next as Record<string, unknown>)[k] ?? null),
        );
        return next;
      },

      async exists() {
        // A real query, not `get()` compared against the defaults. `get()`
        // deliberately throws that distinction away, and it is what tells a
        // virgin install from a configured one.
        const rows = await db.query<{ one: number }>("SELECT 1 AS one FROM Settings WHERE id = 1");
        return rows.length > 0;
      },
    },
  };
}

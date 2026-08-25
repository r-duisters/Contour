/**
 * Record-level persistence, and nothing else. No computation, no currency
 * conversion, no network. Two implementations exist: Prisma on a server, and
 * SQLite on a device in Phase 4 — so anything expressible only in SQL does not
 * belong here.
 *
 * Timestamps are numbers at this boundary, never Prisma's BigInt.
 */

import type { DisplayCurrency } from "@/core/currencies";
export type AssetType = "crypto" | "equity" | "cash";
/**
 * Mirrors `TxSide` in `packages/core/src/portfolio.ts`. The two are separate
 * declarations because the port does not depend on the maths, and they must
 * not drift: a side the store can hold but the maths cannot read is a row
 * nothing can value.
 */
export type Side = "buy" | "sell" | "transfer_in" | "transfer_out" | "income";

export type Transaction = {
  id: string;
  portfolioId: string;
  symbol: string;
  assetType: AssetType;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  time: number;
  /**
   * What the trade cost in the currency it was actually made in. Kept so a EUR
   * investor's cost basis is not distorted by re-converting a USD figure at
   * today's rate; `export.ts`, `display-tx.ts` and `cash.ts` all read them.
   */
  nativeCurrency: string | null;
  nativePrice: number | null;
  nativeFee: number | null;
  note: string | null;
};

/**
 * `updatedAt` is database-maintained (Prisma's `@updatedAt`), so a caller
 * never sets it directly — it only ever comes back from a read, and it
 * advances whenever `rename` touches the row.
 */
export type Portfolio = { id: string; name: string; createdAt: number; updatedAt: number };
export type PortfolioWithTransactions = Portfolio & { transactions: Transaction[] };

/**
 * No `passwordHash`, on purpose. It is a server credential, and this port's
 * other implementation is SQLite on a device with no password and no login
 * screen. The five places that read or write it — the two login files, the
 * password change, and both halves of setup — stay on Prisma inline; see the
 * note at the top of `apps/web/src/app/api/setup/route.ts` for why an
 * accessor pair here would be the same widening under another name.
 */
export type Settings = {
  displayCurrency: DisplayCurrency;
  equityProvider: string;
  equityApiKey: string | null;
  haUrl: string | null;
  haWebhookId: string | null;
  mqttBrokerUrl: string | null;
  mqttTopicPrefix: string | null;
};

export type NewTransaction = Omit<Transaction, "id" | "portfolioId">;
export type TransactionPatch = Partial<NewTransaction>;
export type SettingsPatch = Partial<Settings>;

export interface Store {
  portfolios: {
    list(): Promise<Portfolio[]>;
    get(id: string): Promise<PortfolioWithTransactions | null>;
    create(name: string): Promise<Portfolio>;
    rename(id: string, name: string): Promise<Portfolio>;
    remove(id: string): Promise<void>;
  };
  transactions: {
    add(portfolioId: string, tx: NewTransaction): Promise<Transaction>;
    addMany(portfolioId: string, txs: NewTransaction[]): Promise<number>;
    update(id: string, patch: TransactionPatch): Promise<Transaction>;
    remove(id: string): Promise<void>;
    /**
     * Delete a named set of rows in one statement, answering how many actually
     * went. It exists so a caller that has decided *which* rows to drop — the
     * Delta-import clear-out picks its rows by `note` — keeps that predicate in
     * a service, where it is testable, instead of pushing a query language into
     * the port. One `deleteMany({ where: { id: { in: ids } } })` on Prisma, one
     * `DELETE ... WHERE id IN (...)` on device SQLite.
     *
     * Unknown ids are skipped, not an error — unlike `remove`, whose throw on a
     * missing row is pinned by the contract. The caller has just read the ids
     * it is passing; a row that disappeared in between is the outcome it asked
     * for. The count is of rows deleted, never of ids handed in.
     */
    removeMany(ids: string[]): Promise<number>;
    /**
     * One row count per portfolio id present in the store, keyed by portfolio
     * id. A plain `GROUP BY`-shaped aggregate — implementable as a real
     * aggregate query on both Prisma and device SQLite — so `GET
     * /api/portfolios` never has to fetch every transaction row just to
     * report how many there are.
     */
    countByPortfolio(): Promise<Record<string, number>>;
  };
  settings: {
    get(): Promise<Settings>;
    save(patch: SettingsPatch): Promise<Settings>;
    /**
     * Whether a settings row has ever been written — the distinction
     * `get()` deliberately throws away by defaulting.
     *
     * It exists because a virgin install is a real state the UI renders
     * differently (first-run, not a form full of defaults), and "has the user
     * been through setup" is a question only storage can answer. Without it
     * the check has to be a raw `prisma.settings.findUnique` in the route,
     * which is a persistence read no port can express — so Phase 3's
     * `DataClient` would call `getSettings`, never see `null`, and show a
     * fresh install a fully-populated settings form.
     */
    exists(): Promise<boolean>;
  };
}

/**
 * What `settings.get()` hands back when no row has ever been written. Defaulting
 * once here is the point of the method's non-nullable return: the twenty
 * `where: { id: 1 }` lookups it replaces each had to cope with a missing row.
 */
export const DEFAULT_SETTINGS: Settings = {
  displayCurrency: "USD",
  equityProvider: "yahoo",
  equityApiKey: null,
  haUrl: null,
  haWebhookId: null,
  mqttBrokerUrl: null,
  mqttTopicPrefix: null,
};

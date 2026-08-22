/**
 * Record-level persistence, and nothing else. No computation, no currency
 * conversion, no network. Two implementations exist: Prisma on a server, and
 * SQLite on a device in Phase 4 — so anything expressible only in SQL does not
 * belong here.
 *
 * Timestamps are numbers at this boundary, never Prisma's BigInt.
 */
export type AssetType = "crypto" | "equity" | "cash";
export type Side = "buy" | "sell" | "transfer_in" | "transfer_out";

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
  venue: string | null;
  note: string | null;
};

export type Portfolio = { id: string; name: string; createdAt: number };
export type PortfolioWithTransactions = Portfolio & { transactions: Transaction[] };

export type Settings = {
  displayCurrency: "USD" | "EUR";
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
    count(): Promise<number>;
  };
  transactions: {
    add(portfolioId: string, tx: NewTransaction): Promise<Transaction>;
    addMany(portfolioId: string, txs: NewTransaction[]): Promise<number>;
    update(id: string, patch: TransactionPatch): Promise<Transaction>;
    remove(id: string): Promise<void>;
    removeAllIn(portfolioId: string): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    save(patch: SettingsPatch): Promise<Settings>;
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

import {
  DEFAULT_SETTINGS,
  type NewTransaction,
  type Portfolio,
  type PortfolioWithTransactions,
  type Settings,
  type SettingsPatch,
  type Store,
  type Transaction,
  type TransactionPatch,
} from "../ports/store";

// A patch built from optional fields carries explicit `undefined`s; Prisma
// ignores those, so the fake must too or the two stores disagree on what a
// partial update means.
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

let seq = 0;
// Not `crypto.randomUUID`: this package is bundled for a device build and the
// boundary guard forbids Node builtins. Uniqueness within one process is all a
// fake needs.
function nextId(prefix: string): string {
  seq += 1;
  // Zero-padded so ids sort lexically in creation order, which is what makes
  // `cmp` below a stand-in for insertion order. Prisma's cuid has the same
  // property (leading timestamp, then a monotonic counter), so both stores
  // break ties on `time` and `createdAt` the same way — and real portfolios do
  // contain rows sharing a timestamp.
  return `${prefix}_${seq.toString(36).padStart(8, "0")}${Math.random().toString(36).slice(2, 8)}`;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type StoreSeed = {
  portfolios?: { id?: string; name: string; createdAt?: number; transactions?: NewTransaction[] }[];
  settings?: SettingsPatch;
};

/**
 * An in-process `Store`, so a service test can state its whole world in one
 * literal instead of standing up a database. It is held to the same contract
 * suite as `PrismaStore`; when the two disagree, one of them is wrong.
 */
export function MemoryStore(seed?: StoreSeed): Store {
  const portfolios = new Map<string, Portfolio>();
  const transactions = new Map<string, Transaction>();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...defined(seed?.settings ?? {}) };

  function insert(portfolioId: string, tx: NewTransaction): Transaction {
    const row: Transaction = { ...tx, id: nextId("tx"), portfolioId };
    transactions.set(row.id, row);
    return row;
  }

  for (const p of seed?.portfolios ?? []) {
    const row: Portfolio = {
      id: p.id ?? nextId("pf"),
      name: p.name,
      createdAt: p.createdAt ?? Date.now(),
    };
    portfolios.set(row.id, row);
    for (const tx of p.transactions ?? []) insert(row.id, tx);
  }

  function inPortfolio(portfolioId: string): Transaction[] {
    return [...transactions.values()].filter((t) => t.portfolioId === portfolioId);
  }

  return {
    portfolios: {
      async list(): Promise<Portfolio[]> {
        return [...portfolios.values()]
          .sort((a, b) => a.createdAt - b.createdAt || cmp(a.id, b.id))
          .map((p) => ({ ...p }));
      },
      async get(id: string): Promise<PortfolioWithTransactions | null> {
        const p = portfolios.get(id);
        if (!p) return null;
        return {
          ...p,
          transactions: inPortfolio(id)
            .sort((a, b) => a.time - b.time || cmp(a.id, b.id))
            .map((t) => ({ ...t })),
        };
      },
      async create(name: string): Promise<Portfolio> {
        const row: Portfolio = { id: nextId("pf"), name, createdAt: Date.now() };
        portfolios.set(row.id, row);
        return { ...row };
      },
      async rename(id: string, name: string): Promise<Portfolio> {
        const p = portfolios.get(id);
        if (!p) throw new Error(`MemoryStore: no portfolio ${id}`);
        p.name = name;
        return { ...p };
      },
      async remove(id: string): Promise<void> {
        if (!portfolios.delete(id)) throw new Error(`MemoryStore: no portfolio ${id}`);
        for (const t of inPortfolio(id)) transactions.delete(t.id);
      },
      async count(): Promise<number> {
        return portfolios.size;
      },
    },
    transactions: {
      async add(portfolioId: string, tx: NewTransaction): Promise<Transaction> {
        return { ...insert(portfolioId, tx) };
      },
      async addMany(portfolioId: string, txs: NewTransaction[]): Promise<number> {
        for (const tx of txs) insert(portfolioId, tx);
        return txs.length;
      },
      async update(id: string, patch: TransactionPatch): Promise<Transaction> {
        const row = transactions.get(id);
        if (!row) throw new Error(`MemoryStore: no transaction ${id}`);
        const next = { ...row, ...defined(patch) };
        transactions.set(id, next);
        return { ...next };
      },
      async remove(id: string): Promise<void> {
        if (!transactions.delete(id)) throw new Error(`MemoryStore: no transaction ${id}`);
      },
      async removeAllIn(portfolioId: string): Promise<void> {
        for (const t of inPortfolio(portfolioId)) transactions.delete(t.id);
      },
    },
    settings: {
      async get(): Promise<Settings> {
        return { ...settings };
      },
      async save(patch: SettingsPatch): Promise<Settings> {
        settings = { ...settings, ...defined(patch) };
        return { ...settings };
      },
    },
  };
}

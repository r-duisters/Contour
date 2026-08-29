import type { Alert } from "../ports/store";
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
  portfolios?: {
    id?: string;
    name: string;
    createdAt?: number;
    updatedAt?: number;
    /**
     * `id` is optional and normally left out — generated ids are what the real
     * stores produce. It exists for a caller that has to *name* a row it will
     * later address: `client-contract.ts` fixes the id it deletes, so the
     * client suite's seed has to be able to place it.
     */
    transactions?: (NewTransaction & { id?: string })[];
  }[];
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
  const alerts: Alert[] = [];
  let alertSeq = 0;
  let settings: Settings = { ...DEFAULT_SETTINGS, ...defined(seed?.settings ?? {}) };
  // Mirrors PrismaStore, where the row is created on first save: seeding
  // settings is the in-memory equivalent of an install that has been through
  // setup, and an unseeded store is a virgin one.
  let settingsWritten = seed?.settings !== undefined;

  function insert(portfolioId: string, tx: NewTransaction & { id?: string }): Transaction {
    const { id, ...rest } = tx;
    // `sourceSymbol` is optional on the way in and required on the way out —
    // see the note on NewTransaction. Defaulting it here is what makes the two
    // stores agree, and the contract case is what proves they do.
    const row: Transaction = {
      ...rest,
      // Explicit rather than a default in the spread: a caller passing
      // `sourceSymbol: undefined` would otherwise overwrite the default with
      // undefined, and the row would read back as neither a string nor null.
      sourceSymbol: rest.sourceSymbol ?? null,
      id: id ?? nextId("tx"),
      portfolioId,
    };
    transactions.set(row.id, row);
    return row;
  }

  for (const p of seed?.portfolios ?? []) {
    const createdAt = p.createdAt ?? Date.now();
    const row: Portfolio = {
      id: p.id ?? nextId("pf"),
      name: p.name,
      createdAt,
      updatedAt: p.updatedAt ?? createdAt,
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
        const now = Date.now();
        const row: Portfolio = { id: nextId("pf"), name, createdAt: now, updatedAt: now };
        portfolios.set(row.id, row);
        return { ...row };
      },
      async rename(id: string, name: string): Promise<Portfolio> {
        const p = portfolios.get(id);
        if (!p) throw new Error(`MemoryStore: no portfolio ${id}`);
        p.name = name;
        // Mirrors Prisma's `@updatedAt`, which stamps on every write to the row.
        p.updatedAt = Date.now();
        return { ...p };
      },
      async remove(id: string): Promise<void> {
        if (!portfolios.delete(id)) throw new Error(`MemoryStore: no portfolio ${id}`);
        for (const t of inPortfolio(id)) transactions.delete(t.id);
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
      async removeMany(ids: string[]): Promise<number> {
        // Counts deletions, not ids: an id that is not here was already gone.
        let removed = 0;
        for (const id of ids) if (transactions.delete(id)) removed += 1;
        return removed;
      },
      async countByPortfolio(): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        for (const t of transactions.values()) counts[t.portfolioId] = (counts[t.portfolioId] ?? 0) + 1;
        return counts;
      },
    },
    alerts: {
      async list() {
        // Newest first, and *stably*: two alerts made in the same millisecond
        // share a `createdAt`, and a sort on that alone left them in whichever
        // order the engine chose. SqliteStore orders by `createdAt DESC, id
        // DESC`, so the tiebreak is insertion order here to match it.
        return alerts
          .map((a, i) => ({ a, i }))
          .sort((x, y) => y.a.createdAt - x.a.createdAt || y.i - x.i)
          .map(({ a }) => ({ ...a }));
      },
      async create(alert) {
        const row: Alert = {
          ...alert,
          id: `alert-${++alertSeq}`,
          enabled: alert.enabled ?? true,
          createdAt: Date.now(),
        };
        alerts.push(row);
        return { ...row };
      },
      async remove(id) {
        const at = alerts.findIndex((a) => a.id === id);
        // Throws on a missing row, like `transactions.remove`: the contract
        // pins that, and Prisma does it whether or not anyone asked.
        if (at < 0) throw new Error(`no alert ${id}`);
        alerts.splice(at, 1);
      },
      async setEnabled(id, enabled) {
        const row = alerts.find((a) => a.id === id);
        if (!row) throw new Error(`no alert ${id}`);
        row.enabled = enabled;
        return { ...row };
      },
    },
    settings: {
      async get(): Promise<Settings> {
        return { ...settings };
      },
      async save(patch: SettingsPatch): Promise<Settings> {
        settings = { ...settings, ...defined(patch) };
        settingsWritten = true;
        return { ...settings };
      },
      async exists(): Promise<boolean> {
        return settingsWritten;
      },
    },
  };
}

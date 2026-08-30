import type { Prisma, PrismaClient, Transaction as PrismaTransaction } from "@prisma/client";
import { asDisplayCurrency } from "@/core/currencies";
import {
  DEFAULT_SETTINGS,
  type AssetType,
  type Alert,
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
import { prisma as defaultClient } from "../db";

/**
 * The server-side `Store`. Its whole job is to be the last place BigInt and
 * Date exist: everything above it works in `number`, so a service produces
 * byte-identical JSON whether it ran here or against the device store.
 *
 * Row order is pinned with an explicit `id` tie-break rather than left to
 * SQLite's rowid: `Transaction.id` is a cuid, whose leading timestamp and
 * monotonic counter make lexical order creation order, so a same-`time` pair
 * comes back here in the order the device store will also produce.
 */

function toPortfolio(row: { id: string; name: string; createdAt: Date; updatedAt: Date }): Portfolio {
  return { id: row.id, name: row.name, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() };
}

function toTransaction(row: PrismaTransaction): Transaction {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    symbol: row.symbol,
    assetType: row.assetType as AssetType,
    side: row.side as Side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    time: Number(row.time),
    nativeCurrency: row.nativeCurrency,
    nativePrice: row.nativePrice,
    nativeFee: row.nativeFee,
    sourceSymbol: row.sourceSymbol,
    note: row.note,
  };
}

function toCreateData(tx: NewTransaction): Omit<Prisma.TransactionCreateManyInput, "portfolioId"> {
  return {
    symbol: tx.symbol,
    assetType: tx.assetType,
    side: tx.side,
    quantity: tx.quantity,
    price: tx.price,
    fee: tx.fee,
    time: BigInt(tx.time),
    nativeCurrency: tx.nativeCurrency,
    nativePrice: tx.nativePrice,
    nativeFee: tx.nativeFee,
    sourceSymbol: tx.sourceSymbol ?? null,
    note: tx.note,
  };
}

// `undefined` means "leave alone" to Prisma, so a patch can be handed over
// field by field without first asking which keys the caller supplied.
function toUpdateData(patch: TransactionPatch): Prisma.TransactionUpdateInput {
  return {
    symbol: patch.symbol,
    assetType: patch.assetType,
    side: patch.side,
    quantity: patch.quantity,
    price: patch.price,
    fee: patch.fee,
    time: patch.time === undefined ? undefined : BigInt(patch.time),
    nativeCurrency: patch.nativeCurrency,
    nativePrice: patch.nativePrice,
    nativeFee: patch.nativeFee,
    sourceSymbol: patch.sourceSymbol,
    note: patch.note,
  };
}

function toSettings(row: {
  displayCurrency: string;
  equityProvider: string;
  equityApiKey: string | null;
  haUrl: string | null;
  haWebhookId: string | null;
  mqttBrokerUrl: string | null;
  mqttTopicPrefix: string | null;
  privateCoinPrices: boolean;
} | null): Settings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    displayCurrency: asDisplayCurrency(row.displayCurrency),
    equityProvider: row.equityProvider,
    equityApiKey: row.equityApiKey,
    haUrl: row.haUrl,
    haWebhookId: row.haWebhookId,
    privateCoinPrices: row.privateCoinPrices,
    mqttBrokerUrl: row.mqttBrokerUrl,
    mqttTopicPrefix: row.mqttTopicPrefix,
  };
}

/**
 * How many ids one `DELETE ... WHERE id IN (...)` may bind. Every id is a
 * SQLite variable, and while the driver this ships with allows 32 766, an older
 * build caps at 999 — so stay under the conservative ceiling and let
 * `$transaction` keep a longer list atomic. A 462-row portfolio is one chunk.
 */
const DELETE_CHUNK = 500;

/** One Prisma row as the port describes it. */
function toAlert(row: {
  id: string; kind: string; symbol: string | null; portfolioId: string | null;
  assetType: string;
  params: string; repeat: boolean; enabled: boolean; createdAt: Date;
}): Alert {
  const params = JSON.parse(row.params) as { direction?: string; price?: number; threshold?: number };
  const target = row.kind === "price_target";
  return {
    id: row.id,
    kind: target ? "price_target" : "pct_move",
    // Null, not "". A portfolio-scoped rule names no symbol, and the empty
    // string reads as one that failed to load — `expandRules` branches on
    // exactly this, so flattening it turned "every holding" into "a holding
    // called nothing".
    symbol: row.symbol ?? null,
    portfolioId: row.portfolioId ?? null,
    assetType: row.assetType === "equity" ? "equity" : "crypto",
    threshold: (target ? params.price : params.threshold) ?? 0,
    direction: target ? (params.direction === "below" ? "below" : "above") : null,
    repeat: row.repeat,
    enabled: row.enabled,
    createdAt: row.createdAt.getTime(),
  };
}

export function PrismaStore(client: PrismaClient = defaultClient): Store {
  return {
    portfolios: {
      async list(): Promise<Portfolio[]> {
        const rows = await client.portfolio.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        return rows.map(toPortfolio);
      },
      async get(id: string): Promise<PortfolioWithTransactions | null> {
        const row = await client.portfolio.findUnique({
          where: { id },
          include: { transactions: { orderBy: [{ time: "asc" }, { id: "asc" }] } },
        });
        if (!row) return null;
        return { ...toPortfolio(row), transactions: row.transactions.map(toTransaction) };
      },
      async create(name: string): Promise<Portfolio> {
        return toPortfolio(await client.portfolio.create({ data: { name } }));
      },
      async rename(id: string, name: string): Promise<Portfolio> {
        return toPortfolio(await client.portfolio.update({ where: { id }, data: { name } }));
      },
      async remove(id: string): Promise<void> {
        await client.portfolio.delete({ where: { id } });
      },
    },
    transactions: {
      async add(portfolioId: string, tx: NewTransaction): Promise<Transaction> {
        const row = await client.transaction.create({
          data: { ...toCreateData(tx), portfolioId },
        });
        return toTransaction(row);
      },
      async addMany(portfolioId: string, txs: NewTransaction[]): Promise<number> {
        if (txs.length === 0) return 0;
        const { count } = await client.transaction.createMany({
          data: txs.map((tx) => ({ ...toCreateData(tx), portfolioId })),
        });
        return count;
      },
      async update(id: string, patch: TransactionPatch): Promise<Transaction> {
        const row = await client.transaction.update({ where: { id }, data: toUpdateData(patch) });
        return toTransaction(row);
      },
      async remove(id: string): Promise<void> {
        await client.transaction.delete({ where: { id } });
      },
      async removeMany(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += DELETE_CHUNK) chunks.push(ids.slice(i, i + DELETE_CHUNK));
        if (chunks.length === 1) {
          const { count } = await client.transaction.deleteMany({ where: { id: { in: chunks[0]! } } });
          return count;
        }
        // More than one statement, so wrap them: the point of this method is
        // that a clear-out either happens or does not, and a crash between two
        // chunks would leave an arbitrary prefix of the portfolio deleted.
        const results = await client.$transaction(
          chunks.map((chunk) => client.transaction.deleteMany({ where: { id: { in: chunk } } })),
        );
        return results.reduce((n, r) => n + r.count, 0);
      },
      async countByPortfolio(): Promise<Record<string, number>> {
        // A real aggregate — one query, not one per portfolio — so listing
        // portfolios never has to pull every transaction row just to count
        // them.
        const rows = await client.transaction.groupBy({ by: ["portfolioId"], _count: { _all: true } });
        return Object.fromEntries(rows.map((r) => [r.portfolioId, r._count._all]));
      },
    },
    /*
     * The port's narrow view of the richer table this app already has.
     *
     * `schema.prisma`'s `Alert` carries `timeframe`, a JSON `params` blob and
     * an `indicator` kind that the alerts page uses and a phone cannot. The
     * port sees only what a device can evaluate — one live price, and a level
     * or a threshold — so `params` is read and written here rather than
     * travelling as an opaque string through a portable interface.
     *
     * Indicator alerts are filtered out rather than mapped: they have no
     * threshold to report, and inventing one would make them look evaluable.
     */
    alerts: {
      async list() {
        const rows = await client.alert.findMany({
          // No `symbol: { not: null }`. That filter dropped every
          // portfolio-scoped rule before anything could evaluate it — the
          // second of three places this shape was being discarded on the way
          // to a device.
          where: { kind: { in: ["price_target", "pct_move"] } },
          orderBy: { createdAt: "desc" },
        });
        return rows.map(toAlert);
      },
      async create(alert) {
        const row = await client.alert.create({
          data: {
            kind: alert.kind,
            symbol: alert.symbol ?? null,
            portfolioId: alert.portfolioId ?? null,
            assetType: alert.assetType,
            repeat: alert.repeat ?? false,
            timeframe: "1d",
            enabled: alert.enabled ?? true,
            params: JSON.stringify(
              alert.kind === "price_target"
                ? { direction: alert.direction ?? "above", price: alert.threshold }
                : { threshold: alert.threshold },
            ),
          },
        });
        return toAlert(row);
      },
      async remove(id) {
        await client.alert.delete({ where: { id } });
      },
      async setEnabled(id, enabled) {
        return toAlert(await client.alert.update({ where: { id }, data: { enabled } }));
      },
    },
    settings: {
      async get(): Promise<Settings> {
        return toSettings(await client.settings.findUnique({ where: { id: 1 } }));
      },
      async save(patch: SettingsPatch): Promise<Settings> {
        // The row is created on first save rather than at setup, so every
        // caller can treat settings as always-present.
        const row = await client.settings.upsert({
          where: { id: 1 },
          create: { id: 1, ...patch },
          update: patch,
        });
        return toSettings(row);
      },
      async exists(): Promise<boolean> {
        // `select: { id: true }` rather than a full row: the answer is one bit
        // and the row carries an API key.
        return (await client.settings.findUnique({ where: { id: 1 }, select: { id: true } })) !== null;
      },
    },
  };
}

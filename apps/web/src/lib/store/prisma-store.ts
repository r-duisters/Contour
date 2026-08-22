import type { Prisma, PrismaClient, Transaction as PrismaTransaction } from "@prisma/client";
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
} | null): Settings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    displayCurrency: row.displayCurrency === "EUR" ? "EUR" : "USD",
    equityProvider: row.equityProvider,
    equityApiKey: row.equityApiKey,
    haUrl: row.haUrl,
    haWebhookId: row.haWebhookId,
    mqttBrokerUrl: row.mqttBrokerUrl,
    mqttTopicPrefix: row.mqttTopicPrefix,
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
      async count(): Promise<number> {
        return client.portfolio.count();
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
      async removeAllIn(portfolioId: string): Promise<void> {
        await client.transaction.deleteMany({ where: { portfolioId } });
      },
      async countByPortfolio(): Promise<Record<string, number>> {
        // A real aggregate — one query, not one per portfolio — so listing
        // portfolios never has to pull every transaction row just to count
        // them.
        const rows = await client.transaction.groupBy({ by: ["portfolioId"], _count: { _all: true } });
        return Object.fromEntries(rows.map((r) => [r.portfolioId, r._count._all]));
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
    },
  };
}

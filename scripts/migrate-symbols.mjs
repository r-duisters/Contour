/**
 * Rewrite crypto symbols from pricing pairs to assets: ETHUSDT -> ETH.
 *
 * Idempotent: `assetOf` leaves a bare asset alone, so a second run is a no-op.
 * Refuses to run if two symbols would collide into one — merging two positions
 * may well be correct, but it must be a decision somebody makes, not a side
 * effect of a rename.
 *
 * `Alert.symbol` is deliberately untouched. An alert fetches Binance klines,
 * and a pair is what it addresses.
 *
 * `apps/web/.env` is read by the Prisma CLI, not by `tsx`, so the URL has to
 * be named on the command line even when run from `apps/web`:
 *
 *   DATABASE_URL="file:$PWD/apps/web/prisma/dev.db" npx tsx scripts/migrate-symbols.mjs
 *   DATABASE_URL="file:$PWD/apps/web/prisma/dev.db" npx tsx scripts/migrate-symbols.mjs --apply
 */
import { PrismaClient } from "@prisma/client";
import { assetOf } from "../packages/core/src/symbols.ts";

const prisma = new PrismaClient();
const rows = await prisma.transaction.findMany({ where: { assetType: "crypto" } });

const moves = new Map();
for (const r of rows) {
  const to = assetOf(r.symbol);
  if (to !== r.symbol) moves.set(r.symbol, to);
}

// Two properties this data must have, asserted rather than assumed, because
// the ledger grows after the day they were checked by hand.
for (const [from, to] of moves) {
  if (assetOf(to) !== to) {
    console.error(`REFUSING: ${from} -> ${to} is not stable; a second run would eat it.`);
    process.exit(1);
  }
}
const landing = new Map();
for (const symbol of new Set(rows.map((r) => r.symbol))) {
  const to = assetOf(symbol);
  const first = landing.get(to);
  if (first !== undefined && first !== symbol) {
    console.error(`REFUSING: ${symbol} and ${first} both become ${to}.`);
    process.exit(1);
  }
  landing.set(to, symbol);
}

console.log(`${rows.length} crypto rows, ${moves.size} symbols to rename:`);
for (const [from, to] of moves) console.log(`  ${from} -> ${to}`);

if (process.argv.includes("--apply")) {
  for (const [from, to] of moves) {
    const { count } = await prisma.transaction.updateMany({
      where: { assetType: "crypto", symbol: from },
      data: { symbol: to },
    });
    console.log(`  ${from} -> ${to}: ${count} rows`);
  }
} else {
  console.log("\nDry run. Pass --apply to write.");
}
await prisma.$disconnect();

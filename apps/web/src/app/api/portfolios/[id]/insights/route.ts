import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toDisplayTxs } from "@/lib/display-tx";
import { flowsByYear, tradeStats } from "@/lib/insights";
import { displayContext } from "@/data/services/pricing";
import { deps } from "@/lib/deps";

export const dynamic = "force-dynamic";

/**
 * Statistics derived from the transaction log alone — no market data, so this
 * answers instantly while the valuation and series calls are still running.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { transactions: true },
  });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { store, net } = deps();
  const { currency, toDisplay, displayUsd } = await displayContext(store, net);

  // Moving euros between a bank and an exchange is not a trade, and counting
  // it as one inflated every figure here.
  const txs = toDisplayTxs(
    portfolio.transactions.filter((t) => t.assetType !== "cash"),
    currency,
    toDisplay,
  );
  return NextResponse.json({
    currency: displayUsd > 0 ? currency : "USD",
    stats: tradeStats(txs),
    byYear: flowsByYear(txs),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchLatestEurUsd } from "@/lib/fx";
import { toDisplayTxs } from "@/lib/display-tx";
import { flowsByYear, tradeStats } from "@/lib/insights";

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

  const settings = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { displayCurrency: true },
  });
  const currency = settings?.displayCurrency === "EUR" ? "EUR" : "USD";
  const displayUsd = currency === "EUR" ? ((await fetchLatestEurUsd()) ?? 0) : 1;
  const toDisplay = displayUsd > 0 ? 1 / displayUsd : 1;

  const txs = toDisplayTxs(portfolio.transactions, currency, toDisplay);
  return NextResponse.json({
    currency: displayUsd > 0 ? currency : "USD",
    stats: tradeStats(txs),
    byYear: flowsByYear(txs),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fetchLatestEurUsd } from "@/lib/fx";
import { toDisplayTxs } from "@/lib/display-tx";
import {
  BACKUP_VERSION, ghostfolioCsv, transactionsCsv, type ExportTx,
} from "@/lib/export";

export const dynamic = "force-dynamic";

const Query = z.object({ format: z.enum(["json", "csv", "ghostfolio"]).default("json") });

/** Download the portfolio as a restorable backup or as a spreadsheet. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Query.safeParse({ format: req.nextUrl.searchParams.get("format") ?? "json" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { format } = parsed.data;

  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { transactions: { orderBy: { time: "asc" } } },
  });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = portfolio.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "portfolio";

  if (format === "json") {
    // Raw stored values: a backup must restore exactly what was captured,
    // independent of today's exchange rate or display currency.
    const body = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      portfolio: {
        name: portfolio.name,
        transactions: portfolio.transactions.map((t) => ({
          symbol: t.symbol,
          assetType: t.assetType,
          side: t.side,
          quantity: t.quantity,
          price: t.price,
          fee: t.fee,
          time: Number(t.time),
          nativeCurrency: t.nativeCurrency,
          nativePrice: t.nativePrice,
          nativeFee: t.nativeFee,
          note: t.note,
        })),
      },
    }, null, 2);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${slug}-backup-${stamp}.json"`,
      },
    });
  }

  const settings = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { displayCurrency: true },
  });
  const currency = settings?.displayCurrency === "EUR" ? "EUR" : "USD";
  const displayUsd = currency === "EUR" ? ((await fetchLatestEurUsd()) ?? 0) : 1;
  const toDisplay = displayUsd > 0 ? 1 / displayUsd : 1;

  const display = toDisplayTxs(portfolio.transactions, currency, toDisplay);
  const rows: ExportTx[] = portfolio.transactions.map((t, i) => ({
    symbol: t.symbol,
    assetType: t.assetType,
    side: t.side,
    quantity: t.quantity,
    price: display[i]!.price,
    fee: display[i]!.fee,
    time: Number(t.time),
    nativeCurrency: t.nativeCurrency,
    nativePrice: t.nativePrice,
    note: t.note,
  }));

  const csv = format === "ghostfolio"
    ? ghostfolioCsv(rows, displayUsd > 0 ? currency : "USD")
    : transactionsCsv(rows, displayUsd > 0 ? currency : "USD");
  const name = format === "ghostfolio" ? "ghostfolio" : "transactions";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${name}-${stamp}.csv"`,
    },
  });
}

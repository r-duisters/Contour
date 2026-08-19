import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseDeltaCsv, type ParsedTx, type SkippedRow } from "@/lib/delta-csv";
import { fetchKlinesRange } from "@/lib/binance";

export const dynamic = "force-dynamic";

const Body = z.object({ csv: z.string().min(1).max(5_000_000) });

const DAY_MS = 86_400_000;
const utcDay = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;

/**
 * Resolve non-USD quotes (EUR, BTC, ...) to USD using the <currency>USDT
 * daily close on each transaction's date. Mutates row.price/row.fee.
 * Returns warnings for rows that stay unpriced.
 */
async function resolvePendingQuotes(rows: ParsedTx[]): Promise<SkippedRow[]> {
  const warnings: SkippedRow[] = [];
  const currencies = new Set<string>();
  for (const r of rows) {
    if (r.pendingQuote) currencies.add(r.pendingQuote.currency);
    if (r.feeRaw && r.feeRaw.currency !== r.symbol.replace(/USDT$/, "")) currencies.add(r.feeRaw.currency);
  }

  const rates = new Map<string, Map<number, number>>(); // currency -> day -> close
  for (const c of currencies) {
    const relevant = rows.filter(
      (r) => r.pendingQuote?.currency === c || r.feeRaw?.currency === c,
    );
    const from = Math.min(...relevant.map((r) => r.time)) - 3 * DAY_MS;
    const to = Math.max(...relevant.map((r) => r.time)) + DAY_MS;
    try {
      const bars = await fetchKlinesRange({ symbol: `${c}USDT`, interval: "1d", from, to });
      rates.set(c, new Map(bars.map((b) => [b.t, b.c])));
    } catch {
      rates.set(c, new Map()); // no USDT market for this currency
    }
  }

  const rateFor = (currency: string, time: number): number | null => {
    const byDay = rates.get(currency);
    if (!byDay) return null;
    // fall back up to 3 days for weekend/holiday gaps in fiat pairs
    for (let d = 0; d <= 3; d++) {
      const close = byDay.get(utcDay(time) - d * DAY_MS);
      if (close !== undefined) return close;
    }
    return null;
  };

  for (const [i, r] of rows.entries()) {
    if (r.pendingQuote) {
      const rate = rateFor(r.pendingQuote.currency, r.time);
      if (rate !== null) {
        r.price = (r.pendingQuote.total / r.quantity) * rate;
      } else if (r.side === "buy" || r.side === "sell") {
        warnings.push({
          line: i + 2, // approximate: original line numbers are lost after parse; index is informative enough
          reason: `no ${r.pendingQuote.currency}USDT market to price ${r.symbol} — imported with price 0`,
        });
      }
    }
    if (r.feeRaw && r.fee === 0) {
      const base = r.symbol.replace(/USDT$/, "");
      if (r.feeRaw.currency === base && r.price > 0) {
        r.fee = r.feeRaw.amount * r.price;
      } else {
        const rate = rateFor(r.feeRaw.currency, r.time);
        if (rate !== null) r.fee = r.feeRaw.amount * rate;
      }
    }
  }
  return warnings;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const portfolio = await prisma.portfolio.findUnique({ where: { id } });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { rows, skipped, warnings } = parseDeltaCsv(body.data.csv);
  const fxWarnings = await resolvePendingQuotes(rows);

  // Idempotency: skip rows that already exist in this portfolio.
  const existing = await prisma.transaction.findMany({
    where: { portfolioId: id },
    select: { symbol: true, side: true, quantity: true, time: true },
  });
  const seen = new Set(existing.map((t) => `${t.symbol}|${t.side}|${t.quantity}|${t.time}`));
  const fresh = rows.filter((r) => !seen.has(`${r.symbol}|${r.side}|${r.quantity}|${BigInt(r.time)}`));
  const duplicates = rows.length - fresh.length;

  if (fresh.length > 0) {
    await prisma.transaction.createMany({
      data: fresh.map((r) => ({
        portfolioId: id,
        symbol: r.symbol,
        side: r.side,
        quantity: r.quantity,
        price: r.price,
        fee: r.fee,
        time: BigInt(r.time),
        note: "delta-import",
      })),
    });
  }
  return NextResponse.json({
    imported: fresh.length,
    duplicates,
    skipped,
    warnings: [...warnings, ...fxWarnings],
  });
}

/** Remove everything a Delta import added to this portfolio. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await prisma.transaction.deleteMany({
    where: { portfolioId: id, note: "delta-import" },
  });
  return NextResponse.json({ deleted: res.count });
}

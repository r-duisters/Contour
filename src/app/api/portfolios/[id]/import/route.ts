import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseDeltaCsv, venueAssetType, type ParsedTx, type SkippedRow } from "@/lib/delta-csv";
import { fetchKlinesRange, fetchUsdtSymbols } from "@/lib/binance";
import { fetchEcbRates } from "@/lib/fx";

export const dynamic = "force-dynamic";

const Body = z.object({ csv: z.string().min(1).max(5_000_000) });

const DAY_MS = 86_400_000;
const utcDay = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;
const FIAT = new Set(["EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "PLN"]);

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
    const byDay = new Map<number, number>();
    try {
      const bars = await fetchKlinesRange({ symbol: `${c}USDT`, interval: "1d", from, to });
      for (const b of bars) byDay.set(b.t, b.c);
    } catch {
      // no Binance market for this currency
    }
    // Fiat: fill dates Binance cannot cover (EURUSDT only lists from late 2020)
    // with ECB reference rates.
    if (FIAT.has(c)) {
      const earliestNeeded = Math.min(...relevant.map((r) => utcDay(r.time)));
      const earliestBinance = byDay.size > 0 ? Math.min(...byDay.keys()) : Infinity;
      if (earliestNeeded < earliestBinance) {
        try {
          const ecb = await fetchEcbRates(c, "USD", earliestNeeded - 5 * DAY_MS,
            Math.min(earliestBinance, to));
          for (const [day, rate] of ecb) if (!byDay.has(day)) byDay.set(day, rate);
        } catch {
          // ECB unavailable; those rows stay unpriced and get warned about
        }
      }
    }
    rates.set(c, byDay);
  }

  const rateFor = (currency: string, time: number): number | null => {
    const byDay = rates.get(currency);
    if (!byDay) return null;
    // fall back up to 3 days for weekend/holiday gaps in fiat pairs
    for (let d = 0; d <= 5; d++) {
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

/**
 * Delta lists US stocks without an exchange suffix (AMD), which look like coin
 * tickers. "Not on Binance" alone is NOT enough to call something a stock —
 * delisted coins (SUB, MATIC, XMR) would then match unrelated equity tickers
 * and inject phantom value. The venue decides; ambiguity stays crypto, where
 * an unknown asset simply shows as unpriced.
 */
async function reclassifyNonCoins(rows: ParsedTx[]): Promise<void> {
  const candidates = rows.filter((r) => r.assetType === "crypto"); // cash and equities are already settled
  if (candidates.length === 0) return;
  let coins = new Set<string>();
  try {
    coins = new Set(await fetchUsdtSymbols());
  } catch {
    // Binance unreachable: fall back to venue signal alone
  }
  for (const r of candidates) {
    const venue = venueAssetType(r.venue);
    if (venue === "crypto") continue;                   // wallet/exchange row: always a coin
    if (coins.has(`${r.base}USDT`)) continue;           // tradable coin
    if (venue !== "equity") continue;                   // unknown venue: keep crypto, stay unpriced
    r.assetType = "equity";
    r.symbol = r.base;
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const portfolio = await prisma.portfolio.findUnique({ where: { id } });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { rows, skipped, warnings } = parseDeltaCsv(body.data.csv);
  await reclassifyNonCoins(rows);
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
        assetType: r.assetType,
        side: r.side,
        quantity: r.quantity,
        price: r.price,
        fee: r.fee,
        nativeCurrency: r.nativeCurrency ?? null,
        nativePrice: r.nativePrice ?? null,
        nativeFee: r.nativeFee ?? null,
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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fetchKlinesRange } from "@/lib/binance";
import { fetchEcbRates, rateOn } from "@/lib/fx";
import { currencyForTicker, makeEquitySource } from "@/lib/equity";
import { computeHoldings } from "@/lib/portfolio";
import { cashBalances } from "@/lib/cash";
import { toDisplayTxs } from "@/lib/display-tx";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const Query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/**
 * What the portfolio held, and what it was worth, on one date.
 *
 * Dutch box 3 is assessed on wealth held at the start of the year, so the
 * figure needed each January is a valuation at a past date, not today's.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Query.safeParse({ date: req.nextUrl.searchParams.get("date") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const at = Date.parse(`${parsed.data.date}T00:00:00Z`);
  if (!Number.isFinite(at)) return NextResponse.json({ error: "unparseable date" }, { status: 400 });
  const day = Math.floor(at / DAY_MS) * DAY_MS;

  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { transactions: true },
  });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const settings = await prisma.settings.findUnique({
    where: { id: 1 },
    select: { displayCurrency: true, equityProvider: true, equityApiKey: true },
  });
  const currency = settings?.displayCurrency === "EUR" ? "EUR" : "USD";

  // Everything as it stood on the date: later transactions do not exist yet.
  const upTo = portfolio.transactions.filter((t) => Number(t.time) <= at + DAY_MS);
  if (upTo.length === 0) {
    return NextResponse.json({ date: parsed.data.date, currency, rows: [], total: 0 });
  }

  // Historical FX for the date itself, not today's rate.
  let usdToDisplay = 1;
  if (currency !== "USD") {
    try {
      const rates = await fetchEcbRates("USD", currency, at - 10 * DAY_MS, at + DAY_MS);
      usdToDisplay = rateOn(rates, at) ?? 1;
    } catch {
      usdToDisplay = 1;
    }
  }

  const assetRows = upTo.filter((t) => t.assetType !== "cash");
  const txs = toDisplayTxs(assetRows, currency, usdToDisplay);
  const holdings = computeHoldings(txs).filter((h) => h.quantity > 1e-12);
  const equity = new Set(upTo.filter((t) => t.assetType === "equity").map((t) => t.symbol));

  const source = makeEquitySource(settings?.equityProvider, settings?.equityApiKey);
  const fxCache = new Map<string, Map<number, number>>();

  const priced = await Promise.all(holdings.map(async (h) => {
    let price: number | null = null;
    try {
      if (equity.has(h.symbol)) {
        const years = Math.max(1, Math.min(10, Math.ceil((Date.now() - at) / (365 * DAY_MS)) + 1));
        const rows = await cached(`snap-eq:${h.symbol}:${years}`, 3_600_000, async () =>
          source.history ? await source.history(h.symbol, `${years}y`, "1d") : [],
        );
        const before = rows.filter((r) => r.t <= at + DAY_MS);
        const native = before[before.length - 1]?.c ?? null;
        const cur = currencyForTicker(h.symbol);
        if (native !== null) {
          if (cur === currency) price = native;
          else {
            if (!fxCache.has(cur)) {
              fxCache.set(cur, await fetchEcbRates(cur, currency, at - 10 * DAY_MS, at + DAY_MS)
                .catch(() => new Map<number, number>()));
            }
            const rate = rateOn(fxCache.get(cur)!, at);
            price = rate === null ? null : native * rate;
          }
        }
      } else {
        const bars = await cached(`snap-cx:${h.symbol}:${day}`, 3_600_000, () =>
          fetchKlinesRange({ symbol: h.symbol, interval: "1d", from: at - 7 * DAY_MS, to: at + DAY_MS }),
        );
        const usd = bars[bars.length - 1]?.c ?? null;
        price = usd === null ? null : usd * usdToDisplay;
      }
    } catch {
      price = null;
    }
    return {
      symbol: h.symbol,
      assetType: equity.has(h.symbol) ? "equity" : "crypto",
      quantity: h.quantity,
      price,
      value: price === null ? null : h.quantity * price,
    };
  }));

  // Cash as it stood on the date, converted at that date's rate.
  const balances = cashBalances(upTo);
  const cashRows = [];
  for (const [cur, amount] of Object.entries(balances)) {
    let rate = 1;
    if (cur !== currency) {
      if (!fxCache.has(cur)) {
        fxCache.set(cur, await fetchEcbRates(cur, currency, at - 10 * DAY_MS, at + DAY_MS)
          .catch(() => new Map<number, number>()));
      }
      const r = rateOn(fxCache.get(cur)!, at);
      if (r === null) continue;
      rate = r;
    }
    cashRows.push({
      symbol: cur, assetType: "cash", quantity: amount, price: rate, value: amount * rate,
    });
  }

  const rows = [...priced, ...cashRows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return NextResponse.json({
    date: parsed.data.date,
    currency,
    rows,
    total: rows.reduce((a, r) => a + (r.value ?? 0), 0),
    unpriced: rows.filter((r) => r.value === null).length,
  });
}

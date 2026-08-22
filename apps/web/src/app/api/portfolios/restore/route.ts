import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseBackup } from "@/lib/export";

export const dynamic = "force-dynamic";

const Body = z.object({ backup: z.string().min(1).max(20_000_000) });

/**
 * Restore a backup into a NEW portfolio. Never overwrites an existing one:
 * a restore that silently replaced live data would be unrecoverable.
 */
export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const parsed = parseBackup(body.data.backup);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { portfolio } = parsed.backup;

  const existing = await prisma.portfolio.count({ where: { name: portfolio.name } });
  const name = existing > 0
    ? `${portfolio.name} (restored ${new Date().toISOString().slice(0, 10)})`
    : portfolio.name;

  const created = await prisma.portfolio.create({ data: { name } });
  if (portfolio.transactions.length > 0) {
    await prisma.transaction.createMany({
      data: portfolio.transactions.map((t) => ({
        portfolioId: created.id,
        symbol: t.symbol,
        assetType: t.assetType,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        time: BigInt(t.time),
        nativeCurrency: t.nativeCurrency ?? null,
        nativePrice: t.nativePrice ?? null,
        nativeFee: t.nativeFee ?? null,
        note: t.note ?? null,
      })),
    });
  }
  return NextResponse.json({
    id: created.id,
    name,
    restored: portfolio.transactions.length,
  });
}

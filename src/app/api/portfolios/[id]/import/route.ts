import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseDeltaCsv } from "@/lib/delta-csv";

export const dynamic = "force-dynamic";

const Body = z.object({ csv: z.string().min(1).max(5_000_000) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const portfolio = await prisma.portfolio.findUnique({ where: { id } });
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { rows, skipped, warnings } = parseDeltaCsv(body.data.csv);
  if (rows.length > 0) {
    await prisma.transaction.createMany({
      data: rows.map((r) => ({
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
  return NextResponse.json({ imported: rows.length, skipped, warnings });
}

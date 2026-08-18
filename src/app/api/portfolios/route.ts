import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().min(1).max(100),
});

export async function GET() {
  const portfolios = await prisma.portfolio.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { transactions: true } } },
  });
  return NextResponse.json({
    portfolios: portfolios.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      transactionCount: p._count.transactions,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = Create.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const created = await prisma.portfolio.create({ data: { name: body.data.name } });
  return NextResponse.json({ portfolio: created });
}

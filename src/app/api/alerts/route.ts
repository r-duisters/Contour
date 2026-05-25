import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const Create = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function GET() {
  const alerts = await prisma.alert.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    alerts: alerts.map((a) => ({
      ...a,
      lastBarTime: a.lastBarTime ? Number(a.lastBarTime) : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = Create.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const created = await prisma.alert.create({
    data: {
      symbol: body.data.symbol.toUpperCase(),
      timeframe: body.data.timeframe,
      params: JSON.stringify(body.data.params ?? {}),
      enabled: body.data.enabled ?? true,
    },
  });
  return NextResponse.json({ alert: created });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  PctMoveParams, PortfolioMoveParams, PositionPnlParams, PriceTargetParams,
} from "@/lib/alerts";

export const dynamic = "force-dynamic";

const Create = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("indicator"),
    symbol: z.string().min(1),
    timeframe: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    repeat: z.boolean().optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("price_target"),
    symbol: z.string().min(1),
    // Recorded, not sniffed: a US ticker carries no exchange suffix, so
    // guessing from its shape sends AMD to Binance as AMDUSDT.
    assetType: z.enum(["crypto", "equity"]).default("crypto"),
    params: PriceTargetParams,
    repeat: z.boolean().optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("pct_move"),
    symbol: z.string().min(1).optional(),
    assetType: z.enum(["crypto", "equity"]).default("crypto"),
    portfolioId: z.string().min(1).optional(),
    params: PctMoveParams,
    repeat: z.boolean().optional(),
    enabled: z.boolean().optional(),
  }).refine((v) => !!v.symbol !== !!v.portfolioId, {
    message: "pct_move needs exactly one of symbol or portfolioId",
  }),
  /*
   * No `symbol` branch at all, unlike `pct_move`.
   *
   * A portfolio move on one asset is a percentage move with extra steps, and
   * offering it would mean two ways to write the same rule that then behave
   * differently at evaluation — one expanded per holding, one totalled. The
   * portfolio is the subject or there is no rule.
   */
  /*
   * The symbol is optional and means "this holding" rather than "every
   * holding" — the same shape `pct_move` has, and for the same reason. What is
   * *not* optional is the portfolio: a return needs a cost, the cost comes
   * from the ledger, and the ledger is a portfolio.
   */
  z.object({
    kind: z.literal("position_pnl"),
    symbol: z.string().min(1).optional(),
    assetType: z.enum(["crypto", "equity"]).default("crypto"),
    portfolioId: z.string().min(1),
    params: PositionPnlParams,
    repeat: z.boolean().optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("portfolio_move"),
    portfolioId: z.string().min(1),
    params: PortfolioMoveParams,
    repeat: z.boolean().optional(),
    enabled: z.boolean().optional(),
  }),
]);

export async function GET() {
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: "desc" },
    include: { portfolio: { select: { name: true } } },
  });
  return NextResponse.json({
    alerts: alerts.map((a) => ({
      ...a,
      params: JSON.parse(a.params),
      portfolioName: a.portfolio?.name ?? null,
      portfolio: undefined,
      lastBarTime: a.lastBarTime ? Number(a.lastBarTime) : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const json = (await req.json()) as { kind?: string };
  const body = Create.safeParse({ ...json, kind: json.kind ?? "indicator" });
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const d = body.data;
  const created = await prisma.alert.create({
    data: {
      kind: d.kind,
      symbol: "symbol" in d && d.symbol ? d.symbol.toUpperCase() : null,
      // Portfolio-scoped rules read the kind per holding, so theirs is unused.
      assetType: "assetType" in d ? d.assetType : "crypto",
      portfolioId: d.kind === "pct_move" ? (d.portfolioId ?? null) : null,
      timeframe: d.kind === "indicator" ? d.timeframe : "1d",
      params: JSON.stringify(d.params ?? {}),
      // Per kind, and each default is what that kind used to do
      // unconditionally: a target fires once and disarms, a move rule stands.
      repeat: d.repeat ?? (d.kind === "pct_move"),
      enabled: d.enabled ?? true,
    },
  });
  return NextResponse.json({ alert: created });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deps } from "@/lib/deps";
import { NotFoundError } from "@/data/errors";
import { clearPortfolio, importDelta } from "@/data/services/transfer";

export const dynamic = "force-dynamic";

const Body = z.object({
  csv: z.string().min(1).max(5_000_000),
  /** Parse, price and audit, but write nothing. */
  dryRun: z.boolean().optional(),
  /** Which reader to use; the service detects it when this is absent. */
  format: z.enum(["delta", "binance", "coinbase", "kraken", "trading212", "degiro", "generic"])
    .optional(),
  /** Required by `generic`, which is a person naming the columns themselves. */
  mapping: z.object({
    time: z.string().min(1),
    side: z.string().min(1),
    symbol: z.string().min(1),
    quantity: z.string().min(1),
    price: z.string().optional(),
    fee: z.string().optional(),
    currency: z.string().optional(),
  }).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const { store, net } = deps();
  try {
    return NextResponse.json(
      await importDelta(store, net, id, body.data.csv, {
        dryRun: body.data.dryRun,
        format: body.data.format,
        mapping: body.data.mapping,
      }),
    );
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
}

/** Remove everything a Delta import added to this portfolio. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { store } = deps();
  return NextResponse.json({ deleted: await clearPortfolio(store, id) });
}

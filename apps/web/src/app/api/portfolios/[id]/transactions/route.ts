import { NextRequest, NextResponse } from "next/server";
import { deps } from "@/lib/deps";
import { NotFoundError } from "@/data/errors";
import { addTransaction } from "@/data/services/transactions";
import { serializeTx, TxInput } from "../../tx";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = TxInput.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const { store, net } = deps();
  try {
    const created = await addTransaction(store, net, id, {
      symbol: body.data.symbol.toUpperCase(),
      // Still the column default: cash and income arrive with a later plan.
      assetType: "crypto",
      side: body.data.side,
      quantity: body.data.quantity,
      price: body.data.price,
      fee: body.data.fee,
      time: body.data.time,
      nativeCurrency: body.data.nativeCurrency?.toUpperCase() ?? null,
      nativePrice: body.data.nativePrice ?? null,
      nativeFee: body.data.nativeFee ?? null,
      note: body.data.note ?? null,
    });
    return NextResponse.json({ transaction: serializeTx(created) });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
}

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

  const { store } = deps();
  try {
    const created = await addTransaction(store, id, {
      symbol: body.data.symbol.toUpperCase(),
      // Not in `TxInput`: the route never accepted these, so a manual create
      // relied on the column defaults ("crypto", null) that these reproduce.
      assetType: "crypto",
      side: body.data.side,
      quantity: body.data.quantity,
      price: body.data.price,
      fee: body.data.fee,
      time: body.data.time,
      nativeCurrency: null,
      nativePrice: null,
      nativeFee: null,
      note: body.data.note ?? null,
    });
    return NextResponse.json({ transaction: serializeTx(created) });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
}

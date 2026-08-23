import { NextResponse } from "next/server";
import { deps } from "@/lib/deps";
import { symbols } from "@/data/services/lookup";

export const dynamic = "force-dynamic";

// The stale-if-error fallback (serve the last successful list when Binance is
// down) and the one-hour freshness cache both now live in the service layer
// — see `packages/data/src/services/lookup.ts`'s comment on `symbols` — so a
// 502 here only ever means "Binance failed and we have never once succeeded".
export async function GET() {
  const { net } = deps();
  try {
    return NextResponse.json({ symbols: await symbols(net) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

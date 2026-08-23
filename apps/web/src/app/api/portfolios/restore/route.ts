import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deps } from "@/lib/deps";
import { InvalidBackupError, restore } from "@/data/services/transfer";

export const dynamic = "force-dynamic";

const Body = z.object({ backup: z.string().min(1).max(20_000_000) });

/**
 * Restore a backup into a NEW portfolio. Never overwrites an existing one:
 * a restore that silently replaced live data would be unrecoverable.
 */
export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const { store } = deps();
  try {
    const { portfolio, restored } = await restore(store, body.data.backup);
    return NextResponse.json({ id: portfolio.id, name: portfolio.name, restored });
  } catch (err) {
    if (err instanceof InvalidBackupError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

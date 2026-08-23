import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deps } from "@/lib/deps";
import { NotFoundError } from "@/data/errors";
import { exportCsv, exportJson, type ExportFile } from "@/data/services/transfer";

export const dynamic = "force-dynamic";

const Query = z.object({ format: z.enum(["json", "csv", "ghostfolio"]).default("json") });

/** Download the portfolio as a restorable backup or as a spreadsheet. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Query.safeParse({ format: req.nextUrl.searchParams.get("format") ?? "json" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { format } = parsed.data;

  const { store, net } = deps();
  let file: ExportFile;
  try {
    file = format === "json"
      ? await exportJson(store, id)
      : await exportCsv(store, net, id, format);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }

  return new NextResponse(file.body, {
    headers: {
      "Content-Type": format === "json" ? "application/json" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
    },
  });
}

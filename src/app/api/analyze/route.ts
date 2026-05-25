import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzePineScript, summarize } from "@/lib/pinescript/analyze";
import { applyImprovements } from "@/lib/pinescript/apply";

export const dynamic = "force-dynamic";

const AnalyzeBody = z.object({
  source: z.string().min(1).max(200_000),
  apply: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const body = AnalyzeBody.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  let source = body.data.source;
  let applied: string[] = [];
  let skipped: { id: string; reason: string }[] = [];

  if (body.data.apply && body.data.apply.length > 0) {
    const r = applyImprovements(source, body.data.apply);
    source = r.source;
    applied = r.applied;
    skipped = r.skipped;
  }

  const findings = analyzePineScript(source);
  return NextResponse.json({
    source,
    findings,
    summary: summarize(findings),
    applied,
    skipped,
  });
}

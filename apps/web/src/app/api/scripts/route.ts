import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listScripts, saveScript, suggestDerivedName } from "@/lib/pinescript/library";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ scripts: await listScripts() });
}

const Body = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]+\.pine$/).optional(),
  derivedFrom: z.string().regex(/^[A-Za-z0-9._-]+\.pine$/).optional(),
  suffix: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  source: z.string().min(1).max(200_000),
});

export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { name, derivedFrom, suffix, source } = body.data;
  let target = name;
  if (!target) {
    if (!derivedFrom) return NextResponse.json({ error: "name or derivedFrom required" }, { status: 400 });
    target = await suggestDerivedName(derivedFrom, suffix ?? "fixes");
  }
  await saveScript(target, source);
  return NextResponse.json({ name: target });
}

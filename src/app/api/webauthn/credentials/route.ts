import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const creds = await prisma.webAuthnCredential.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({
    credentials: creds.map((c) => ({ id: c.id, label: c.label, createdAt: c.createdAt })),
  });
}

const Delete = z.object({ id: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const body = Delete.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  await prisma.webAuthnCredential.deleteMany({ where: { id: body.data.id } });
  return NextResponse.json({ ok: true });
}

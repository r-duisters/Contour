import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { consumeChallenge, relyingParty } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

const Body = z.object({
  response: z.unknown(),
  label: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { rpID, origin } = relyingParty(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.data.response as RegistrationResponseJSON,
      expectedChallenge: (c) => consumeChallenge(c),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  const cred = verification.registrationInfo.credential;
  await prisma.webAuthnCredential.upsert({
    where: { id: cred.id },
    update: {},
    create: {
      id: cred.id,
      publicKey: Buffer.from(cred.publicKey),
      counter: BigInt(cred.counter),
      transports: cred.transports ? JSON.stringify(cred.transports) : null,
      label: body.data.label ?? null,
    },
  });
  return NextResponse.json({ ok: true });
}

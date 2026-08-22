import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { relyingParty, rememberChallenge } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { rpID } = relyingParty(req);
  const creds = await prisma.webAuthnCredential.findMany();
  if (creds.length === 0) {
    return NextResponse.json({ error: "no passkeys registered" }, { status: 404 });
  }
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[]) : undefined,
    })),
  });
  rememberChallenge(options.challenge);
  return NextResponse.json(options);
}

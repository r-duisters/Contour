import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { relyingParty, rememberChallenge } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { rpID } = relyingParty(req);
  const existing = await prisma.webAuthnCredential.findMany();
  const options = await generateRegistrationOptions({
    rpName: "Contour",
    rpID,
    userName: "owner",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[]) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  rememberChallenge(options.challenge);
  return NextResponse.json(options);
}

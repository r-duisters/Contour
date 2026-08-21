import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { consumeChallenge, relyingParty } from "@/lib/webauthn";
import {
  createSessionToken, isSecureRequest, SESSION_COOKIE, sessionCookieOptions,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ response: z.unknown() });

export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const response = body.data.response as AuthenticationResponseJSON;

  const cred = await prisma.webAuthnCredential.findUnique({ where: { id: response.id } });
  if (!cred) return NextResponse.json({ error: "unknown credential" }, { status: 401 });

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (c) => consumeChallenge(c),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(cred.publicKey),
        counter: Number(cred.counter),
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  if (!verification.verified) return NextResponse.json({ error: "verification failed" }, { status: 401 });

  await prisma.webAuthnCredential.update({
    where: { id: cred.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter) },
  });

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "SESSION_SECRET not configured" }, { status: 500 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(secret), sessionCookieOptions(isSecureRequest(req)));
  return res;
}

import type { NextRequest } from "next/server";

/**
 * Single-use registration/login challenges, kept in memory with a short TTL.
 * Single-user app: a handful of outstanding challenges at most. Resets on
 * restart, which just means an in-flight prompt has to be retried.
 */
const issued = new Map<string, number>(); // challenge -> expiry ms
const CHALLENGE_TTL_MS = 5 * 60_000;

export function rememberChallenge(challenge: string): void {
  const now = Date.now();
  for (const [c, exp] of issued) if (exp < now) issued.delete(c);
  issued.set(challenge, now + CHALLENGE_TTL_MS);
}

/** True exactly once per issued, unexpired challenge. */
export function consumeChallenge(challenge: string): boolean {
  const exp = issued.get(challenge);
  issued.delete(challenge);
  return exp !== undefined && exp >= Date.now();
}

/** rpID is the effective domain; origin must match what the browser sends. */
export function relyingParty(req: NextRequest): { rpID: string; origin: string } {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return { rpID: host.split(":")[0]!, origin: `${proto}://${host}` };
}

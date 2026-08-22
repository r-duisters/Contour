import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "trader_session";
export const SESSION_TTL_S = 2_592_000; // 30 days

const PUBLIC_EXACT = new Set([
  "/login", "/setup", "/api/login", "/api/setup",
  "/api/cron/evaluate", // guarded by its own bearer token
  "/api/webauthn/login/options", "/api/webauthn/login/verify", // passkey login (challenge + signature verified in-route)
  "/manifest.webmanifest", "/sw.js", "/favicon.ico",
]);
const PUBLIC_PREFIXES = ["/_next/", "/icons/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function createSessionToken(secret: string): Promise<string> {
  return new SignJWT({ u: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<{ iat: number } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return { iat: payload.iat ?? 0 };
  } catch {
    return null;
  }
}

/**
 * `secure` follows the request, not the build. A production server reached
 * over plain http on a LAN would otherwise set a Secure cookie that browsers
 * refuse to store, locking the user out of their own app.
 */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true as const,
    secure,
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: SESSION_TTL_S,
  };
}

/** True when the browser reached us over https, directly or via a proxy. */
export function isSecureRequest(req: {
  headers: { get(name: string): string | null };
  nextUrl: { protocol: string };
}): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  return req.nextUrl.protocol === "https:";
}

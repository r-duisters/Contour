import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "trader_session";
export const SESSION_TTL_S = 2_592_000; // 30 days

const PUBLIC_EXACT = new Set([
  "/login", "/setup", "/api/login", "/api/setup",
  "/api/cron/evaluate", // guarded by its own bearer token
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

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: SESSION_TTL_S,
  };
}

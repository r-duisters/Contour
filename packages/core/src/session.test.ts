import { describe, expect, it } from "vitest";
import {
  createSessionToken, isPublicPath, isSecureRequest, sessionCookieOptions, verifySessionToken,
} from "./session";

const SECRET = "test-secret-at-least-32-chars-long!!";

describe("session tokens", () => {
  it("round-trips a valid token", async () => {
    const token = await createSessionToken(SECRET);
    const payload = await verifySessionToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(typeof payload!.iat).toBe("number");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, "other-secret-that-is-wrong-here")).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySessionToken("not.a.jwt", SECRET)).toBeNull();
  });
});

describe("isPublicPath", () => {
  it("allows auth pages, PWA assets, and the cron route", () => {
    for (const p of [
      "/login", "/setup", "/api/login", "/api/setup", "/api/cron/evaluate",
      "/api/webauthn/login/options", "/api/webauthn/login/verify",
      "/manifest.webmanifest", "/sw.js", "/favicon.ico",
      "/_next/static/x.js", "/icons/icon-192.png",
    ]) expect(isPublicPath(p)).toBe(true);
  });

  it("guards everything else", () => {
    for (const p of ["/", "/portfolio", "/api/portfolios", "/api/alerts", "/settings",
      "/api/webauthn/register/options", "/api/webauthn/register/verify", "/api/webauthn/credentials"])
      expect(isPublicPath(p)).toBe(false);
  });
});

describe("sessionCookieOptions", () => {
  it("is httpOnly, lax, path=/", () => {
    const o = sessionCookieOptions(true);
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.path).toBe("/");
    expect(o.maxAge).toBeGreaterThan(0);
  });

  it("marks the cookie Secure only when asked", () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
    // A Secure cookie is silently dropped over plain http, which would lock
    // the owner out of a LAN-hosted server.
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});

describe("isSecureRequest", () => {
  const req = (proto: string | null, url: string) => ({
    headers: { get: () => proto },
    nextUrl: { protocol: url },
  });

  it("trusts the proxy's x-forwarded-proto first", () => {
    expect(isSecureRequest(req("https", "http:"))).toBe(true);
    expect(isSecureRequest(req("http", "https:"))).toBe(false);
  });

  it("reads the first hop of a chained x-forwarded-proto", () => {
    expect(isSecureRequest(req("https, http", "http:"))).toBe(true);
  });

  it("falls back to the request protocol with no proxy header", () => {
    expect(isSecureRequest(req(null, "https:"))).toBe(true);
    expect(isSecureRequest(req(null, "http:"))).toBe(false);
  });
});

import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken, isPublicPath, SESSION_COOKIE, sessionCookieOptions, verifySessionToken,
} from "@/lib/session";

const REFRESH_AFTER_S = 7 * 24 * 3600;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const payload = secret && token ? await verifySessionToken(token, secret) : null;

  if (payload) {
    const res = NextResponse.next();
    if (Date.now() / 1000 - payload.iat > REFRESH_AFTER_S) {
      res.cookies.set(SESSION_COOKIE, await createSessionToken(secret!), sessionCookieOptions());
    }
    return res;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

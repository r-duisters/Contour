import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const COIN_CDN = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color";
const STOCK_LOGOS = "https://assets.parqet.com/logos/symbol";
const CACHE_DIR = path.join(process.cwd(), ".icon-cache");
const MISS_TTL_MS = 7 * 86_400_000;

const Query = z.object({
  // Tickers only: this string becomes part of an outbound URL.
  symbol: z.string().min(1).max(30).regex(/^[A-Za-z0-9._-]+$/),
  type: z.enum(["crypto", "equity"]).default("crypto"),
});

/**
 * Serves asset icons from a local cache, fetching from upstream once.
 *
 * Three reasons this is not left to the browser: the logo service allows only
 * a day of caching, so phones refetched constantly; every fetch told a third
 * party which assets are held; and on a LAN with no internet the icons simply
 * vanished. Cached files are served with a long max-age, so the phone stops
 * asking too.
 */
export async function GET(req: NextRequest) {
  const parsed = Query.safeParse({
    symbol: req.nextUrl.searchParams.get("symbol") ?? "",
    type: req.nextUrl.searchParams.get("type") ?? "crypto",
  });
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const { symbol, type } = parsed.data;

  const upstream = type === "equity"
    ? `${STOCK_LOGOS}/${encodeURIComponent(symbol.toUpperCase())}`
    : `${COIN_CDN}/${symbol.toLowerCase()}.svg`;

  const key = createHash("sha1").update(`${type}:${symbol.toUpperCase()}`).digest("hex");
  const file = path.join(CACHE_DIR, `${key}.svg`);
  const missFile = path.join(CACHE_DIR, `${key}.miss`);

  const cached = await readFile(file).catch(() => null);
  if (cached) return svg(cached);

  // Remember misses for a while: a ticker with no logo today rarely has one
  // tomorrow, and asking on every render is the behaviour being fixed.
  const miss = await readFile(missFile, "utf8").catch(() => null);
  if (miss && Date.now() - Number(miss) < MISS_TTL_MS) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const res = await fetch(upstream, { headers: { Accept: "image/svg+xml,image/*" } });
    await mkdir(CACHE_DIR, { recursive: true });
    if (!res.ok) {
      await writeFile(missFile, String(Date.now()));
      return new NextResponse(null, { status: 404 });
    }
    const body = Buffer.from(await res.arrayBuffer());
    await writeFile(file, body);
    return svg(body);
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}

function svg(body: Buffer) {
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/svg+xml",
      // Served from our own disk now, so the browser need not ask again soon.
      "Cache-Control": "public, max-age=2592000, immutable",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fromRepoRoot } from "@/lib/repo-root";

export const dynamic = "force-dynamic";

const COIN_CDN = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color";
const STOCK_LOGOS = "https://assets.parqet.com/logos/symbol";
const GECKO = "https://api.coingecko.com/api/v3/coins/markets";
// Repository-level so the already-warmed cache survives the app's move into
// apps/web, and so a second app can share it later.
const CACHE_DIR = fromRepoRoot(".icon-cache");
const MISS_TTL_MS = 7 * 86_400_000;

const Query = z.object({
  // Tickers only: this string becomes part of an outbound URL.
  symbol: z.string().min(1).max(30).regex(/^[A-Za-z0-9._-]+$/),
  type: z.enum(["crypto", "equity"]).default("crypto"),
});

/**
 * A coin's logo, from the source that is still being updated.
 *
 * `spothq/cryptocurrency-icons` last shipped a commit on 2022-08-22, so every
 * coin listed since is a 404 — SHIB, PEPE, NEAR, ARB, OP, SUI among them. It
 * stays as the fallback, because it still has older coins outside CoinGecko's
 * top 500, but it can no longer be the only answer.
 *
 * The ranking is one request for 250 coins and is already what the markets
 * board reads, so this adds no upstream the app did not have. Held for an hour
 * in the process, which is the same window `fetchTopByMarketCap` uses; the
 * icons themselves are cached on disk for far longer by the route below, so
 * this list is consulted once per coin and not once per render.
 *
 * `scripts/bundle-icons.mjs` resolves logos the same way and in the same
 * order. Change one, change the other, or the two builds show different logos
 * for the same coin.
 */
let geckoAt = 0;
let geckoBySymbol: Map<string, string> | null = null;

async function geckoLogo(symbol: string): Promise<string | null> {
  if (!geckoBySymbol || Date.now() - geckoAt > 3_600_000) {
    const next = new Map<string, string>();
    try {
      const res = await fetch(
        `${GECKO}?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`,
        { headers: { "User-Agent": "Contour/1.0 (+self-hosted portfolio tracker)" } },
      );
      if (res.ok) {
        for (const row of (await res.json()) as { symbol?: string; image?: string }[]) {
          // The higher cap wins a shared ticker, which is the order the list
          // already arrives in.
          if (row.symbol && row.image && !next.has(row.symbol.toUpperCase())) {
            next.set(row.symbol.toUpperCase(), row.image);
          }
        }
      }
    } catch {
      // Unreachable: fall through to the CDN below rather than failing the icon.
    }
    // Kept even when empty, so a rate-limited minute does not become a request
    // per icon for the next hour.
    geckoBySymbol = next;
    geckoAt = Date.now();
  }
  return geckoBySymbol.get(symbol.toUpperCase()) ?? null;
}

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
    : (await geckoLogo(symbol)) ?? `${COIN_CDN}/${symbol.toLowerCase()}.svg`;

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

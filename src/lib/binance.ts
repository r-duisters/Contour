import WebSocket from "ws";
import type { Bar, Timeframe } from "./types";

const REST = "https://api.binance.com";
const WS_BASE = "wss://stream.binance.com:9443/ws";

type RawKline = [
  number, string, string, string, string, string,
  number, string, number, string, string, string,
];

function toBar(k: RawKline): Bar {
  return {
    t: k[0],
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  };
}

export async function fetchKlines(opts: {
  symbol: string;
  interval: Timeframe;
  startTime?: number;
  endTime?: number;
  limit?: number; // max 1000
}): Promise<Bar[]> {
  const params = new URLSearchParams({
    symbol: opts.symbol.toUpperCase(),
    interval: opts.interval,
    limit: String(opts.limit ?? 1000),
  });
  if (opts.startTime) params.set("startTime", String(opts.startTime));
  if (opts.endTime) params.set("endTime", String(opts.endTime));

  const res = await fetch(`${REST}/api/v3/klines?${params}`);
  if (!res.ok) throw new Error(`Binance klines ${res.status}: ${await res.text()}`);
  const raw = (await res.json()) as RawKline[];
  return raw.map(toBar);
}

/** Paginated fetch covering [from, to] in ms. */
export async function fetchKlinesRange(opts: {
  symbol: string;
  interval: Timeframe;
  from: number;
  to: number;
}): Promise<Bar[]> {
  const out: Bar[] = [];
  let cursor = opts.from;
  while (cursor < opts.to) {
    const batch = await fetchKlines({
      symbol: opts.symbol,
      interval: opts.interval,
      startTime: cursor,
      endTime: opts.to,
      limit: 1000,
    });
    if (batch.length === 0) break;
    out.push(...batch);
    const last = batch[batch.length - 1]!.t;
    if (batch.length < 1000) break;
    cursor = last + 1;
  }
  return out;
}

/** Current spot prices for the given symbols, as symbol -> price. Unknown symbols are omitted. */
export async function fetchPrices(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const params = new URLSearchParams({
    symbols: JSON.stringify(symbols.map((s) => s.toUpperCase())),
  });
  const res = await fetch(`${REST}/api/v3/ticker/price?${params}`);
  if (!res.ok) throw new Error(`Binance ticker ${res.status}: ${await res.text()}`);
  const raw = (await res.json()) as { symbol: string; price: string }[];
  return Object.fromEntries(raw.map((r) => [r.symbol, Number(r.price)]));
}

/** All actively trading spot symbols quoted in USDT, sorted alphabetically. */
export async function fetchUsdtSymbols(): Promise<string[]> {
  const res = await fetch(`${REST}/api/v3/exchangeInfo`);
  if (!res.ok) throw new Error(`Binance exchangeInfo ${res.status}: ${await res.text()}`);
  const raw = (await res.json()) as {
    symbols: { symbol: string; status: string; quoteAsset: string; isSpotTradingAllowed: boolean }[];
  };
  return raw.symbols
    .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT" && s.isSpotTradingAllowed)
    .map((s) => s.symbol)
    .sort();
}

/** Like fetchPrices, but tolerant: one bad symbol 400s the whole batch, so fall back to per-symbol lookups. */
export async function fetchPricesSafe(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  try {
    return await fetchPrices(symbols);
  } catch {
    const out: Record<string, number> = {};
    const results = await Promise.allSettled(symbols.map((s) => fetchPrices([s])));
    for (const r of results) {
      if (r.status === "fulfilled") Object.assign(out, r.value);
    }
    return out;
  }
}

type StreamKline = {
  e: "kline";
  E: number;
  s: string;
  k: {
    t: number; T: number; s: string; i: string;
    o: string; c: string; h: string; l: string; v: string;
    x: boolean; // is this kline closed?
  };
};

export type KlineUpdate = { bar: Bar; closed: boolean };

export function subscribeKlines(
  symbol: string,
  interval: Timeframe,
  onUpdate: (u: KlineUpdate) => void,
): () => void {
  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  const ws = new WebSocket(`${WS_BASE}/${stream}`);
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString()) as StreamKline;
      const k = msg.k;
      onUpdate({
        bar: {
          t: k.t,
          o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c),
          v: Number(k.v),
        },
        closed: k.x,
      });
    } catch {
      // ignore malformed frames
    }
  });
  return () => ws.close();
}

# Markets Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Chart tab with a Markets page showing crypto and stock movers and the largest by market cap, and make the sparkline on a crypto holding open the detailed chart.

**Architecture:** Transport goes in `packages/data/src/sources`, shaping in a `markets` service over the injected `Net`, a thin route wrapper, a `getMarkets` method on `DataClient`, and a screen that names none of it. The chart page gains a URL parameter and suppresses its signal markers off Bitcoin.

**Tech Stack:** Next 16 App Router, React 19, TypeScript, Tailwind v4, Vitest, the existing `cached()` memoiser.

**Spec:** `docs/superpowers/specs/2026-08-24-markets-tab-design.md`

## Global Constraints

- `packages/core` and `packages/data` must not import Prisma, `node:*`, `next/*`, or call global `fetch`. Transport goes through the injected `Net`. `packages/core/src/boundary.test.ts` enforces this.
- Services take their outside world as arguments. No `@/lib/*` in `packages/data` — use `@/core/*`.
- The Markets screen must go through `DataClient`. It gets **no** entry in `apps/web/src/screen-boundary.test.ts`.
- No new copy of a shared unit. `Button`, `field()`, `EmptyState`, `SubHeading`, `PageLabel`, `CoinIcon`, `StatTile` already exist and `packages/ui/src/shared-units.test.ts` fails the build on a re-typed class string.
- Cache TTLs are exactly: Binance ticker `60_000`, CoinGecko markets `900_000`, Yahoo screeners `300_000` when the US market is open and `3_600_000` when closed.
- Market figures do **not** obey privacy mode.
- `run(bars)` in `packages/core/src/indicator/index.ts` is not modified. BTC output must not change.
- Sentence case for headings and buttons. Icons `size={14}` in buttons, `size={20}` in lists.

---

### Task 1: Market data sources

**Files:**
- Modify: `packages/data/src/sources/binance.ts`
- Create: `packages/data/src/sources/markets.ts`
- Test: `packages/data/src/sources/markets.test.ts`

**Interfaces:**
- Consumes: `Net` from `packages/data/src/ports/net.ts`, `cached` from `@/core/cache`.
- Produces:
  - `fetch24hTicker(net: Net): Promise<Ticker[]>` where `Ticker = { symbol: string; lastPrice: number; priceChangePercent: number; quoteVolume: number }`
  - `fetchTopByMarketCap(net: Net, limit: number): Promise<CoinRow[]>` where `CoinRow = { symbol: string; name: string; price: number; changePct: number; marketCap: number }`
  - `fetchScreener(net: Net, id: "day_gainers" | "day_losers" | "most_actives", count: number): Promise<EquityRow[]>` where `EquityRow = { symbol: string; name: string; price: number; changePct: number; marketCap: number | null }`
  - `usMarketOpen(now: number): boolean`

- [ ] **Step 1: Write the failing test for the market-hours helper**

```ts
import { describe, expect, it } from "vitest";
import { usMarketOpen } from "./markets";

const at = (iso: string) => Date.parse(iso);

describe("usMarketOpen", () => {
  it("is open inside the New York session on a weekday", () => {
    expect(usMarketOpen(at("2026-08-24T14:00:00Z"))).toBe(true); // 10:00 ET Monday
  });
  it("is closed before the open and after the close", () => {
    expect(usMarketOpen(at("2026-08-24T12:00:00Z"))).toBe(false);
    expect(usMarketOpen(at("2026-08-24T21:00:00Z"))).toBe(false);
  });
  it("is closed at the weekend", () => {
    expect(usMarketOpen(at("2026-08-22T14:00:00Z"))).toBe(false); // Saturday
    expect(usMarketOpen(at("2026-08-23T14:00:00Z"))).toBe(false); // Sunday
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/data/src/sources/markets.test.ts`
Expected: FAIL, `usMarketOpen` is not exported.

- [ ] **Step 3: Implement the helper**

Use UTC arithmetic, not a timezone library — the app has no date dependency and does not need one.

```ts
/**
 * Whether the US equity market is open, to the nearest hour that matters.
 *
 * 09:30–16:00 New York, Monday to Friday. Deliberately ignores public
 * holidays: the only cost of missing one is a handful of refreshes on a day
 * the figures do not move, and a holiday calendar is a dependency and a
 * maintenance burden for that.
 *
 * DST is handled by taking the offset from the date itself rather than
 * assuming one: New York is UTC-4 from the second Sunday in March to the
 * first Sunday in November, and UTC-5 otherwise.
 */
export function usMarketOpen(now: number): boolean {
  const d = new Date(now);
  const offset = nyOffsetHours(d);
  const ny = new Date(now + offset * 3_600_000);
  const day = ny.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ny.getUTCHours() * 60 + ny.getUTCMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function nyOffsetHours(d: Date): number {
  const y = d.getUTCFullYear();
  const march = new Date(Date.UTC(y, 2, 1));
  const dstStart = Date.UTC(y, 2, 8 + ((7 - march.getUTCDay()) % 7), 7);
  const nov = new Date(Date.UTC(y, 10, 1));
  const dstEnd = Date.UTC(y, 10, 1 + ((7 - nov.getUTCDay()) % 7), 6);
  const t = d.getTime();
  return t >= dstStart && t < dstEnd ? -4 : -5;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run packages/data/src/sources/markets.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing tests for the three fetchers**

```ts
import { FakeNet } from "../testing/fake-net";
import { fetchTopByMarketCap, fetchScreener } from "./markets";
import { fetch24hTicker } from "./binance";

describe("fetchTopByMarketCap", () => {
  it("maps CoinGecko rows and keeps the order it was given", async () => {
    const net = FakeNet({
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=2&page=1":
        [{ symbol: "btc", name: "Bitcoin", current_price: 65000, price_change_percentage_24h: 1.2, market_cap: 1.2e12 },
         { symbol: "eth", name: "Ethereum", current_price: 3200, price_change_percentage_24h: -0.4, market_cap: 3.8e11 }],
    });
    expect(await fetchTopByMarketCap(net, 2)).toEqual([
      { symbol: "BTC", name: "Bitcoin", price: 65000, changePct: 1.2, marketCap: 1.2e12 },
      { symbol: "ETH", name: "Ethereum", price: 3200, changePct: -0.4, marketCap: 3.8e11 },
    ]);
  });
});

describe("fetchScreener", () => {
  it("unwraps Yahoo's raw/fmt envelope", async () => {
    const net = FakeNet({
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=1":
        { finance: { result: [{ quotes: [{ symbol: "HOOD", shortName: "Robinhood",
            regularMarketPrice: 42.5, regularMarketChangePercent: 13.7, marketCap: 3.7e10 }] }] } },
    });
    expect(await fetchScreener(net, "day_gainers", 1)).toEqual([
      { symbol: "HOOD", name: "Robinhood", price: 42.5, changePct: 13.7, marketCap: 3.7e10 },
    ]);
  });

  it("answers an empty list rather than throwing when Yahoo returns no result", async () => {
    const net = FakeNet({
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers&count=1":
        { finance: { result: null, error: { code: "Unauthorized" } } },
    });
    expect(await fetchScreener(net, "day_losers", 1)).toEqual([]);
  });
});

describe("fetch24hTicker", () => {
  it("coerces Binance's string numbers", async () => {
    const net = FakeNet({
      "https://api.binance.com/api/v3/ticker/24hr":
        [{ symbol: "BTCUSDT", lastPrice: "65000.10", priceChangePercent: "1.20", quoteVolume: "9e8" }],
    });
    expect(await fetch24hTicker(net)).toEqual([
      { symbol: "BTCUSDT", lastPrice: 65000.10, priceChangePercent: 1.2, quoteVolume: 9e8 },
    ]);
  });
});
```

`FakeNet` is a factory function taking `Record<string, unknown>` of url to
response body — `packages/data/src/testing/fake-net.ts`. It is not a class; do
not call it with `new`.

- [ ] **Step 6: Run and watch them fail**

Run: `npx vitest run packages/data/src/sources/markets.test.ts`
Expected: FAIL, the three functions are not defined.

- [ ] **Step 7: Implement the fetchers**

Every one is wrapped in `cached()` with the TTL from Global Constraints. Yahoo's TTL is chosen per call: `usMarketOpen(Date.now()) ? 300_000 : 3_600_000`. Include the TTL bucket in the cache key the way `binance.ts` already does, so a key cannot outlive its window.

A screener that comes back without `finance.result[0].quotes` returns `[]`. It is an undocumented endpoint that answers 401 when it feels like it, and a Markets page missing one column is better than a Markets page that throws.

- [ ] **Step 8: Run and watch them pass**

Run: `npx vitest run packages/data/src/sources/markets.test.ts`

- [ ] **Step 9: Confirm the portability guard still passes**

Run: `npx vitest run packages/core/src/boundary.test.ts`
Expected: PASS. If it fails naming a global `fetch`, the fetcher is not going through `Net`.

- [ ] **Step 10: Commit**

```bash
git add packages/data/src/sources
git commit -m "Add the market-data fetchers behind Net"
```

---

### Task 2: The markets service

**Files:**
- Create: `packages/data/src/services/markets.ts`
- Test: `packages/data/src/services/markets.test.ts`

**Interfaces:**
- Consumes: Task 1's four exports.
- Produces:
  - `type MarketRow = { symbol: string; name?: string; price: number; changePct: number; marketCap?: number; assetType: "crypto" | "equity" }`
  - `type MarketBoard = { up: MarketRow[]; down: MarketRow[]; largest: MarketRow[]; source: string; at: number }`
  - `getMarkets(net: Net, category: "crypto" | "stocks"): Promise<MarketBoard>`

- [ ] **Step 1: Write the failing tests**

These encode the two findings from the spec, and are the reason this task exists as its own unit.

```ts
import { describe, expect, it } from "vitest";
import { getMarkets } from "./markets";

const ticker = (rows: [string, number, number, number][]) =>
  rows.map(([symbol, lastPrice, priceChangePercent, quoteVolume]) =>
    ({ symbol, lastPrice, priceChangePercent, quoteVolume }));

describe("getMarkets crypto", () => {
  it("puts only genuine fallers in `down`", async () => {
    // Everything liquid is up today. A "top losers" column showing gains is
    // a lie; an empty column is not.
    const net = fakeNetWith(ticker([
      ["BTCUSDT", 65000, 1.1, 9e8], ["ETHUSDT", 3200, 0.7, 5e8], ["XRPUSDT", 2, 0.2, 8e7],
    ]));
    const board = await getMarkets(net, "crypto");
    expect(board.down).toEqual([]);
    expect(board.up.length).toBeGreaterThan(0);
  });

  it("excludes pegged coins from both columns", async () => {
    const net = fakeNetWith(ticker([
      ["USDCUSDT", 1, -0.01, 9e8], ["EURIUSDT", 1.08, -1.0, 9e8],
      ["FDUSDUSDT", 1, 0.0, 9e8], ["ADAUSDT", 0.9, -4.2, 9e8],
    ]));
    const board = await getMarkets(net, "crypto");
    expect(board.down.map((r) => r.symbol)).toEqual(["ADA"]);
  });

  it("ignores pairs below the volume floor", async () => {
    const net = fakeNetWith(ticker([["DUSTUSDT", 0.01, 90, 1e5], ["BTCUSDT", 65000, 1, 9e8]]));
    const board = await getMarkets(net, "crypto");
    expect(board.up.map((r) => r.symbol)).toEqual(["BTC"]);
  });

  it("prices the ranked table from Binance, not CoinGecko", async () => {
    // One freshness per screen: the cap table's price column must match the
    // movers' price column, or the same coin shows two prices on one page.
    const net = fakeNetWith(
      ticker([["BTCUSDT", 65000, 1.1, 9e8]]),
      [{ symbol: "btc", name: "Bitcoin", current_price: 61000, price_change_percentage_24h: 9.9, market_cap: 1.2e12 }],
    );
    const board = await getMarkets(net, "crypto");
    expect(board.largest[0]).toMatchObject({ symbol: "BTC", price: 65000, changePct: 1.1, marketCap: 1.2e12 });
  });

  it("falls back to CoinGecko's price when a coin has no Binance pair", async () => {
    // USDT is the quote asset; USDTUSDT does not exist.
    const net = fakeNetWith(
      ticker([["BTCUSDT", 65000, 1.1, 9e8]]),
      [{ symbol: "usdt", name: "Tether", current_price: 1, price_change_percentage_24h: 0, market_cap: 1.8e11 }],
    );
    const board = await getMarkets(net, "crypto");
    expect(board.largest.find((r) => r.symbol === "USDT")).toMatchObject({ price: 1 });
  });
});

describe("getMarkets stocks", () => {
  it("ranks the most active by market cap and drops those without one", async () => {
    const board = await getMarkets(fakeStockNet(), "stocks");
    expect(board.largest.map((r) => r.symbol)).toEqual(["NVDA", "AAPL"]);
    expect(board.largest.every((r) => typeof r.marketCap === "number")).toBe(true);
  });
});
```

Write `fakeNetWith` and `fakeStockNet` as local helpers over `FakeNet`.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/data/src/services/markets.test.ts`

- [ ] **Step 3: Implement the service**

```ts
/**
 * Pegged assets, excluded by name rather than by behaviour.
 *
 * Sorting by percentage change parks every stablecoin at the flat end
 * permanently — EURI and RLUSD both surfaced among the five weakest liquid
 * pairs on the day this was designed, at -1.0% and -0.0%. A volume floor does
 * not remove them because their volume is real. Only a list does.
 */
const PEGGED = new Set([
  "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "AEUR", "EUR", "EURI",
  "USD1", "USDE", "PYUSD", "XUSD", "RLUSD", "USDT",
]);

/** Below this, a 90% move is one trade rather than a market. */
const MIN_QUOTE_VOLUME = 10_000_000;
```

`up` is the five largest positive changes, `down` the five most negative — each filtered to rows whose sign actually matches, so a green day yields an empty `down`. `largest` is CoinGecko's order, repriced from the Binance ticker by base asset, falling back to CoinGecko's own price when there is no pair.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run packages/data/src/services/markets.test.ts`

- [ ] **Step 5: Confirm the service guard passes**

Run: `npx vitest run packages/data/src/services/services.test.ts`
Expected: PASS — no `@/lib/*`, no `next/*`, no Prisma, no global `fetch`.

- [ ] **Step 6: Commit**

```bash
git add packages/data/src/services
git commit -m "Shape the market board, with only real fallers in the fallers column"
```

---

### Task 3: The route and the client method

**Files:**
- Create: `apps/web/src/app/api/markets/route.ts`
- Modify: `packages/data/src/client/data-client.ts`
- Modify: `packages/data/src/client/http-client.ts`
- Modify: `packages/data/src/client/client-contract.ts`
- Modify: `packages/data/src/client/stub-client.test.ts`

**Interfaces:**
- Consumes: `getMarkets` from Task 2.
- Produces: `getMarkets(category: "crypto" | "stocks"): Promise<MarketBoard>` on `DataClient`.

- [ ] **Step 1: Add the contract case**

In `client-contract.ts`, alongside the existing cases:

```ts
it("returns a market board for each category", async () => {
  for (const category of ["crypto", "stocks"] as const) {
    const board = await client.getMarkets(category);
    expect(Array.isArray(board.up)).toBe(true);
    expect(Array.isArray(board.down)).toBe(true);
    expect(Array.isArray(board.largest)).toBe(true);
    expect(typeof board.at).toBe("number");
  }
});
```

- [ ] **Step 2: Run and watch both implementations fail**

Run: `npx vitest run packages/data/src/client`
Expected: FAIL for `HttpClient` and for the stub — the method does not exist. Both failing is the point: the contract runs against two implementations.

- [ ] **Step 3: Declare it on the interface**

Add to `data-client.ts` with a comment saying what it is for. It is not optional: both platforms can fetch, so it is not a capability one platform lacks.

- [ ] **Step 4: Implement on `HttpClient`**

`GET /api/markets?category=…`, unwrapping whatever envelope the route uses. This is the only file that may know the URL.

- [ ] **Step 5: Implement on the stub**

Wire `getMarkets` from Task 2 over the stub's `FakeNet`.

- [ ] **Step 6: Write the route**

A wrapper: parse `category` with Zod (`z.enum(["crypto","stocks"])`, defaulting to `"crypto"`), call the service, respond. `export const dynamic = "force-dynamic"`. Under forty lines.

- [ ] **Step 7: Run and watch them pass**

Run: `npx vitest run packages/data/src/client`

- [ ] **Step 8: Commit**

```bash
git add packages/data/src/client apps/web/src/app/api/markets
git commit -m "Put the market board on the DataClient, held to the same contract"
```

---

### Task 4: The Markets screen

**Files:**
- Create: `packages/ui/src/Segmented.tsx`
- Create: `apps/web/src/app/markets/page.tsx`
- Modify: `packages/ui/src/shared-units.test.ts`

**Interfaces:**
- Consumes: `useDataClient`, `MarketBoard`, `CoinIcon`, `PageLabel`, `EmptyState`, `SubHeading`.
- Produces: `Segmented<T extends string>({ value, options, onChange, className })`.

- [ ] **Step 1: Build `Segmented`**

A generic two-or-more-option pill control. `RangePicker` stays separate — it hides extra timeframes on a phone, which a category switch must never do. Say that in the file header so the next reader does not merge them.

- [ ] **Step 2: Build the page**

```
PageLabel "Markets"           (icon: TrendingUp)
Segmented  Crypto · Stocks
<source> · <timestamp>
  SubHeading "Up today"       SubHeading "Down today"
  five rows                   five rows, or EmptyState
  SubHeading "Largest by market cap"
  ranked table
```

- Rows carry `CoinIcon` at `size={20}`, the ticker in mono, and a `held` marker for symbols in the current portfolio's valuation.
- Every row is a `Link` to `/portfolio/{symbol}?p={portfolioId}`.
- Prices and caps format through a **non-masking** helper. Do not call `money()` — it masks under privacy mode, and a market price is not the owner's money. Add `marketMoney()` beside it in `lib/display` if nothing suitable exists, with a comment saying why it bypasses the mask.
- `down` empty renders `<EmptyState>Nothing liquid is down today.</EmptyState>`.
- The board arrives from one `client.getMarkets(category)`; while it is in flight the previous category's board stays on screen rather than blanking.

- [ ] **Step 3: Verify no shared unit was re-typed**

Run: `npx vitest run packages/ui/src/shared-units.test.ts`
Expected: PASS. If `Segmented` re-types a class string the guard names, use the shared unit instead.

- [ ] **Step 4: Verify the screen names no route**

Run: `npx vitest run apps/web/src/screen-boundary.test.ts`
Expected: PASS with **no** new allowlist entry. A failure here means the page is calling `fetch` directly.

- [ ] **Step 5: Check it in a browser**

Build, restart, and confirm: both categories load, an empty `down` column reads correctly, icons render, `held` appears on owned symbols, and figures stay visible with privacy mode on.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Segmented.tsx apps/web/src/app/markets
git commit -m "Add the Markets screen"
```

---

### Task 5: The chart becomes a destination

**Files:**
- Modify: `apps/web/src/app/chart/page.tsx`
- Modify: `apps/web/src/app/portfolio/[symbol]/page.tsx`

- [ ] **Step 1: Read the symbol from the URL**

`useSearchParams().get("symbol")` seeds the existing `symbol` state, uppercased, falling back to `BTCUSDT`. The picker keeps working and is still the way to change it.

- [ ] **Step 2: Suppress the ladder off Bitcoin**

```tsx
// The risk metric is Oakley Wood's Bitcoin script: its three sub-metrics are
// divided by curves fitted to Bitcoin's own history. Measured over 3,000 daily
// bars, BTC stays inside 0–1 for 99% of them and fires 5 sell signals; XRP
// reaches 1.92 and fires 135, because the `> 0.95` tier has no latch and so
// repeats every bar it is above. The line is a fair read of where an asset
// sits in its own range. The ladder is not, off the asset it was fitted to.
// Issue #13 covers recalibrating per asset.
const calibrated = symbol.toUpperCase() === "BTCUSDT";
```

When `calibrated` is false: draw no buy/sell markers and no threshold price lines, and render one muted line under the pane — *"Risk levels are calibrated for Bitcoin. The line is shown for {symbol}; the buy and sell markers are not."* Let the price scale autoscale rather than pinning 0–1.

- [ ] **Step 3: Link the sparkline, for crypto only**

On the asset page, wrap the chart in a `Link` to `/chart?symbol={symbol}` **only** when `assetType === "crypto"`. `/api/candles` is Binance; an equity has no candles and a dead tap is worse than no tap. Give the link a visible focus style and an `aria-label` reading *"Open {symbol} in the detailed chart"*.

- [ ] **Step 4: Check both in a browser**

`/chart?symbol=ETHUSDT` shows the line with no markers and the caveat; `/chart` still shows BTC with its full ladder unchanged; the sparkline on a crypto holding navigates; the sparkline on an equity does not.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/chart apps/web/src/app/portfolio
git commit -m "Open a holding's chart in the detailed view, without its Bitcoin ladder"
```

---

### Task 6: Swap the tab and rehome the chart

**Files:**
- Modify: `packages/ui/src/TabBar.tsx`
- Modify: `apps/web/src/app/more/page.tsx`
- Modify: `BRAND.md`
- Modify: `CLAUDE.md`
- Modify: `docs/carried-forward.md`

- [ ] **Step 1: Swap the tab**

In `TabBar.tsx`, `{ href: "/chart", label: "Chart", Icon: CandlestickChart }` becomes `{ href: "/markets", label: "Markets", Icon: TrendingUp }`.

- [ ] **Step 2: Rehome the chart**

Add `{ href: "/chart", label: "Chart the indicator", Icon: CandlestickChart }` to the `STRATEGY` group in `more/page.tsx`, beside the backtest and the analyzer. Without this the chart is reachable only from a crypto holding, and an owner holding no crypto cannot reach it at all.

- [ ] **Step 3: Update the guides**

`BRAND.md`: the navigation section names the four tabs; add `Segmented` to the shared units list. `CLAUDE.md`: the tab bar line, the screen list, and the API route count. `docs/carried-forward.md`: note that the Yahoo crumb gap now also blocks ETFs on Markets, so solving it unlocks a third category.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck && npx vitest run && npm run lint
```
Expected: typecheck clean, all tests pass, lint exits non-zero with **exactly 21** pre-existing errors. More than 21 means this work added some.

- [ ] **Step 5: Browser pass**

Every tab reaches its page, the chart is reachable from More, and no route 404s.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Trade the Chart tab for Markets, and give the chart a home on More"
```

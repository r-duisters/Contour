import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidate } from "@/core/cache";
import { equityInfo } from "./equity-info";

/**
 * `equity-info.ts` is the one piece of asset-info transport that could not move
 * behind `Net` — Yahoo's cookie-and-crumb handshake needs a response header the
 * port cannot read. Being unported, it is also the piece a `FakeNet` can never
 * exercise, so it gets a stubbed global `fetch` instead. What is worth locking
 * in is the handshake order and the failure tolerance: those are the two things
 * a future port has to reproduce.
 */

const QUOTE_SUMMARY = {
  quoteSummary: {
    result: [{
      assetProfile: { longBusinessSummary: "Makes chips.", sector: "Technology", industry: "Semiconductors" },
      summaryDetail: { marketCap: { fmt: "772.57B" }, trailingPE: { raw: 41.2 } },
      defaultKeyStatistics: { beta: { fmt: "1.98" } },
      financialData: {
        recommendationKey: "strong_buy",
        targetMeanPrice: { fmt: "420.00" },
        numberOfAnalystOpinions: { raw: 52 },
      },
    }],
  },
};

const RSS = `<rss><channel>
  <item><title>Chipmaker beats</title><link>https://x/1</link><source>Reuters</source></item>
</channel></rss>`;

/** Routes a stubbed `fetch` by URL substring, recording the order of calls. */
function stubFetch(routes: { match: string; body: unknown; status?: number; setCookie?: string[] }[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`unstubbed fetch: ${url}`);
    const text = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      headers: { getSetCookie: () => route.setCookie ?? [] },
      text: async () => text,
      json: async () => JSON.parse(text),
      // The credential seed reads `init` only for its User-Agent; assert nothing on it.
      _init: init,
    } as unknown as Response;
  });
  return calls;
}

const CREDS = [
  { match: "fc.yahoo.com", body: "", setCookie: ["A3=session-cookie; Path=/"] },
  { match: "test/getcrumb", body: "abc123" },
];

beforeEach(() => invalidate());
afterEach(() => vi.unstubAllGlobals());

describe("equityInfo", () => {
  it("seeds a cookie, then sends it with the crumb on the quoteSummary call", async () => {
    const calls = stubFetch([
      ...CREDS,
      { match: "quoteSummary", body: QUOTE_SUMMARY },
      { match: "feeds.finance.yahoo.com", body: RSS },
    ]);

    const info = await equityInfo("AMD");

    // The crumb has to be minted before the call that carries it, or Yahoo 401s.
    // Indices, not positions: headlines are fetched in parallel and interleave.
    const at = (needle: string) => calls.findIndex((c) => c.includes(needle));
    expect(at("fc.yahoo.com")).toBeLessThan(at("getcrumb"));
    expect(at("getcrumb")).toBeLessThan(at("quoteSummary"));
    expect(calls.find((c) => c.includes("quoteSummary"))).toContain("crumb=abc123");

    expect(info.about).toBe("Makes chips.");
    expect(info.tags).toEqual(["Technology", "Semiconductors"]);
    expect(info.stats).toContainEqual({ label: "Market cap", value: "772.57B" });
    expect(info.stats).toContainEqual({ label: "P/E (trailing)", value: "41.2" });
    expect(info.sentiment).toEqual({
      label: "Analyst consensus",
      value: "strong buy",
      detail: "mean target 420.00 · 52 analysts",
      score: 1,
    });
    expect(info.news.map((n) => n.title)).toEqual(["Chipmaker beats"]);
    expect(info.sources).toEqual(["Yahoo Finance", "Yahoo Finance news"]);
  });

  it("still returns headlines when the profile lookup fails", async () => {
    stubFetch([
      ...CREDS,
      { match: "quoteSummary", body: "", status: 404 },
      { match: "feeds.finance.yahoo.com", body: RSS },
    ]);

    const info = await equityInfo("GME");
    expect(info.about).toBeNull();
    expect(info.stats).toEqual([]);
    expect(info.news).toHaveLength(1);
    expect(info.sources).toEqual(["Yahoo Finance news"]);
  });

  it("gives up on the profile when Yahoo hands back no cookie", async () => {
    const calls = stubFetch([
      { match: "fc.yahoo.com", body: "", setCookie: [] },
      { match: "feeds.finance.yahoo.com", body: RSS },
    ]);

    const info = await equityInfo("EEM");
    // No cookie means no crumb worth asking for, so quoteSummary is never tried.
    expect(calls.some((c) => c.includes("getcrumb"))).toBe(false);
    expect(info.sources).toEqual(["Yahoo Finance news"]);
  });
});

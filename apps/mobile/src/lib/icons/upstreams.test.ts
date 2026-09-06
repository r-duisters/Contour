import { describe, expect, it } from "vitest";
import { upstreamFor } from "./upstreams";
import SPOTHQ from "./spothq.json";
import GECKO from "./gecko.json";

/**
 * Which host is told about a holding, and how often.
 *
 * This is not a formatting test. Every URL here is a request that names an
 * asset somebody owns, so the rules about *which* upstream answers are the
 * privacy surface of the feature, and the licence argument rests on the order.
 */
describe("choosing an upstream", () => {
  it("prefers the CC0 set, which is the only licence that permits anything", () => {
    const btc = upstreamFor("BTC", "crypto");
    expect(btc?.source).toBe("spothq");
    expect(btc?.url).toContain("spothq/cryptocurrency-icons");
  });

  it("falls to CoinGecko only for coins the CC0 set does not draw", () => {
    // spothq's last commit is August 2022, so 2023-and-later listings are
    // simply absent from it. PEPE is one of them.
    expect((SPOTHQ as string[]).includes("PEPE")).toBe(false);
    const pepe = upstreamFor("PEPE", "crypto");
    expect(pepe?.source).toBe("coingecko");
    expect(pepe?.url).toMatch(/^https:\/\//);
  });

  /**
   * The two lists must not overlap, or a coin spothq draws would still be
   * fetched from CoinGecko by whichever branch ran first — spending the
   * licence exposure the ordering exists to avoid.
   */
  it("never lists a coin in both, so the ordering cannot be sidestepped", () => {
    const cc0 = new Set(SPOTHQ as string[]);
    for (const ticker of Object.keys(GECKO)) {
      expect(cc0.has(ticker), `${ticker} is in both indexes`).toBe(false);
    }
  });

  it("sends equities to parqet, sized so nothing is resized on the phone", () => {
    const aapl = upstreamFor("AAPL", "equity");
    expect(aapl?.source).toBe("parqet");
    expect(aapl?.url).toContain("size=64");
  });

  /**
   * A coin no upstream draws answers null rather than a URL that will 404.
   * Null is what `CoinIcon` already turns into coloured initials; a request
   * that fails costs a round trip and tells a CDN about a holding anyway.
   */
  it("answers null rather than a request it knows will fail", () => {
    expect(upstreamFor("NOTACOIN", "crypto")).toBeNull();
  });

  /** Cash is a currency balance. There is no logo and nothing to ask for. */
  it("asks nobody about cash", () => {
    expect(upstreamFor("EUR", "cash")).toBeNull();
  });

  /**
   * Renames, not workarounds: Fantom became Sonic and parqet knows Mercedes by
   * its Daimler-era ticker. The app stores what a holding is spelled as, so
   * the alias is applied on the way out rather than on the way in.
   */
  it("asks an upstream by the name that upstream knows", () => {
    const ftm = upstreamFor("FTM", "crypto");
    expect(ftm?.url.toLowerCase()).not.toContain("/ftm.");
  });

  it("is case-insensitive about the ticker it is given", () => {
    expect(upstreamFor("btc", "crypto")?.url).toBe(upstreamFor("BTC", "crypto")?.url);
  });
});

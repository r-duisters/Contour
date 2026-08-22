import { describe, it, expect } from "vitest";
import { compact, parseRss, plainText, pickCoin, recommendationScore } from "./asset-info";

describe("parseRss", () => {
  const feed = `<rss><channel><title>Feed</title>
    <item><title>AMD adds a director</title><link>https://x/1</link>
      <pubDate>Wed, 20 Aug 2026 12:00:00 GMT</pubDate><source>Reuters</source></item>
    <item><title><![CDATA[Chips &amp; dips]]></title><link>https://x/2</link></item>
  </channel></rss>`;

  it("reads title, link, date and source", () => {
    const [first] = parseRss(feed);
    expect(first!.title).toBe("AMD adds a director");
    expect(first!.link).toBe("https://x/1");
    expect(first!.source).toBe("Reuters");
    expect(first!.published).toBe(Date.parse("Wed, 20 Aug 2026 12:00:00 GMT"));
  });

  it("ignores the channel title, keeping only items", () => {
    expect(parseRss(feed).map((i) => i.title)).not.toContain("Feed");
  });

  it("unwraps CDATA, decodes entities, and tolerates a missing date", () => {
    const second = parseRss(feed)[1]!;
    expect(second.title).toBe("Chips & dips");
    expect(second.published).toBeNull();
  });

  it("honours the limit and survives junk", () => {
    expect(parseRss(feed, 1)).toHaveLength(1);
    expect(parseRss("not xml at all")).toEqual([]);
  });
});

describe("plainText", () => {
  it("strips tags and collapses whitespace", () => {
    expect(plainText("<p>Bitcoin  is\n<b>money</b></p>")).toBe("Bitcoin is money");
  });

  it("cuts at a sentence end rather than mid-word", () => {
    const out = plainText(`${"A".repeat(40)}. ${"B".repeat(200)}.`, 100);
    expect(out.endsWith(".")).toBe(true);
    expect(out).not.toContain("B");
  });

  it("ellipsises when there is no sentence break to cut at", () => {
    expect(plainText("C".repeat(200), 50)).toMatch(/…$/);
  });
});

describe("pickCoin", () => {
  const coins = [
    { id: "subvortex", symbol: "SUB", market_cap_rank: 1791 },
    { id: "substratum", symbol: "SUB", market_cap_rank: 400 },
    { id: "sub-something-else", symbol: "SUBX", market_cap_rank: 2 },
  ];

  it("prefers an exact ticker match at the best market cap rank", () => {
    expect(pickCoin(coins, "SUB")!.id).toBe("substratum");
  });

  it("never falls back to a coin whose ticker differs", () => {
    expect(pickCoin(coins, "XYZ")).toBeNull();
  });

  it("handles an unranked coin without preferring it", () => {
    const withNull = [{ id: "new", symbol: "SUB", market_cap_rank: null }, ...coins];
    expect(pickCoin(withNull, "SUB")!.id).toBe("substratum");
  });
});

describe("recommendationScore", () => {
  it("orders the consensus keys", () => {
    expect(recommendationScore("strong_buy")).toBeGreaterThan(recommendationScore("buy")!);
    expect(recommendationScore("hold")).toBe(0);
    expect(recommendationScore("sell")).toBeLessThan(recommendationScore("underperform")!);
  });

  it("returns null for anything it does not know", () => {
    expect(recommendationScore(undefined)).toBeNull();
    expect(recommendationScore("shrug")).toBeNull();
  });
});

describe("compact", () => {
  it("scales into the suffix a market would quote", () => {
    expect(compact(1_545_294_328_322, "$")).toBe("$1.55T");
    expect(compact(772_570_000_000, "$")).toBe("$772.57B");
    expect(compact(57_385_895_456, "$")).toBe("$57.39B");
    expect(compact(19_800_000)).toBe("19.8M");
  });

  it("keeps small numbers readable, including sub-unit prices", () => {
    expect(compact(126_080, "$")).toBe("$126.08K");
    expect(compact(12.5, "$")).toBe("$12.5");
    expect(compact(0.000012, "$")).toBe("$0.000012");
  });

  it("returns null rather than a bogus figure for missing data", () => {
    expect(compact(undefined)).toBeNull();
    expect(compact(null)).toBeNull();
    expect(compact(NaN)).toBeNull();
  });

  it("handles negatives", () => {
    expect(compact(-2_500_000_000)).toBe("-2.5B");
  });
});

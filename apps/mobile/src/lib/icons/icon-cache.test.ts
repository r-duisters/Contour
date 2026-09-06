import { beforeEach, describe, expect, it, vi } from "vitest";
import { hydrate, reset, resolve, snapshot, subscribe, type IconDeps } from "./icon-cache";

/** Let the queued microtask and its awaits settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function deps(over: Partial<IconDeps> = {}) {
  const asked: string[] = [];
  const written: string[] = [];
  const d: IconDeps = {
    fetchBase64: async (url) => { asked.push(url); return "AAAA"; },
    write: async (name) => { written.push(name); },
    srcFor: async (name) => `capacitor://cache/icons/${name}`,
    list: async () => [],
    ...over,
  };
  return { d, asked, written };
}

beforeEach(reset);

describe("the logo cache", () => {
  /**
   * The render path is synchronous and must stay that way — `CoinIcon` needs a
   * value for an `<img src>` and cannot await one. A miss draws initials now
   * and becomes a logo on a later render.
   */
  it("answers immediately with nothing, then notifies when the logo lands", async () => {
    const { d } = deps();
    const seen = vi.fn();
    subscribe(seen);

    expect(resolve("BTC", "crypto", d)).toBeNull();
    expect(seen).not.toHaveBeenCalled();

    await settle();
    expect(seen).toHaveBeenCalled();
    expect(snapshot()).toBeGreaterThan(0);
    expect(resolve("BTC", "crypto", d)).toBe("capacitor://cache/icons/BTC.svg");
  });

  /**
   * Every request names an asset somebody holds. A list of twenty rows renders
   * repeatedly, and one request per render would multiply that by every scroll.
   */
  it("asks once however many times a render asks it", async () => {
    const { d, asked } = deps();
    for (let i = 0; i < 25; i++) resolve("ETH", "crypto", d);
    await settle();
    for (let i = 0; i < 25; i++) resolve("ETH", "crypto", d);
    await settle();
    expect(asked).toHaveLength(1);
  });

  /** The extension has to match the bytes, or the WebView will not draw them. */
  it("saves the CC0 set's SVG and everything else's PNG", async () => {
    const { d, written } = deps();
    resolve("BTC", "crypto", d);      // spothq
    resolve("PEPE", "crypto", d);     // coingecko
    resolve("AAPL", "equity", d);     // parqet
    await settle();
    expect(written.sort()).toEqual(["AAPL.png", "BTC.svg", "PEPE.png"]);
  });

  /**
   * A coin no upstream draws must not become a request. The URL would 404, and
   * the round trip would tell a CDN about the holding anyway — paying the
   * whole privacy cost of this feature for a logo that does not exist.
   */
  it("makes no request for a ticker no upstream has", async () => {
    const { d, asked } = deps();
    expect(resolve("NOTACOIN", "crypto", d)).toBeNull();
    await settle();
    expect(asked).toEqual([]);
  });

  it("asks nobody about cash", async () => {
    const { d, asked } = deps();
    resolve("EUR", "cash", d);
    await settle();
    expect(asked).toEqual([]);
  });

  /**
   * A failure is a session-long silence, not a permanent one. Caching it to
   * disk would keep the initials after the network came back; retrying every
   * render would hammer a CDN that is already refusing.
   */
  it("does not retry a failure within the session, and stores nothing", async () => {
    const { d, asked, written } = deps();
    // Still records the attempt — an override that forgot to would make this
    // test pass by asking nothing at all, which is the opposite of the point.
    d.fetchBase64 = async (url) => { asked.push(url); return null; };
    resolve("SOL", "crypto", d);
    await settle();
    resolve("SOL", "crypto", d);
    await settle();
    expect(asked).toHaveLength(1);
    expect(written).toEqual([]);
    expect(resolve("SOL", "crypto", d)).toBeNull();
  });

  it("survives an upstream that throws rather than answers", async () => {
    const { d } = deps();
    d.fetchBase64 = async () => { throw new Error("offline"); };
    expect(() => resolve("ADA", "crypto", d)).not.toThrow();
    await settle();
    expect(resolve("ADA", "crypto", d)).toBeNull();
  });

  /**
   * The cold-start case this exists for: without it the first render after
   * every launch refetches everything held, which is the request this feature
   * is meant to make rare.
   */
  it("adopts what a previous launch left on disk without refetching", async () => {
    const { d, asked } = deps({ list: async () => ["BTC.svg", "AAPL.png"] });
    await hydrate(d);
    expect(resolve("BTC", "crypto", d)).toBe("capacitor://cache/icons/BTC.svg");
    expect(resolve("AAPL", "equity", d)).toBe("capacitor://cache/icons/AAPL.png");
    await settle();
    expect(asked).toEqual([]);
  });

  it("treats a cache that will not enumerate as an empty one", async () => {
    const { d } = deps({ list: async () => { throw new Error("no such directory"); } });
    await expect(hydrate(d)).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { NetError } from "@/data/ports/net";
import { CapacitorNet, type HttpRequest } from "./capacitor-net";

/**
 * The contract here is `WebNet`'s, and it is held for the reason
 * `fake-net.test.ts` states about itself: an implementation that agrees on the
 * happy path and diverges on failures makes the parity worthless. Every
 * assertion below is about a failure.
 */
const ok = (body: string, status = 200): HttpRequest => async () => ({ status, data: body });
const dead = (message: string): HttpRequest => async () => { throw new Error(message); };

describe("CapacitorNet", () => {
  it("returns a parsed body from json() on a 2xx", async () => {
    const net = CapacitorNet(ok('{"a":1}'));
    expect(await net.json("https://x.test/p")).toEqual({ a: 1 });
  });

  it("throws on a non-2xx from json(), carrying the status", async () => {
    const net = CapacitorNet(ok("nope", 404));
    const err = (await net.json("https://x.test/p").catch((e) => e)) as NetError;
    expect(err).toBeInstanceOf(NetError);
    expect(err.status).toBe(404);
    expect(err.message).toContain("404");
    expect(err.message).toContain("nope");
  });

  it("throws kind 'unreachable' when nothing answered", async () => {
    const net = CapacitorNet(dead("no route to host"));
    const err = (await net.json("https://x.test/p").catch((e) => e)) as NetError;
    expect(err.kind).toBe("unreachable");
    expect(err.status).toBeUndefined();
  });

  it("throws kind 'refused' when something answered and said no", async () => {
    // The inversion worth testing: CapacitorHttp resolves for any status, so a
    // 500 must not arrive as a transport failure.
    const net = CapacitorNet(ok("upstream is down", 500));
    const err = (await net.json("https://x.test/p").catch((e) => e)) as NetError;
    expect(err.kind).toBe("refused");
    expect(err.status).toBe(500);
  });

  it("returns the status from request() without throwing", async () => {
    const net = CapacitorNet(ok("gone", 404));
    const res = await net.request("https://x.test/p");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("gone");
  });

  it("still reports 'unreachable' from request(), which has no status to give", async () => {
    const net = CapacitorNet(dead("dns failure"));
    const err = (await net.request("https://x.test/p").catch((e) => e)) as NetError;
    expect(err.kind).toBe("unreachable");
  });

  it("strips the query string from an error message", async () => {
    // Not cosmetic: `equityApiKey` travels as a query parameter and two routes
    // hand `e.message` back to the caller, so a URL in a message is a key in a
    // response.
    const net = CapacitorNet(ok("bad key", 401));
    const err = (await net
      .json("https://api.test/quote?symbol=AAPL&apikey=SECRET123")
      .catch((e) => e)) as NetError;
    expect(err.message).not.toContain("SECRET123");
    expect(err.message).not.toContain("apikey");
    expect(err.message).toContain("https://api.test/quote");
  });

  it("strips the query even from a URL it cannot parse", async () => {
    const net = CapacitorNet(ok("", 500));
    const err = (await net.json("not-a-url?apikey=SECRET123").catch((e) => e)) as NetError;
    expect(err.message).not.toContain("SECRET123");
  });

  it("normalises a body the native layer already parsed", async () => {
    // CapacitorHttp hands back an object when the response looked like JSON,
    // despite responseType: "text".
    const net = CapacitorNet(async () => ({ status: 200, data: { a: 1 } }));
    expect(await net.json("https://x.test/p")).toEqual({ a: 1 });
  });

  it("passes the method through, and names it in the error", async () => {
    let seen: string | undefined;
    const net = CapacitorNet(async (o) => { seen = o.method; return { status: 418, data: "" }; });
    const err = (await net.json("https://x.test/p", { method: "POST" }).catch((e) => e)) as NetError;
    expect(seen).toBe("POST");
    expect(err.message).toContain("POST");
  });
});

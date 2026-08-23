import { afterEach, describe, expect, it, vi } from "vitest";
import { NetError } from "@/data/ports/net";
import { WebNet } from "./web-net";

/**
 * The error message from a failed request travels: `/api/history` and
 * `/api/benchmark` return `e.message` to the browser. A query string can carry
 * the user's `equityApiKey`, so what goes into that message is a disclosure
 * decision, not a formatting one.
 */
describe("WebNet error messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  function failWith(status: number, body: string) {
    vi.stubGlobal("fetch", async () =>
      new Response(body, { status, statusText: "Bad Request" }),
    );
  }

  it("names the endpoint without its query string", async () => {
    failWith(401, "bad key");
    const err = await WebNet()
      .json("https://api.example.com/v1/quote?symbol=AAPL&apikey=SECRET-KEY")
      .catch((e: Error) => e);

    expect((err as Error).message).toContain("https://api.example.com/v1/quote");
    expect((err as Error).message).not.toContain("SECRET-KEY");
    expect((err as Error).message).not.toContain("?");
  });

  it("keeps the status and the provider's reason, which is the useful part", async () => {
    failWith(429, "rate limited");
    const err = await WebNet().text("https://api.example.com/v1/quote?x=1").catch((e: Error) => e);

    expect((err as Error).message).toBe("GET https://api.example.com/v1/quote -> 429: rate limited");
  });
});

/**
 * A caller downstream of the services — Phase 4's `LocalClient` above all —
 * sees only what `json()`/`text()` threw. Whether anything answered has to be
 * on the error, because the message is the one thing that is free to change.
 */
describe("WebNet says whether anything answered", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies a non-2xx as refused, and keeps the status", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));

    const err = await WebNet().json("https://api.example.com/v1/quote").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NetError);
    expect((err as NetError).kind).toBe("refused");
    expect((err as NetError).status).toBe(503);
  });

  it("classifies a dead transport as unreachable, on every form", async () => {
    const cause = new TypeError("fetch failed");
    vi.stubGlobal("fetch", async () => { throw cause; });

    const net = WebNet();
    for (const attempt of [
      net.json("https://api.example.com/v1/quote"),
      net.text("https://api.example.com/v1/quote"),
      net.request("https://api.example.com/v1/quote"),
    ]) {
      const err = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetError);
      expect((err as NetError).kind).toBe("unreachable");
      expect((err as NetError).status).toBeUndefined();
      // Unchanged from what `fetch` itself said, so nothing that already logs
      // or shows this message starts reading differently.
      expect((err as Error).message).toBe("fetch failed");
      expect((err as NetError).cause).toBe(cause);
    }
  });
});

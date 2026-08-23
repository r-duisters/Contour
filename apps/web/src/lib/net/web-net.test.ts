import { afterEach, describe, expect, it, vi } from "vitest";
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

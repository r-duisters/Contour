import { describe, expect, it } from "vitest";
import { NetError } from "../ports/net";
import { __resetSymbolsCacheForTests, symbols } from "../services/lookup";
import { FakeNet, rejectWith, respondWith } from "./fake-net";

/**
 * `Net`'s obligation, held against the fake every service test runs on.
 *
 * The distinction these tests pin is not cosmetic. `HttpClient` sets
 * `RequestFailedError.kind` by calling `request()` and reading the status
 * itself, but every service Phase 4's `LocalClient` will call goes through
 * `json()`/`text()` — so unless what those throw carries the difference, a
 * local client could only tell "the price feed refused" from "there is no
 * network" by matching on the text of a message written for a log.
 *
 * FakeNet has to match WebNet here or the parity is worthless: a service test
 * would prove a classification the device never gets.
 */
describe("FakeNet reports failures the way the port requires", () => {
  const URL = "https://api.example.com/v1/quote";

  it("throws a refused NetError, with the status, for a non-2xx", async () => {
    const net = FakeNet({ [URL]: respondWith(503, "upstream down") });

    const err = await net.json(URL).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NetError);
    expect((err as NetError).kind).toBe("refused");
    expect((err as NetError).status).toBe(503);
    expect((err as Error).message).toContain("upstream down");
  });

  it("throws an unreachable NetError, with no status, when nothing answered", async () => {
    const cause = new TypeError("fetch failed");
    const net = FakeNet({ [URL]: rejectWith(cause) });

    for (const attempt of [net.json(URL), net.text(URL), net.request(URL)]) {
      const err = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetError);
      expect((err as NetError).kind).toBe("unreachable");
      expect((err as NetError).status).toBeUndefined();
      // The original survives, so a log still says what the platform said.
      expect((err as Error).message).toBe("fetch failed");
      expect((err as NetError).cause).toBe(cause);
    }
  });

  /**
   * The case that matters for Phase 4: a service neither catches nor
   * translates, so whatever it propagates is what a client has to classify
   * from. It arrives typed.
   */
  it("lets a service propagate a failure a client can classify without reading the message", async () => {
    __resetSymbolsCacheForTests();
    const dead = FakeNet({
      "https://api.binance.com/api/v3/exchangeInfo": rejectWith(new TypeError("fetch failed")),
    });

    const err = await symbols(dead).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NetError);
    expect((err as NetError).kind).toBe("unreachable");

    __resetSymbolsCacheForTests();
    const refusing = FakeNet({
      "https://api.binance.com/api/v3/exchangeInfo": respondWith(503, "binance down"),
    });

    expect(((await symbols(refusing).catch((e: unknown) => e)) as NetError).kind).toBe("refused");
  });
});

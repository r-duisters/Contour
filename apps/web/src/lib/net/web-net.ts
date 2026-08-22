import type { Net, NetResponse } from "@/data/ports/net";

/**
 * `Net` over the platform `fetch`, for the server build.
 *
 * `json()`/`text()` throw on a non-2xx. That is not a new policy: every existing
 * caller was written against helpers that did exactly this (`if (!res.ok) throw
 * ...` in `binance.ts`, `equity.ts`, `fx.ts`), and the tolerance callers rely on
 * — `fetchPricesSafe` returning a partial map instead of failing — is built by
 * catching that throw, not by the transport returning something empty. A
 * transport that resolved on a 404 would turn those catches into silent bad
 * data: a price map missing a symbol, indistinguishable from a symbol that has
 * no price.
 *
 * `request()` is the escape hatch for callers that genuinely want the status.
 */
export function WebNet(): Net {
  async function checked(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    if (!res.ok) {
      // The body usually carries the provider's reason; losing it turns every
      // upstream failure into a bare status code.
      const body = await res.text().catch(() => "");
      throw new Error(`${init?.method ?? "GET"} ${url} -> ${res.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
    }
    return res;
  }

  return {
    async json<T>(url: string, init?: RequestInit): Promise<T> {
      return (await (await checked(url, init)).json()) as T;
    },
    async text(url: string, init?: RequestInit): Promise<string> {
      return (await checked(url, init)).text();
    },
    async request(url: string, init?: RequestInit): Promise<NetResponse> {
      const res = await fetch(url, init);
      return {
        ok: res.ok,
        status: res.status,
        text: () => res.text(),
        json: <T,>() => res.json() as Promise<T>,
      };
    },
  };
}

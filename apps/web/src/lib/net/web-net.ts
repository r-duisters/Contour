import { NetError, type Net, type NetResponse } from "@/data/ports/net";

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
 *
 * A request that fails rejects with a `NetError`, which says whether anything
 * answered at all — the one thing a caller downstream of the services cannot
 * recover from a message. The message itself is exactly what this file threw
 * before, so the two routes that hand `e.message` back to the browser say the
 * same thing they said.
 */
export function WebNet(): Net {
  /**
   * Origin and path, never the query string. Provider credentials travel as
   * query parameters — `equityApiKey` among them — and `history` and
   * `benchmark` hand `e.message` straight back to the client, so a URL in an
   * error message is a key in a JSON response. The path is what identifies
   * which call failed; the parameters were never part of that.
   */
  function safeUrl(url: string): string {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      // Not parseable as an absolute URL, so there is nothing to strip safely;
      // drop everything from the first `?` rather than guess.
      return url.split("?")[0]!;
    }
  }

  /**
   * `fetch` rejects only when there was no response at all, which is the one
   * thing a status code can never tell a caller apart from.
   */
  async function attempt(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (e) {
      throw new NetError(e instanceof Error ? e.message : String(e), "unreachable", undefined, {
        cause: e,
      });
    }
  }

  async function checked(url: string, init?: RequestInit): Promise<Response> {
    const res = await attempt(url, init);
    if (!res.ok) {
      // The body usually carries the provider's reason; losing it turns every
      // upstream failure into a bare status code.
      const body = await res.text().catch(() => "");
      throw new NetError(
        `${init?.method ?? "GET"} ${safeUrl(url)} -> ${res.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
        "refused",
        res.status,
      );
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
      const res = await attempt(url, init);
      return {
        ok: res.ok,
        status: res.status,
        text: () => res.text(),
        json: <T,>() => res.json() as Promise<T>,
        header: (name: string) => res.headers.get(name),
      };
    },
  };
}

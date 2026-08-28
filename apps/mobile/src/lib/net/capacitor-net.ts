import { NetError, type Net, type NetResponse } from "@/data/ports/net";

/**
 * `Net` for the device build, over Capacitor's native HTTP.
 *
 * **Not `fetch`, and not an optimisation.** A WebView's `fetch` is subject to
 * CORS, and Binance, Yahoo, CoinGecko and the ECB send nothing permissive to a
 * `capacitor://localhost` origin. `CapacitorHttp` issues the request from the
 * native layer, where there is no origin to check. Without it every price
 * request in the app fails.
 *
 * The contract is `WebNet`'s, down to the wording of the errors: `json()` and
 * `text()` throw on a non-2xx, `request()` is the escape hatch that returns the
 * status, and a failure carries `kind` so a caller can tell "nobody answered"
 * from "someone answered and said no". `fake-net.test.ts` puts it plainly —
 * an implementation that matches on the happy path and diverges on failures
 * makes the parity worthless.
 */

/** The one call this needs, injectable so the tests need no native layer. */
export type HttpRequest = (options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: unknown;
  responseType?: "text";
}) => Promise<{ status: number; data: unknown; headers?: Record<string, string> }>;

async function nativeHttp(options: Parameters<HttpRequest>[0]) {
  // Imported lazily so this module can be loaded — and tested — off a device.
  const { CapacitorHttp } = await import("@capacitor/core");
  return CapacitorHttp.request(options as never) as unknown as { status: number; data: unknown };
}

/**
 * What this app calls itself when it asks an upstream for data.
 *
 * Not cosmetic. Android's `HttpURLConnection`, which `CapacitorHttp` uses,
 * identifies itself as `Dalvik/2.1.0 (Linux; U; Android …)`, and Yahoo answers
 * that with 429 every single time — measured, not assumed: `Dalvik/…` was
 * refused on three tries out of three against both the screener and the chart
 * endpoint, while this string was served on three out of three. That one header
 * was the whole of "the stock market page is empty and asset pages have less
 * on them than the web app".
 *
 * Honest rather than disguised: it says what the client is instead of
 * impersonating a browser, which is also what Yahoo appears to be filtering —
 * a Chrome-on-Android string was refused about half the time, presumably
 * because a real browser is expected to carry a consent cookie.
 */
const USER_AGENT = "Contour/1.0 (+self-hosted portfolio tracker)";

export function CapacitorNet(http: HttpRequest = nativeHttp): Net {
  /**
   * Origin and path, never the query string. Provider credentials travel as
   * query parameters — `equityApiKey` among them — and two routes hand
   * `e.message` straight back to the caller, so a URL in an error message is a
   * key in a response. The path is what identifies which call failed; the
   * parameters were never part of that.
   */
  function safeUrl(url: string): string {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return url.split("?")[0]!;
    }
  }

  function headersOf(init?: RequestInit): Record<string, string> {
    const headers = init?.headers
      ? Object.fromEntries(new Headers(init.headers).entries())
      : {};
    // Case-insensitively, because HTTP header names are and `Headers` lowercases
    // what it is given. Spreading a "User-Agent" over a "user-agent" leaves both
    // in the object and lets the native layer choose — so the caller's header
    // would not reliably win, which is the opposite of the intent here.
    const named = Object.keys(headers).some((h) => h.toLowerCase() === "user-agent");
    return named ? headers : { ...headers, "User-Agent": USER_AGENT };
  }

  /**
   * The inversion this file exists to get right.
   *
   * `fetch` rejects only when nothing answered, and gives the transport/status
   * split away for free. `CapacitorHttp.request` resolves for *any* status, so
   * the split has to be made by hand: a rejection is transport, a non-2xx
   * `status` is refusal. Wire it the other way round and every 404 becomes
   * "unreachable" — exactly the distinction `kind` was added to carry.
   */
  async function attempt(
    url: string, init?: RequestInit,
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    let res: { status: number; data: unknown; headers?: Record<string, string> };
    try {
      res = await http({
        url,
        method: init?.method ?? "GET",
        headers: headersOf(init),
        data: init?.body ?? undefined,
        // Always text: the callers that want JSON parse it below, and a body
        // is what makes an upstream failure legible rather than a bare status.
        responseType: "text",
      });
    } catch (e) {
      throw new NetError(e instanceof Error ? e.message : String(e), "unreachable", undefined, {
        cause: e,
      });
    }
    // The native layer hands back a parsed object when the response looked like
    // JSON despite `responseType`, so this normalises rather than assuming.
    const body = typeof res.data === "string" ? res.data : res.data == null ? "" : JSON.stringify(res.data);
    return { status: res.status, body, headers: res.headers ?? {} };
  }

  async function checked(url: string, init?: RequestInit): Promise<string> {
    const { status, body } = await attempt(url, init);
    if (status < 200 || status >= 300) {
      throw new NetError(
        `${init?.method ?? "GET"} ${safeUrl(url)} -> ${status}${body ? `: ${body.slice(0, 500)}` : ""}`,
        "refused",
        status,
      );
    }
    return body;
  }

  return {
    async json<T>(url: string, init?: RequestInit): Promise<T> {
      return JSON.parse(await checked(url, init)) as T;
    },
    async text(url: string, init?: RequestInit): Promise<string> {
      return checked(url, init);
    },
    async request(url: string, init?: RequestInit): Promise<NetResponse> {
      const { status, body, headers } = await attempt(url, init);
      // Header names are case-insensitive and the native layer does not
      // normalise them, so the lookup does.
      const lower = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
      );
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => body,
        json: async <T,>() => JSON.parse(body) as T,
        header: (name: string) => lower[name.toLowerCase()] ?? null,
      };
    },
  };
}

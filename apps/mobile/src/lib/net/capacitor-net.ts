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
}) => Promise<{ status: number; data: unknown }>;

async function nativeHttp(options: Parameters<HttpRequest>[0]) {
  // Imported lazily so this module can be loaded — and tested — off a device.
  const { CapacitorHttp } = await import("@capacitor/core");
  return CapacitorHttp.request(options as never) as unknown as { status: number; data: unknown };
}

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

  function headersOf(init?: RequestInit): Record<string, string> | undefined {
    if (!init?.headers) return undefined;
    return Object.fromEntries(new Headers(init.headers).entries());
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
  async function attempt(url: string, init?: RequestInit): Promise<{ status: number; body: string }> {
    let res: { status: number; data: unknown };
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
    return { status: res.status, body };
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
      const { status, body } = await attempt(url, init);
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => body,
        json: async <T,>() => JSON.parse(body) as T,
      };
    },
  };
}

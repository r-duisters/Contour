import type { Net, NetResponse } from "../ports/net";

export type FakeNetCall = { url: string; init?: RequestInit };

export type FakeNetInstance = Net & {
  /** Every request made, in order, for assertions about what a service asked for. */
  calls: FakeNetCall[];
};

const FAILURE = Symbol("FakeNet.failure");
const REJECTION = Symbol("FakeNet.rejection");

type Failure = { [FAILURE]: true; status: number; body: unknown };
type Rejection = { [REJECTION]: true; error: unknown };

/**
 * A route that answers with a non-2xx, so a test can drive the `return null` /
 * `continue` branches that `net.request()` exists for.
 */
export function respondWith(status: number, body: unknown = ""): unknown {
  return { [FAILURE]: true, status, body } satisfies Failure;
}

/**
 * A route that never gets an HTTP response at all — DNS failure, connection
 * reset, timeout. Distinct from `respondWith`: a non-2xx is a value `request()`
 * hands back, but a transport failure is a rejected promise on every method,
 * `request()` included (see `web-net.ts` — its `fetch` call has nothing
 * catching this). A caller that only ever exercises `respondWith` never learns
 * whether it re-swallows this case the way the code it replaced did.
 */
export function rejectWith(error: unknown): unknown {
  return { [REJECTION]: true, error } satisfies Rejection;
}

function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && FAILURE in value;
}

function isRejection(value: unknown): value is Rejection {
  return typeof value === "object" && value !== null && REJECTION in value;
}

function asText(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

/**
 * A `Net` backed by a lookup table, keyed by URL substring.
 *
 * An unmatched URL throws rather than returning an empty payload. A fake that
 * answers everything makes a service test pass while the real request is
 * pointed at the wrong host — the exact bug the test existed to catch.
 *
 * A route value that is a function is called with the URL, so a test can vary
 * the response by query string; `respondWith(status, body)` produces a failing
 * response; anything else is returned as-is. `text()` returns strings unchanged
 * and JSON-encodes everything else.
 */
export function FakeNet(routes: Record<string, unknown>): FakeNetInstance {
  const calls: FakeNetCall[] = [];

  function resolve(url: string): unknown {
    // Longest key first, so a specific route can override a general one
    // regardless of the order the object literal happened to be written in.
    const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
    const key = keys.find((k) => url.includes(k));
    if (key === undefined) {
      throw new Error(
        `FakeNet: no route matches ${url}. Known routes: ${keys.length ? keys.join(", ") : "(none)"}`,
      );
    }
    const value = routes[key];
    return typeof value === "function" ? (value as (u: string) => unknown)(url) : value;
  }

  // Same split as WebNet: the convenience forms throw on a non-2xx so a test
  // that forgets to handle a failing route fails loudly instead of quietly
  // proceeding with an error body parsed as data.
  function checked(url: string): unknown {
    const value = resolve(url);
    if (isRejection(value)) throw value.error;
    if (isFailure(value)) {
      throw new Error(`GET ${url} -> ${value.status}: ${asText(value.body).slice(0, 500)}`);
    }
    return value;
  }

  return {
    calls,
    async json<T>(url: string, init?: RequestInit): Promise<T> {
      calls.push({ url, init });
      return checked(url) as T;
    },
    async text(url: string, init?: RequestInit): Promise<string> {
      calls.push({ url, init });
      return asText(checked(url));
    },
    async request(url: string, init?: RequestInit): Promise<NetResponse> {
      calls.push({ url, init });
      const value = resolve(url);
      // A rejection rejects `request()` too — `fetch` itself throws before
      // there is any status to report, so there is no `{ ok: false }` shape
      // to hand back.
      if (isRejection(value)) throw value.error;
      const failure = isFailure(value) ? value : null;
      const body = failure ? failure.body : value;
      return {
        ok: !failure,
        status: failure ? failure.status : 200,
        text: async () => asText(body),
        json: async <T,>() => (typeof body === "string" ? (JSON.parse(body) as T) : (body as T)),
      };
    },
  };
}

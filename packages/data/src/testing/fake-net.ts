import { NetError, type Net, type NetResponse } from "../ports/net";

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
 * `request()` included. Both arrive as a `NetError`, differing only in `kind`,
 * which is the whole point: a caller that only ever exercises `respondWith`
 * never learns whether it re-swallows this case the way the code it replaced
 * did, nor whether it tells the two apart.
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
 * A route value that is a function is called with the URL and the request
 * init, so a test can vary the response by query string, by method, or by what
 * was posted; `respondWith(status, body)` produces a failing
 * response; anything else is returned as-is. `text()` returns strings unchanged
 * and JSON-encodes everything else.
 */
export function FakeNet(routes: Record<string, unknown>): FakeNetInstance {
  const calls: FakeNetCall[] = [];

  function resolve(url: string, init?: RequestInit): unknown {
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
    // The route function is handed the `init` as well as the URL. Without it a
    // fake keyed on URL alone cannot answer `GET /api/portfolios` differently
    // from `POST /api/portfolios`, nor a good backup differently from a bad one
    // posted to the same path — so a client test would have to merge two
    // unrelated response bodies into one object and assert against a shape no
    // server ever sends.
    return typeof value === "function"
      ? (value as (u: string, i?: RequestInit) => unknown)(url, init)
      : value;
  }

  /**
   * A rejected route, as the throwing forms report it: a `NetError` of kind
   * `"unreachable"` wrapping whatever the test asked to be thrown. WebNet does
   * the same to `fetch`'s own rejection, and a fake that let the raw error
   * through would let a caller pass here while failing against the real thing.
   */
  function unreachable(error: unknown): NetError {
    return new NetError(error instanceof Error ? error.message : String(error), "unreachable", undefined, {
      cause: error,
    });
  }

  // Same split as WebNet: the convenience forms throw on a non-2xx so a test
  // that forgets to handle a failing route fails loudly instead of quietly
  // proceeding with an error body parsed as data.
  function checked(url: string, init?: RequestInit): unknown {
    const value = resolve(url, init);
    if (isRejection(value)) throw unreachable(value.error);
    if (isFailure(value)) {
      throw new NetError(
        `${init?.method ?? "GET"} ${url} -> ${value.status}: ${asText(value.body).slice(0, 500)}`,
        "refused",
        value.status,
      );
    }
    return value;
  }

  return {
    calls,
    async json<T>(url: string, init?: RequestInit): Promise<T> {
      calls.push({ url, init });
      return checked(url, init) as T;
    },
    async text(url: string, init?: RequestInit): Promise<string> {
      calls.push({ url, init });
      return asText(checked(url, init));
    },
    async request(url: string, init?: RequestInit): Promise<NetResponse> {
      calls.push({ url, init });
      const value = resolve(url, init);
      // A rejection rejects `request()` too — `fetch` itself throws before
      // there is any status to report, so there is no `{ ok: false }` shape
      // to hand back.
      if (isRejection(value)) throw unreachable(value.error);
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

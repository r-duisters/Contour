/**
 * Outbound HTTP. Injected rather than imported so the device build can supply
 * CapacitorHttp, which issues requests natively and is therefore not subject to
 * CORS — the reason a serverless mobile build is possible at all (spec §4.2).
 */

/**
 * Why a request produced no usable answer: nothing answered at all
 * (`"unreachable"` — DNS, a reset connection, airplane mode) or something
 * answered and said no (`"refused"` — any non-2xx).
 *
 * Deliberately the same two words as `RequestFailedError.kind`, so a client
 * built on top can pass the distinction straight through.
 */
export type NetFailureKind = "unreachable" | "refused";

/**
 * What every throwing form of `Net` rejects with.
 *
 * The distinction has to be carried on the error, not inferred from its text.
 * `HttpClient` can classify because it calls `request()` and reads the status
 * itself; the services cannot — they call `json()`/`text()`, so everything
 * Phase 4's `LocalClient` propagates from a price path arrives as whatever
 * those threw. Untyped, the only way to set `RequestFailedError.kind` there
 * would be to string-match an error message written for a log.
 *
 * `status` is present only for `"refused"` — an unreachable host has no status
 * to report. The message is unchanged from what the implementation would have
 * thrown anyway, so anything already showing or logging it keeps reading the
 * same sentence.
 */
export class NetError extends Error {
  constructor(
    message: string,
    readonly kind: NetFailureKind,
    /** The HTTP status, when there was one. Absent for `"unreachable"`. */
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "NetError";
  }
}

/** A response whose status the caller intends to inspect rather than trust. */
export interface NetResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  /**
   * One response header, by name, or null.
   *
   * Deliberately not the whole header map. `Set-Cookie` is unreadable in a
   * browser's `fetch` (spec §4.2), so a general header contract is one only a
   * Node implementation could keep — and an interface both platforms cannot
   * honour is worse than a narrow one that both can.
   *
   * It exists for `Content-Disposition`, which is where a download's filename
   * lives, and which is the reason `exportFile` could not be on `DataClient`
   * before now.
   */
  header(name: string): string | null;
}

export interface Net {
  /**
   * The convenience forms: a non-2xx throws. Most callers want this — a price
   * feed that 500s has no useful partial answer, and the tolerant helpers built
   * on top (`fetchPricesSafe`) get their tolerance by catching, not by being
   * handed an empty body.
   *
   * What they throw is a `NetError`, always — `"refused"` with the status for a
   * non-2xx, `"unreachable"` when the request never got a response. Phase 4's
   * `CapacitorNet` inherits that obligation: the services propagate rather than
   * translate, so a client can only classify a failure they surfaced if the
   * error itself carries the distinction.
   */
  json<T>(url: string, init?: RequestInit): Promise<T>;
  text(url: string, init?: RequestInit): Promise<string>;

  /**
   * The lower-level form, for the callers that treat a non-2xx as a *value*.
   * Seven sites in `fx.ts`, `equity.ts` and `asset-info.ts` answer a bad status
   * with `return null` / `return {}` / `continue`, because a missing company
   * profile must not cost the whole page. Expressing those as
   * `try { await net.json() } catch {}` would also swallow JSON-parse and
   * transport failures that currently propagate, quietly turning a bug into a
   * blank panel. Any implementation — WebNet, FakeNet, Phase 4's CapacitorNet —
   * must offer both, with the same split of responsibilities.
   *
   * A non-2xx is a value here rather than a throw, but a transport failure
   * still rejects — with a `NetError` of kind `"unreachable"`, since there is
   * no status to hand back.
   */
  request(url: string, init?: RequestInit): Promise<NetResponse>;
}

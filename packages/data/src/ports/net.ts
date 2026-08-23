/**
 * Outbound HTTP. Injected rather than imported so the device build can supply
 * CapacitorHttp, which issues requests natively and is therefore not subject to
 * CORS — the reason a serverless mobile build is possible at all (spec §4.2).
 */

/** A response whose status the caller intends to inspect rather than trust. */
export interface NetResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

export interface Net {
  /**
   * The convenience forms: a non-2xx throws. Most callers want this — a price
   * feed that 500s has no useful partial answer, and the tolerant helpers built
   * on top (`fetchPricesSafe`) get their tolerance by catching, not by being
   * handed an empty body.
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
   */
  request(url: string, init?: RequestInit): Promise<NetResponse>;
}

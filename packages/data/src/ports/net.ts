/**
 * Outbound HTTP. Injected rather than imported so the device build can supply
 * CapacitorHttp, which issues requests natively and is therefore not subject to
 * CORS — the reason a serverless mobile build is possible at all (spec §4.2).
 */
export interface Net {
  json<T>(url: string, init?: RequestInit): Promise<T>;
  text(url: string, init?: RequestInit): Promise<string>;
}

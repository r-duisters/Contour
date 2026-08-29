import { PctMoveParams, PriceTargetParams, type AlertKind } from "./alerts";
import { isDisplayCurrency } from "./currencies";
import { assetOf, pricingPair } from "./symbols";

/**
 * Turning stored alerts into the checks a device actually runs.
 *
 * Pure, because the alternative is untestable: there is no component test
 * stack in this repository, and the native notification path can only be
 * exercised on a handset. Everything that can be decided without a device is
 * decided here, so what remains on the device is one fetch and one loop.
 *
 * Both the foreground evaluator and the background runner use these rules —
 * the runner by duplication rather than import, since its runtime has no
 * imports at all. See the comment in `public/runner/alerts.js`.
 */

export type AssetKind = "crypto" | "equity";

export type AlertRule = {
  id: string;
  kind: AlertKind;
  /** Null for a portfolio-scoped rule, which names no symbol of its own. */
  symbol: string | null;
  /** How to price it. Only meaningful when `symbol` is set. */
  assetType?: AssetKind | null;
  portfolioId?: string | null;
  params: Record<string, unknown>;
  enabled?: boolean;
};

/** A holding a portfolio-scoped rule expands over, and how to price it. */
export type HeldAsset = { symbol: string; assetType: AssetKind };

export type ExpandedRule = {
  /** Unique per check: a portfolio-scoped rule yields one id per symbol. */
  id: string;
  kind: "price_target" | "pct_move";
  /**
   * What to ask for. A Binance market for a coin — `pricingPair` has already
   * been applied — and the plain ticker for a share, which is what the equity
   * providers take.
   */
  symbol: string;
  /** Which venue lists it. Never guessed from the ticker; see below. */
  assetType: AssetKind;
  /** The asset, for a person reading the notification. */
  name: string;
  direction?: "above" | "below";
  price?: number;
  threshold?: number;
};

/**
 * One rule in, one check per symbol out.
 *
 * Three things it fixes by existing:
 *
 * A **portfolio-scoped rule has no symbol**, and every device-side filter so
 * far read `a.symbol &&` — so those alerts were dropped before evaluation and
 * have never fired for anyone. They expand here instead, one check per holding.
 *
 * **Cash is not a holding to be alerted on.** `pricingPair` answers `EURUSDT`
 * for a euro balance, which is a real market — so a euro balance would page
 * its owner about the euro as though they had bought it. Filtered here, which
 * is why the caller may pass its holdings raw.
 *
 * **A share is not a Binance market, and the ticker cannot say so.** This
 * dropped anything containing a dot, which caught `ASML.AS` and missed every
 * US listing: `AMD` has no suffix, so it went to Binance as `AMDUSDT` — a
 * market that exists and answers with an unrelated token's price. Firing on
 * the wrong number is worse than not firing, and it is the failure a person
 * cannot see. So the kind is *carried*, never inferred: each holding says what
 * it is, and a rule that names its own symbol says so on the alert row.
 *
 * **Indicator rules need 1,460 daily bars** to warm up. That is not work for a
 * phone, so they stay on the server and are dropped here.
 */
export function expandRules(alerts: AlertRule[], held: HeldAsset[]): ExpandedRule[] {
  const out: ExpandedRule[] = [];

  for (const a of alerts) {
    if (a.enabled === false) continue;
    if (a.kind === "indicator") continue;

    const targets: HeldAsset[] = a.symbol
      ? [{ symbol: a.symbol, assetType: a.assetType === "equity" ? "equity" : "crypto" }]
      : held.filter((h) => !isCash(h.symbol));
    for (const target of targets) {
      const asset = assetOf(target.symbol);
      const base: ExpandedRule = {
        // A rule that named its own symbol keeps its id; an expanded one is
        // suffixed, so the dedupe marks of two holdings cannot collide.
        id: a.symbol ? a.id : `${a.id}:${asset}`,
        kind: a.kind,
        // A pair for a coin, the bare ticker for a share: `ASML.ASUSDT` is not
        // a market, and the equity providers want `ASML.AS`.
        symbol: target.assetType === "equity" ? asset : pricingPair(target.symbol),
        assetType: target.assetType,
        name: asset,
      };

      if (a.kind === "price_target") {
        const params = PriceTargetParams.safeParse(a.params);
        if (!params.success) continue;
        out.push({ ...base, direction: params.data.direction, price: params.data.price });
      } else {
        const params = PctMoveParams.safeParse(a.params);
        if (!params.success) continue;
        out.push({ ...base, threshold: params.data.threshold });
      }
    }
  }

  return out;
}

/** A currency balance rather than a position someone chose to take. */
function isCash(symbol: string): boolean {
  return isDisplayCurrency(assetOf(symbol));
}

/**
 * One notification per rule per UTC day, so a standing condition stays quiet.
 *
 * `key` carries the direction for a move rule, so a fall after a rise still
 * reaches its owner — the two are different news.
 */
export function shouldNotify(sent: Record<string, number>, key: string, day: number): boolean {
  return sent[key] !== day;
}

/** Drop marks older than yesterday, so the store cannot grow without bound. */
export function forgetOldMarks(sent: Record<string, number>, day: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(sent)) if (value >= day - 1) out[key] = value;
  return out;
}

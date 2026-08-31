import { PctMoveParams, PortfolioMoveParams, PriceTargetParams, type AlertKind, type PctMoveHit } from "./alerts";
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
  /** Whether it stays armed after firing. Absent reads as one-shot. */
  repeat?: boolean;
  portfolioId?: string | null;
  params: Record<string, unknown>;
  enabled?: boolean;
};

/**
 * A holding a portfolio-scoped rule expands over, and how to price it.
 *
 * `quantity` is optional because the per-symbol kinds do not need it — a
 * threshold on a price is the same question however much of it you own. Only
 * `portfolio_move` reads it, and it refuses to produce a check when it is
 * missing rather than totalling a portfolio with a hole in it.
 */
export type HeldAsset = { symbol: string; assetType: AssetKind; quantity?: number };

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
  /** Whether the rule stays armed after firing. See `Alert.repeat`. */
  repeat: boolean;
  /** The portfolio a rule watched everything in, so a notice can name it. */
  portfolioId: string | null;
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
    // Not a question about a symbol. `expandPortfolioRules` takes it, and
    // letting it fall through here would expand it per holding — which is the
    // behaviour it exists to replace.
    if (a.kind === "portfolio_move") continue;

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
        repeat: a.repeat ?? false,
        portfolioId: a.symbol ? null : a.portfolioId ?? null,
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

/**
 * A check that reads the whole portfolio rather than one symbol.
 *
 * Its `holdings` are what the check needs priced. That is the same list the
 * per-symbol rules produce when a portfolio-scoped `pct_move` exists, and a
 * different list when it does not — so a caller prices the union rather than
 * assuming one covers the other.
 */
export type PortfolioRule = {
  id: string;
  kind: "portfolio_move";
  portfolioId: string;
  /** Absolute move of the total, in percent. */
  threshold: number;
  repeat: boolean;
  holdings: { symbol: string; assetType: AssetKind; quantity: number }[];
};

/**
 * The portfolio-level rules, as checks against a total.
 *
 * Separate from `expandRules` rather than a branch inside it, because the two
 * produce different shapes for different questions: one check per symbol
 * against a price, or one check per rule against a sum. Folding them together
 * would mean a union type every caller has to narrow, for no gain.
 *
 * A rule naming a symbol is not a portfolio rule and is dropped: `portfolio_move`
 * on one asset is `pct_move` with extra steps, and the alerts screen does not
 * offer it.
 *
 * **Cash is excluded, and that is a judgement worth stating.** A euro balance
 * does not move against itself, so including it would damp every percentage by
 * the share of the portfolio sitting in cash — a 4% fall in the assets reading
 * as 3% because a quarter of the book is currency. The threshold is about what
 * was bought.
 */
export function expandPortfolioRules(alerts: AlertRule[], held: HeldAsset[]): PortfolioRule[] {
  const out: PortfolioRule[] = [];
  for (const a of alerts) {
    if (a.enabled === false) continue;
    if (a.kind !== "portfolio_move") continue;
    if (a.symbol) continue;
    if (!a.portfolioId) continue;

    const params = PortfolioMoveParams.safeParse(a.params);
    if (!params.success) continue;

    const holdings = held
      .filter((h) => !isCash(h.symbol))
      .filter((h) => typeof h.quantity === "number" && h.quantity > 0)
      .map((h) => ({
        symbol: h.assetType === "equity" ? assetOf(h.symbol) : pricingPair(h.symbol),
        assetType: h.assetType,
        quantity: h.quantity as number,
      }));
    if (holdings.length === 0) continue;

    out.push({
      id: a.id,
      kind: "portfolio_move",
      portfolioId: a.portfolioId,
      threshold: params.data.threshold,
      repeat: a.repeat ?? false,
      holdings,
    });
  }
  return out;
}

/**
 * The move of a portfolio's total, or null when it cannot be known.
 *
 * Null in three cases, and they are all the same case: a total computed from
 * some of its parts is not the portfolio's move, it is a different portfolio's
 * move. If any holding is missing either price, this answers null rather than
 * quietly reporting the sum of whatever priced. `alert-rules` already states
 * the principle for symbols — firing on the wrong number is worse than not
 * firing, and it is the failure a person cannot see.
 *
 * `prices` and `dayAgo` are keyed by the same `symbol` the rule carries, which
 * is a Binance pair for a coin and a bare ticker for a share.
 */
export function evaluatePortfolioMove(
  rule: PortfolioRule,
  prices: Record<string, number>,
  dayAgo: Record<string, number>,
): PctMoveHit | null {
  let now = 0;
  let then = 0;
  for (const h of rule.holdings) {
    const p = prices[h.symbol];
    const q = dayAgo[h.symbol];
    if (!Number.isFinite(p) || !Number.isFinite(q) || p === undefined || q === undefined) return null;
    now += h.quantity * p;
    then += h.quantity * q;
  }
  if (then <= 0) return null;

  const pct = ((now - then) / then) * 100;
  if (Math.abs(pct) < rule.threshold) return null;
  return { direction: pct >= 0 ? "up" : "down", pct };
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

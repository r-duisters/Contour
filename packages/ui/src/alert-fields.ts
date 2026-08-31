import { pricingPair } from "@/core/symbols";

/**
 * What an asset page submits when someone asks to be told about a price.
 *
 * Pure and in its own module, for the reason `tx-fields.ts` is: the rules
 * worth getting right — what the symbol becomes, what counts as a usable
 * price — can then be checked without a component test stack, which this
 * repository does not have.
 */

export type AlertDraft = {
  /**
   * Which question is being asked. "price" is where this form started and
   * stays the default; "return" is the same form asking about the holder
   * instead of the market, and is only offered on something actually held.
   */
  mode?: "price" | "return" | "move";
  direction: "above" | "below";
  price: string;
  /** "return" only: which way the position has to have gone, and how far. */
  pnlDirection?: "up" | "down";
  pnlPct?: string;
  /** "move" only: how far in a day, either way. */
  movePct?: string;
  /**
   * Keep watching after it fires, rather than disarming.
   *
   * A price target was one-shot with no say in it, which is right for "tell me
   * when it gets there" and wrong for "tell me whenever it is there" — a level
   * somebody watches for weeks had to be recreated after every crossing.
   */
  repeat: boolean;
};

export type AlertFieldsResult =
  | {
      ok: true; kind?: "price_target"; symbol: string; assetType: "crypto" | "equity";
      direction: "above" | "below"; price: number; repeat: boolean;
    }
  | {
      ok: true; kind: "position_pnl"; symbol: string; assetType: "crypto" | "equity";
      portfolioId: string; direction: "up" | "down"; pct: number; repeat: boolean;
    }
  | {
      ok: true; kind: "pct_move"; symbol: string; assetType: "crypto" | "equity";
      portfolioId: string; threshold: number; repeat: boolean;
    }
  | { ok: false; error: string };

/**
 * The symbol an alert is stored under, which differs by kind on purpose.
 *
 * A coin's alert addresses a *Binance market*, so it keeps the pair —
 * `CLAUDE.md` names `Alert.symbol` as the documented exception to "a stored
 * symbol is an asset, not a pair", and the evaluator asks Binance for exactly
 * this string. A share has no pair: `pricingPair` would answer `ASML.ASUSDT`,
 * which is not a market and which nothing can price, so it keeps its bare
 * ticker and is priced through the equity provider instead.
 *
 * The asymmetry reads as arbitrary six months later, which is exactly why it
 * is one function with both directions pinned by tests rather than an
 * `if` inside a form.
 */
export function alertSymbol(symbol: string, assetType: "crypto" | "equity"): string {
  return assetType === "equity" ? symbol.toUpperCase() : pricingPair(symbol);
}

/**
 * Validate a draft, or say what is wrong with it in words a person can act on.
 *
 * A price of zero is rejected rather than accepted as "any price": an alert
 * that fires immediately and forever is not what anyone meant by it.
 */
export function alertFields(
  symbol: string,
  assetType: "crypto" | "equity" | null,
  draft: AlertDraft,
  /** Required for a return rule, ignored by a price target. */
  portfolioId?: string | null,
): AlertFieldsResult {
  if (assetType === null) {
    // The kind decides which venue prices it, and guessing from the ticker is
    // how `AMD` becomes `AMDUSDT`. Waiting is the correct answer.
    return { ok: false, error: "Still working out what this asset is." };
  }
  if (draft.mode === "move") {
    /*
     * A move needs no position — an asset moves whether or not anybody owns
     * it — so unlike a return this is offered on anything the page can draw.
     * The portfolio id still travels because `NewAlertInput` carries it for
     * the whole family, and the client drops it when a symbol is named.
     */
    const pct = Number((draft.movePct ?? "").replace(",", "."));
    if (!Number.isFinite(pct) || pct <= 0) {
      return { ok: false, error: "Enter a percentage above zero." };
    }
    return {
      ok: true,
      kind: "pct_move",
      symbol: alertSymbol(symbol, assetType),
      assetType,
      portfolioId: portfolioId ?? "",
      threshold: pct,
      repeat: draft.repeat,
    };
  }

  if (draft.mode === "return") {
    /*
     * A return is a fact about a position, so it needs the portfolio the
     * position is in. The form only offers this mode on something held, and
     * this is the second gate: without an id the rule would have no ledger to
     * read a cost from, and the evaluator would produce no check at all —
     * which is a silent nothing rather than a message.
     */
    if (!portfolioId) {
      return { ok: false, error: "This only works on something you hold." };
    }
    const pct = Number((draft.pnlPct ?? "").replace(",", "."));
    if (!Number.isFinite(pct) || pct <= 0) {
      return { ok: false, error: "Enter a percentage above zero." };
    }
    return {
      ok: true,
      kind: "position_pnl",
      symbol: alertSymbol(symbol, assetType),
      assetType,
      portfolioId,
      direction: draft.pnlDirection ?? "up",
      pct,
      repeat: draft.repeat,
    };
  }

  const price = Number(draft.price.replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Enter a price above zero." };
  }
  return {
    ok: true,
    symbol: alertSymbol(symbol, assetType),
    assetType,
    direction: draft.direction,
    price,
    repeat: draft.repeat,
  };
}

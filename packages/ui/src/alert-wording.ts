/**
 * What a stored alert says on a list row.
 *
 * Shared because both alert pages draw the same rows, and the wording is the
 * only thing that makes five kinds distinguishable. When this lived in the
 * device page as a two-way branch, every kind that was not `price_target`
 * rendered as "Moves ±undefined% in a day" — a return target and a
 * portfolio-total rule were the same sentence, and both were wrong.
 *
 * **Structural arguments, not the stored row.** The two pages hold an alert in
 * two shapes — the device has an `AlertSummary` and a map of portfolio names,
 * the server route joins the name onto the row — and naming either of those
 * types here would make one page convert to please the other. What both can
 * supply is the four fields the words are made of.
 *
 * **A row states its own scope.** "Moves ±5% in a day" under `ETH` and the
 * same words under "Everything in My portfolio" are different rules, and the
 * second is the one people read as the first. The subject line carries the
 * scope, so the condition does not repeat it — except for the portfolio pair,
 * where two kinds share a subject: the total moving 3% and any one holding
 * moving 3% are different questions with the same subject, so those two spell
 * it out.
 */
export type AlertWords = {
  kind: string;
  symbol: string | null;
  params: Record<string, unknown>;
  repeat: boolean;
};

export function alertCondition(a: AlertWords): string {
  const p = (a.params ?? {}) as {
    direction?: string; price?: number; threshold?: number; pct?: number;
  };
  switch (a.kind) {
    case "price_target":
      return `${p.direction === "below" ? "Falls below" : "Rises above"} ${p.price}` +
        ` · ${a.repeat ? "keeps watching" : "one-shot"}`;
    case "portfolio_move":
      return `Total value moves ±${p.threshold}% in a day`;
    case "position_pnl":
      return `${p.direction === "down" ? "Down" : "Up"} ${p.pct}% on what you paid`;
    case "pct_move":
      return a.symbol
        ? `Moves ±${p.threshold}% in a day`
        : `Any one holding moves ±${p.threshold}% in a day`;
    case "indicator":
      return "Indicator signal";
    default:
      // A kind added to the store but not yet to this file. A row with no line
      // under it looks broken, so it says the kind rather than nothing.
      return a.kind;
  }
}

/**
 * What the alert watches, in words rather than in stored fields.
 *
 * A portfolio-scoped rule has no symbol — that is the shape that means "the
 * whole portfolio" — and the ticker column rendered blank for it. It names the
 * portfolio instead, and never its id.
 */
export function alertSubject(symbol: string | null, portfolioName: string | null): string {
  if (symbol) return symbol;
  return portfolioName ? `Everything in ${portfolioName}` : "Everything you own";
}

/**
 * How many decimals a price is worth showing, and the string to put in a form
 * field that offers one.
 *
 * Two for anything priced like a share, eight for a coin trading below a cent:
 * `1,489.80004883` is float noise and `0.00` would be a useless offer for
 * PEPE. The rule was written inside `TxForm`'s "Use <price>" label, and the
 * field it filled did not follow it — the label read "Use 399.88" and the box
 * received 399.8797560766, so the button misdescribed its own effect. It lives
 * here now because a second form (`AlertForm`) needed the same rule, and a
 * local copy is how the two drift apart.
 *
 * Not `money()`: that formats in the *display* currency, and these figures are
 * in the asset's own.
 *
 * **Its own module, and not in `display.ts`.** That file is `"use client"` —
 * it holds the display currency and the privacy mask, which are per-browser
 * state — so anything imported from it is a client function. The alert
 * evaluator is a server route and needs this rule too: importing it from there
 * produced "Attempted to call priceDigits() from the server", at runtime,
 * where no test could see it. The rule itself is arithmetic and belongs to
 * neither side.
 */
export function priceDigits(n: number): number {
  return Math.abs(n) >= 1 ? 2 : 8;
}

/** The same price as a form value: rounded, and with no grouping separators. */
export function priceFieldValue(n: number): string {
  return String(Number(n.toFixed(priceDigits(n))));
}

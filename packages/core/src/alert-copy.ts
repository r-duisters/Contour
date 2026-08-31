import { priceDigits } from "./price-format";

/**
 * What an alert says when it reaches somebody, written in one place.
 *
 * Five things in this repository could send a notification — the app's
 * foreground check, the background runner, Web Push, FCM and Home Assistant —
 * and each composed its own sentence. Two of them already disagreed about the
 * same event: a daily move arrived as "ETH up 5.2%" from one and "ETH up 5.2%
 * in 24h" from the other, and both can fire for one move because the
 * duplication is deliberate. A person could receive two notifications that did
 * not look like the same thing.
 *
 * Pure, so it can be tested without a phone: the only way to see the real
 * article is on a handset, and everything decided here is decided off one.
 *
 * `public/runner/alerts.js` keeps a copy by hand. That runtime has no imports
 * at all — the same constraint that forces it to duplicate the Binance call —
 * and `runner-wiring.test.ts` pins the strings that must match.
 */

export type Notice = { title: string; body: string };

/**
 * A figure with its currency after it, the way a quote is read aloud.
 *
 * Grouped, and rounded by `priceDigits` — the same rule the transaction form
 * uses, so the number in a notification matches the number the form would
 * offer for the same asset. Trailing zeros are dropped for the same reason:
 * `2,388.20` and `2,388.2` are the same price, and the form types the second.
 *
 * Not `money()`, which formats in the *display* currency and would print a
 * USDT price as "€2,433". These figures are in the asset's own currency,
 * which is exactly the thing every one of these notifications failed to say.
 */
function amount(value: number, currency: string): string {
  const shown = Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: priceDigits(value),
  });
  return `${value < 0 ? "-" : ""}${shown} ${currency}`.trim();
}

/**
 * A price target that has just been reached.
 *
 * The body carries what the title cannot: whether this alert has just switched
 * itself off. A one-shot that fires and vanishes is the app doing what the
 * form promised, but silently — somebody who wanted to be told twice has no
 * way to learn from the notification that they will not be.
 */
export function priceTargetNotice(a: {
  name: string;
  direction: "above" | "below";
  target: number;
  price: number;
  currency: string;
  /** False for a standing alert, which stays armed and may say this again. */
  oneShot: boolean;
}): Notice {
  return {
    title: `${a.name} ${a.direction === "below" ? "fell below" : "rose above"} ${amount(a.target, a.currency)}`,
    body: a.oneShot
      ? `Now ${amount(a.price, a.currency)} · this one-shot alert has switched itself off`
      : `Now ${amount(a.price, a.currency)} · still watching`,
  };
}

/**
 * A daily move past a threshold.
 *
 * "in 24 hours" is in the title because a percentage without a period is not a
 * fact. The body carries where it moved *from*, which is what makes the size
 * of the move mean anything — it used to repeat the current price, which the
 * title already implied.
 *
 * `portfolio` names the rule rather than the asset when the alert watches
 * everything held: those fire on a symbol the person never chose, and a
 * notification they cannot trace to a rule is one they cannot switch off.
 */
export function moveNotice(a: {
  name: string;
  direction: "up" | "down";
  pct: number;
  from: number;
  price: number;
  currency: string;
  /** The portfolio's name, for a rule that watches every holding. */
  portfolio?: string | null;
}): Notice {
  const move = `${a.name} ${a.direction} ${Math.abs(a.pct).toFixed(1)}% in 24 hours`;
  const prices = `${amount(a.from, a.currency)} → ${amount(a.price, a.currency)}`;
  return {
    title: move,
    /*
      The rule's own name, so a notification and the screen that made it agree.
      It carried the old label long after the control stopped using it — a
      notification is the one piece of copy nobody re-reads when renaming
      something, because it is read at 6am on a phone and never in the editor.
    */
    body: a.portfolio ? `From your daily move rule on ${a.portfolio} · ${prices}` : prices,
  };
}

/**
 * The alert that says the other alerts are blind.
 *
 * A rule whose symbol cannot be priced fires nothing, and firing nothing is
 * indistinguishable from a market that did not move — the failure this project
 * treats as the worst one, because the person is not waiting for news, they
 * believe they already have it.
 *
 * Not a kind somebody creates. It rides on the rules that already exist: if
 * you asked to be told about BTC and BTC cannot be priced, that is worth one
 * sentence.
 *
 * The wording avoids blaming a provider by name. "Binance did not answer" is
 * often wrong — a renamed market, a delisting and a lapsed key all look
 * identical from here — so it says what is true (no price) and what to check.
 */
export function stalePriceNotice(a: { name: string }): Notice {
  return {
    title: `No price for ${a.name}`,
    body: "Your alerts on it were not checked. It may have been renamed, delisted, or moved to a provider that needs a key.",
  };
}

/**
 * What a position has done for its owner, which no price alert can say.
 *
 * "ETH up 50% on what you paid" rather than "ETH reached $4,200": the same
 * event, told in the terms the rule was written in. A reader who set a return
 * threshold is not watching a price, and echoing one back would make them do
 * the arithmetic the alert exists to do.
 *
 * The average cost is included because it is the number that makes the
 * percentage checkable, and because somebody who has bought three times will
 * not remember it.
 */
export function positionPnlNotice(a: {
  name: string;
  direction: "up" | "down";
  pct: number;
  avgCost: number;
  price: number;
  currency: string;
}): Notice {
  return {
    title: `${a.name} ${a.direction} ${Math.abs(a.pct).toFixed(1)}% on what you paid`,
    body: `${amount(a.avgCost, a.currency)} average cost → ${amount(a.price, a.currency)}`,
  };
}

/**
 * The whole portfolio moved, which is a different sentence from an asset
 * moving.
 *
 * It names the portfolio and the money rather than a ticker and a price,
 * because that is what the rule is about — the per-asset notice already exists
 * for the other question, and reusing it would say "Long-term up 4%" as though
 * the portfolio were a holding.
 *
 * The value is included because a percentage alone is not actionable at 6am: a
 * 4% fall means one thing on a book of 8,000 and another on 800,000, and the
 * reader should not have to open the app to learn which portfolio this was.
 */
export function portfolioMoveNotice(a: {
  portfolio: string;
  direction: "up" | "down";
  pct: number;
  from: number;
  value: number;
  currency: string;
}): Notice {
  return {
    title: `${a.portfolio} ${a.direction} ${Math.abs(a.pct).toFixed(1)}% in 24 hours`,
    body: `${amount(a.from, a.currency)} → ${amount(a.value, a.currency)}`,
  };
}

/**
 * An indicator signal from the strategy, which only the server evaluates.
 *
 * The words are the Pine script's own — long, short, exit — and stay that way;
 * inventing friendlier ones would describe something the backtest does not.
 */
export function indicatorNotice(a: {
  name: string;
  signal: string;
  price: number;
  currency: string;
  timeframe: string;
}): Notice {
  return {
    title: `${a.name} ${a.signal} signal`,
    body: `${amount(a.price, a.currency)} on the ${a.timeframe} chart`,
  };
}

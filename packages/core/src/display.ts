"use client";

import { KEYS, readKey } from "./storage-keys";

/**
 * How figures are shown: which currency, and whether amounts are hidden.
 *
 * Privacy mode blanks anything that reveals size — money and quantities — while
 * leaving percentages, tickers and shares visible, so the app can be read on a
 * train without showing a stranger what it is worth.
 *
 * Both live in module state because every page formats through the same
 * helpers; components subscribe with usePrivacy() so a toggle re-renders them.
 */

const KEY = KEYS.hideAmounts;
const EVENT = KEYS.privacyEvent;

let currency: "USD" | "EUR" = "USD";
let hidden = false;

export function setDisplayCurrency(next: "USD" | "EUR"): void {
  currency = next;
}

export function displayCurrency(): "USD" | "EUR" {
  return currency;
}

export function amountsHidden(): boolean {
  return hidden;
}

/** Read the stored preference. Safe to call before the first paint. */
export function loadPrivacy(): boolean {
  if (typeof window === "undefined") return false;
  hidden = readKey(KEY) === "1";
  return hidden;
}

export function setAmountsHidden(next: boolean): void {
  hidden = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, next ? "1" : "0");
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

export function onPrivacyChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

const MASK = "•••••";

/**
 * Money in the display currency, or a mask when amounts are hidden.
 *
 * The symbol leads, always. Intl puts it after the number for a euro in a
 * German locale — "142.580,42 €" — which reads as an afterthought in a column
 * of figures and disagrees with the design. Grouping and the decimal mark
 * still follow the locale, so a euro keeps its full stops and comma.
 */
export function money(n: number, maximumFractionDigits = 2): string {
  if (hidden) return MASK;
  const locale = currency === "EUR" ? "de-DE" : "en-US";
  const digits = Math.min(2, maximumFractionDigits);
  const abs = Math.abs(n).toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits,
  });
  return `${n < 0 ? "-" : ""}${currency === "EUR" ? "\u20ac" : "$"}${abs}`;
}

/** A holding's size, which reveals as much as its value does. */
export function quantity(n: number): string {
  if (hidden) return MASK;
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** Percentages stay visible: they say how it went without saying how much. */
export function percent(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/**
 * A price-axis label. The axis is as wide as its widest label, so a chart
 * priced in full — "€142.580,42" — spends a fifth of a 390px screen on a
 * column of digits. Compacting to "€143k" gives that width back to the line
 * without giving up the reading.
 */
export function axisMoney(n: number): string {
  if (hidden) return MASK;
  const sym = currency === "EUR" ? "\u20ac" : "$";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  if (abs >= 1) return `${sign}${sym}${abs.toFixed(abs >= 100 ? 0 : 2)}`;
  return `${sign}${sym}${abs.toPrecision(2)}`;
}

/**
 * A market price, always visible and always in dollars.
 *
 * Two departures from `money`, both deliberate.
 *
 * It does not mask. Privacy mode hides *the owner's* figures — what they hold
 * and what it is worth — and the price of Bitcoin is not one of those. Masking
 * a public quote hides nothing from a shoulder and empties the screen of the
 * only thing it exists to show.
 *
 * It does not convert. The Markets board is priced by Binance in USDT and by
 * Yahoo in USD; putting a euro sign on those figures because the owner reads
 * in euros would state a conversion nobody performed.
 */
export function marketMoney(n: number): string {
  const abs = Math.abs(n);
  // A coin worth fractions of a cent needs the digits; NVDA does not.
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  })}`;
}

/** A market capitalisation, compacted: "$1.2T", "$43.0B". Never masked, for the reasons above. */
export function marketCap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

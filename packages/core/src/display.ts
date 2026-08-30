"use client";

import { KEYS, readKey } from "./storage-keys";
import type { DisplayCurrency } from "./currencies";

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

let currency: DisplayCurrency = "USD";
let hidden = false;

export function setDisplayCurrency(next: DisplayCurrency): void {
  currency = next;
}

export function displayCurrency(): DisplayCurrency {
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
 * A number locale per currency, so grouping and the decimal mark follow the
 * convention of the place that uses the money rather than the machine the app
 * happens to be running on. `toLocaleString(undefined, …)` would be shorter
 * and would make the same figure render differently on two devices.
 */
const LOCALES: Record<string, string> = {
  AUD: "en-AU", BRL: "pt-BR", CAD: "en-CA", CHF: "de-CH", CNY: "zh-CN",
  CZK: "cs-CZ", DKK: "da-DK", EUR: "de-DE", GBP: "en-GB", HKD: "en-HK",
  HUF: "hu-HU", IDR: "id-ID", ILS: "he-IL", INR: "en-IN", ISK: "is-IS",
  JPY: "ja-JP", KRW: "ko-KR", MXN: "es-MX", MYR: "ms-MY", NOK: "nb-NO",
  NZD: "en-NZ", PHP: "en-PH", PLN: "pl-PL", RON: "ro-RO", SEK: "sv-SE",
  SGD: "en-SG", THB: "th-TH", TRY: "tr-TR", USD: "en-US", ZAR: "en-ZA",
};

const localeFor = (c: string): string => LOCALES[c] ?? "en-US";

const symbols = new Map<string, string>();
const minorUnits = new Map<string, number>();

/**
 * The currency's symbol, from Intl rather than a second hand-kept table — it
 * already knows that a krona is "kr" and a forint "Ft", and a list of thirty
 * of those maintained here would only ever disagree with it.
 *
 * A symbol of more than one character gets a space after it. "$142.58" is how
 * a dollar is written and "kr142 580,42" is not how anything is written; the
 * space is what makes a leading word-symbol read as a symbol. The symbol still
 * leads in every currency, which is the rule that keeps a column of figures
 * aligned — see BRAND.md.
 */
function symbolFor(c: string): string {
  const hit = symbols.get(c);
  if (hit !== undefined) return hit;
  let sym = c;
  try {
    const parts = new Intl.NumberFormat(localeFor(c), { style: "currency", currency: c })
      .formatToParts(0);
    sym = parts.find((p) => p.type === "currency")?.value ?? c;
  } catch {
    // An unknown code throws; showing the code itself is the honest fallback.
  }
  const out = sym.length > 1 ? `${sym}\u00a0` : sym;
  symbols.set(c, out);
  return out;
}

/**
 * How many decimals the currency actually has. A yen has none, and printing
 * "¥1,240.00" states a precision the currency does not possess.
 */
function minorUnitsFor(c: string): number {
  const hit = minorUnits.get(c);
  if (hit !== undefined) return hit;
  let units = 2;
  try {
    units = new Intl.NumberFormat("en-US", { style: "currency", currency: c })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown code: two decimals is the commonest answer and a safe one.
  }
  minorUnits.set(c, units);
  return units;
}

/**
 * Money in the display currency, or a mask when amounts are hidden.
 *
 * The symbol leads, always. Intl puts it after the number for a euro in a
 * German locale — "142.580,42 €" — which reads as an afterthought in a column
 * of figures and disagrees with the design. Grouping and the decimal mark
 * still follow the locale, so a euro keeps its full stops and comma.
 */
export function money(n: number, maximumFractionDigits?: number): string {
  if (hidden) return MASK;
  return inCurrency(n, maximumFractionDigits);
}

/**
 * The formatting alone, with no opinion about privacy.
 *
 * Separated so `marketPrice` can reach it: a price is in the display currency
 * like everything else on the page, and is not the owner's money.
 */
function inCurrency(n: number, maximumFractionDigits?: number): string {
  // Absent an explicit request, the currency decides: two decimals for a
  // dollar, none for a yen. A caller that asks for more — a coin priced in
  // millionths — still gets them, and still gets the currency's own minimum.
  const minor = minorUnitsFor(currency);
  const max = maximumFractionDigits ?? minor;
  const abs = Math.abs(n).toLocaleString(localeFor(currency), {
    minimumFractionDigits: Math.min(minor, max),
    maximumFractionDigits: max,
  });
  return `${n < 0 ? "-" : ""}${symbolFor(currency)}${abs}`;
}

/**
 * What one unit of an asset costs, on a page that has already converted.
 *
 * The gap between the two functions either side of it. `money` would mask it,
 * and a public quote is not the owner's figure. `marketMoney` would print it
 * in dollars, and this one has been converted — the asset page's price sits
 * beside a holding in the display currency and was computed from the same
 * rate. Printing "$2,104.54" next to "€110.304,04" states a conversion nobody
 * performed and invites the reader to divide one by the other.
 *
 * The digits come from `marketMoney`'s rule, because a coin worth fractions of
 * a cent needs them wherever it is shown.
 */
export function marketPrice(n: number): string {
  const abs = Math.abs(n);
  return inCurrency(n, abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8);
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
  const sym = symbolFor(currency);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  if (abs >= 1) return `${sign}${sym}${abs.toFixed(abs >= 100 ? 0 : 2)}`;
  return `${sign}${sym}${abs.toPrecision(2)}`;
}

/**
 * A market price in *its own* currency, always visible and always in dollars.
 *
 * For a figure that has been converted into the display currency — an asset
 * page's price, beside a holding — use `marketPrice` instead.
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

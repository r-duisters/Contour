/**
 * What a currency is: whether a price in it is already dollars, where its rate
 * comes from, and whether a person can ask to see the whole app in it.
 *
 * The first two questions used to have three overlapping answers, in
 * `delta-csv.ts` and `transfer.ts`; the importer and the manual entry form now
 * read the same one, because a trade typed by hand and the same trade imported
 * must price identically. The third arrived when the display currency stopped
 * being a choice between two.
 */

/** Quotes already worth one USD, so a price in them is already a USD price. */
export const STABLES: ReadonlySet<string> = new Set([
  "USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD",
]);

/**
 * Every currency the app can be displayed in — which is exactly every currency
 * Frankfurter publishes an ECB reference rate for, plus the dollar the rates
 * are quoted against.
 *
 * The list is a constant rather than a fetch. It changes when the ECB changes
 * it, roughly never, and a settings screen that cannot draw its own options
 * until a network call returns is worse than one that occasionally offers a
 * currency the rate feed has dropped — the conversion answers null and the
 * screen says so, which is the same path a feed outage already takes.
 */
export const DISPLAY_CURRENCIES = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK",
  "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** For a settings menu, where a code alone is not an answer to "which one?". */
export const CURRENCY_NAMES: Record<DisplayCurrency, string> = {
  AUD: "Australian dollar", BRL: "Brazilian real", CAD: "Canadian dollar",
  CHF: "Swiss franc", CNY: "Chinese yuan", CZK: "Czech koruna",
  DKK: "Danish krone", EUR: "Euro", GBP: "British pound",
  HKD: "Hong Kong dollar", HUF: "Hungarian forint", IDR: "Indonesian rupiah",
  ILS: "Israeli new shekel", INR: "Indian rupee", ISK: "Icelandic króna",
  JPY: "Japanese yen", KRW: "South Korean won", MXN: "Mexican peso",
  MYR: "Malaysian ringgit", NOK: "Norwegian krone", NZD: "New Zealand dollar",
  PHP: "Philippine peso", PLN: "Polish złoty", RON: "Romanian leu",
  SEK: "Swedish krona", SGD: "Singapore dollar", THB: "Thai baht",
  TRY: "Turkish lira", USD: "US dollar", ZAR: "South African rand",
};

export function isDisplayCurrency(currency: string): currency is DisplayCurrency {
  return (DISPLAY_CURRENCIES as readonly string[]).includes(currency.toUpperCase());
}

/**
 * A stored string as a display currency, falling back to the dollar.
 *
 * The database column is a plain string and always was, so nothing stops a
 * hand-edited row or a settings file from an older build holding something
 * this list has never heard of. Every read goes through here so that the
 * failure is one unconverted screen rather than a rate lookup for a currency
 * that does not exist.
 */
export function asDisplayCurrency(currency: string | null | undefined): DisplayCurrency {
  if (!currency) return "USD";
  const c = currency.toUpperCase();
  return isDisplayCurrency(c) ? c : "USD";
}

/**
 * Currencies the ECB publishes a reference rate for.
 *
 * The display list minus the dollar, because the ECB quotes *against* the
 * dollar rather than publishing a rate for it. Keeping the two in step by
 * construction is deliberate: the set of currencies a figure can be converted
 * into and the set it can be converted out of are the same set.
 */
export const FIAT: ReadonlySet<string> = new Set(
  DISPLAY_CURRENCIES.filter((c) => c !== "USD"),
);

/**
 * True when a figure in this currency has to be converted before the rest of
 * the app can treat it as dollars.
 *
 * A coin quote (BTC, ETH) answers true and is not in `FIAT`: its rate comes
 * from Binance rather than the ECB, and the caller decides which to ask.
 */
export function needsRate(currency: string): boolean {
  return !STABLES.has(currency.toUpperCase());
}

/**
 * Fiat, including the one the ECB quotes *against*.
 *
 * `FIAT` is "currencies with an ECB reference rate", which by construction
 * excludes USD — useful for deciding where a rate comes from, wrong for
 * deciding whether something is real-world money. Four call sites wanted the
 * second question and three of them wrote `FIAT.has(c) || c === "USD"` by hand.
 */
export function isFiat(currency: string): boolean {
  const c = currency.toUpperCase();
  return c === "USD" || FIAT.has(c);
}

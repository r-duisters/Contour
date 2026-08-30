"use client";

import { field } from "./field";

/**
 * Where prices come from — which is not a display question.
 *
 * These three fields spent their life under a "Display" heading, next to the
 * currency, because that is where the settings screen happened to begin. But
 * the currency decides how a number is *shown* and these decide where the
 * number *comes from*, and the difference matters to somebody wondering who
 * this app talks to: the answer was filed under presentation.
 *
 * Splitting them also lets the coin field say the thing it exists to say.
 * Beside a stock selector offering three providers, a missing coin selector
 * implied a choice nobody was being offered; under a heading about sources, a
 * single fixed option reads as the fact it is.
 */
export type PriceSourceValue = {
  equityProvider: string;
  equityApiKey: string;
};

export default function PriceSourceSettings({
  value, onChange,
}: {
  value: PriceSourceValue;
  onChange: (next: PriceSourceValue) => void;
}) {
  const set = <K extends keyof PriceSourceValue>(key: K, next: PriceSourceValue[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <>
      {/*
        A selector with one option, on purpose.
        ======================================

        Coins are priced by Binance and always have been, and the app never
        said so anywhere a person would look. The currency field above ends
        "Prices come from Binance in USDT", which answers it in passing while
        talking about something else; the field below offers three sources for
        shares, which quietly implies coins have a choice too.

        So: the same shape as its neighbour, disabled, saying the one thing it
        has to say. A disabled control that states a fact reads as a fact. The
        absence of a control leaves a person guessing, and guessing here means
        wondering which exchange has been asked about their holdings — which
        is exactly the question the Privacy section then answers.
      */}
      <label className="block text-sm">
        <span className="text-neutral-400">Coin price source</span>
        <select className={`mt-1 w-full ${field()} opacity-70`} value="binance" disabled>
          <option value="binance">Binance (no key needed)</option>
        </select>
        <p className="text-xs text-neutral-500 mt-1">
          The only source for coins. Public prices, no account.
        </p>
      </label>
      <label className="block text-sm">
        <span className="text-neutral-400">Stock / ETF price source</span>
        <select
          className={`mt-1 w-full ${field()}`}
          value={value.equityProvider}
          onChange={(e) => set("equityProvider", e.target.value)}
        >
          <option value="yahoo">Yahoo Finance (no key needed)</option>
          <option value="twelvedata">Twelve Data (free key, 800/day)</option>
          <option value="alphavantage">Alpha Vantage (free key, 25/day)</option>
        </select>
      </label>
      {value.equityProvider !== "yahoo" && (
        <label className="block text-sm">
          <span className="text-neutral-400">API key</span>
          <input
            type="password"
            className={`mt-1 w-full ${field()}`}
            value={value.equityApiKey}
            onChange={(e) => set("equityApiKey", e.target.value)}
            placeholder={
              value.equityProvider === "twelvedata" ? "twelvedata.com key" : "alphavantage.co key"
            }
          />
        </label>
      )}
    </>
  );
}

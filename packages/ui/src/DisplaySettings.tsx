"use client";

import { type DisplayCurrency } from "@/lib/currencies";
import { field } from "./field";
import CurrencyField from "./CurrencyField";

/**
 * The half of Settings that both builds have.
 *
 * Everything else on the web settings screen is a server mechanism — Home
 * Assistant, web-push, passkeys, the password, logging out — and none of it
 * exists inside an APK. These three fields are plain stored preferences that
 * `DataClient` already carries, so they are the settings a device can offer.
 *
 * "Ask for every coin price" was here for one build and has moved to Privacy.
 * It looked like a display setting because it sits beside the price fields,
 * but it changes what an outside company is told and nothing about what is
 * shown — and a person looking for it would look under Privacy.
 *
 * Controlled and stateless on purpose. The web screen saves these alongside
 * its Home Assistant fields in one request and must keep owning that; the
 * device screen saves only these. Sharing the markup rather than copying it
 * is `BRAND.md`'s rule — a second local copy is a bug, not a variation — and
 * the two screens would otherwise drift on a currency list that is already
 * thirty entries long.
 */
export type DisplaySettingsValue = {
  displayCurrency: DisplayCurrency;
  equityProvider: string;
  equityApiKey: string;
};

export default function DisplaySettings({
  value,
  onChange,
}: {
  value: DisplaySettingsValue;
  onChange: (next: DisplaySettingsValue) => void;
}) {
  const set = <K extends keyof DisplaySettingsValue>(key: K, next: DisplaySettingsValue[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <>
      <CurrencyField
        value={value.displayCurrency}
        onChange={(c) => set("displayCurrency", c)}
        hint="Save to apply."
      />
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

"use client";

import { DISPLAY_CURRENCIES, CURRENCY_NAMES, type DisplayCurrency } from "@/lib/currencies";
import { field } from "./field";

/**
 * The half of Settings that both builds have.
 *
 * Everything else on the web settings screen is a server mechanism — Home
 * Assistant, web-push, passkeys, the password, logging out — and none of it
 * exists inside an APK. These three fields are plain stored preferences that
 * `DataClient` already carries, so they are the settings a device can offer.
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
      <label className="block text-sm">
        <span className="text-neutral-400">Portfolio currency</span>
        <select
          className={`mt-1 w-full ${field()}`}
          value={value.displayCurrency}
          onChange={(e) => set("displayCurrency", e.target.value as DisplayCurrency)}
        >
          {DISPLAY_CURRENCIES.map((c) => (
            <option key={c} value={c}>{c} — {CURRENCY_NAMES[c]}</option>
          ))}
        </select>
        <span className="text-xs text-neutral-500">
          Prices come from Binance in USDT. Every other currency converts at the live
          ECB reference rate, published each weekday afternoon. Save to apply.
        </span>
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

"use client";

import { type DisplayCurrency } from "@/lib/currencies";
import { field } from "./field";
import CurrencyField from "./CurrencyField";
import Switch from "./Switch";

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
  privateCoinPrices: boolean;
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
      {/*
        Here rather than in a Security section, because both builds show this
        component and only the web build has one. It is also a display-layer
        question in the sense that matters: it changes what an outside company
        is told, and nothing about what the app computes.
      */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm">Ask for every coin price</div>
          {/*
            The number is in the copy on purpose. "More private" is a claim; 26
            KB is a fact somebody on a metered plan can weigh — and half-hourly
            alert checks make it about 1.2 MB a day, which is the part they
            would otherwise discover from a bill.
          */}
          <p className="text-xs text-neutral-500 mt-0.5">
            Binance is asked for the whole market instead of your coins, so it
            never learns what you hold. About 26 KB a refresh rather than a few
            hundred bytes. Shares are unaffected — no provider publishes every
            one.
          </p>
        </div>
        <Switch
          checked={value.privateCoinPrices}
          onChange={(next) => set("privateCoinPrices", next)}
          label="Ask for every coin price"
        />
      </div>
      <CurrencyField
        value={value.displayCurrency}
        onChange={(c) => set("displayCurrency", c)}
        hint="Save to apply."
      />
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

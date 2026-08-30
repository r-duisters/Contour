"use client";

import { type DisplayCurrency } from "@/lib/currencies";
import CurrencyField from "./CurrencyField";

/**
 * The half of Settings that both builds have.
 *
 * Everything else on the web settings screen is a server mechanism — Home
 * Assistant, web-push, passkeys, the password, logging out — and none of it
 * exists inside an APK. These three fields are plain stored preferences that
 * `DataClient` already carries, so they are the settings a device can offer.
 *
 * One field now, and that is the point of the section rather than a shortfall.
 * "Ask for every coin price" left for Privacy and the two price-source fields
 * left for `PriceSourceSettings`, because neither decided how anything was
 * *shown* — one decided what an exchange is told and the others decided where
 * a number comes from. What is left is the only question here that is really
 * about display: which currency to read the portfolio in.
 *
 * Controlled and stateless on purpose. The web screen saves this alongside its
 * own fields in one request and must keep owning that; the device screen saves
 * fewer. Sharing the markup rather than copying it is `BRAND.md`'s rule — a
 * second local copy is a bug, not a variation — and the two screens would
 * otherwise drift on a currency list that is already thirty entries long.
 */
export type DisplaySettingsValue = {
  displayCurrency: DisplayCurrency;
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
    </>
  );
}

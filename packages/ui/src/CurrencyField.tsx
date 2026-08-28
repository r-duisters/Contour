"use client";

import { DISPLAY_CURRENCIES, CURRENCY_NAMES, type DisplayCurrency } from "@/lib/currencies";
import { field } from "./field";

/**
 * The currency everything is shown in.
 *
 * Its own component because three screens ask for it — web settings, the
 * device's settings, and the first-run setup — and the list is thirty entries
 * long. `BRAND.md`: a second local copy is a bug, not a variation.
 *
 * The note below the control is part of it, not decoration. Someone choosing
 * yen needs to know the prices are still Binance's USDT ones converted at an
 * ECB rate, or the figures look wrong rather than converted.
 */
export default function CurrencyField({
  value,
  onChange,
  label = "Portfolio currency",
  hint,
}: {
  value: DisplayCurrency;
  onChange: (next: DisplayCurrency) => void;
  label?: string;
  /** Appended to the note. Settings adds "Save to apply."; setup applies at once. */
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-400">{label}</span>
      <select
        className={`mt-1 w-full ${field()}`}
        value={value}
        onChange={(e) => onChange(e.target.value as DisplayCurrency)}
      >
        {DISPLAY_CURRENCIES.map((c) => (
          <option key={c} value={c}>{c} — {CURRENCY_NAMES[c]}</option>
        ))}
      </select>
      <span className="text-xs text-neutral-500">
        Prices come from Binance in USDT. Every other currency converts at the live
        ECB reference rate, published each weekday afternoon.{hint ? ` ${hint}` : ""}
      </span>
    </label>
  );
}

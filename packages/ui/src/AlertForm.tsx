"use client";

import { useState } from "react";
import Button from "./Button";
import { field } from "./field";
import { alertFields, type AlertDraft } from "./alert-fields";
import { priceFieldValue } from "@/lib/display";
import type { NewAlertInput } from "@/data/client/data-client";

/**
 * "Tell me when this crosses a price", on an asset's own page.
 *
 * Price targets only, which is a decision rather than a first instalment: the
 * indicator alerts are Bitcoin-specific — the risk metric's curves are fitted
 * to BTC and match TradingView only there — so offering them per-asset would
 * invite alerts that cannot mean anything. The alerts page keeps the full
 * form.
 *
 * The kind is passed in rather than read from the ticker. `assetType` may be
 * null while the page is still working out what it is looking at, and the
 * submit says so instead of guessing; guessing is how `AMD` becomes `AMDUSDT`
 * and an alert is priced against an unrelated token.
 */
export default function AlertForm({
  symbol,
  assetType,
  livePrice,
  onSubmit,
}: {
  symbol: string;
  assetType: "crypto" | "equity" | null;
  /** Prefills the box, so a target starts from where the asset actually is. */
  livePrice?: number | null;
  onSubmit: (alert: NewAlertInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AlertDraft>({
    direction: "above",
    // Rounded, because a target of 399.8797560766 is a price nobody typed and
    // nobody wants to edit around.
    price: livePrice ? priceFieldValue(livePrice) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit() {
    const result = alertFields(symbol, assetType, draft);
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setSaving(true);
    try {
      const { ok: _ok, ...alert } = result;
      await onSubmit(alert);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <p className="text-sm text-neutral-400">
        Watching {symbol}. It is checked when you open the app, and sometimes in
        the background when Android allows.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          aria-label="Direction"
          className={field()}
          value={draft.direction}
          onChange={(e) => setDraft({ ...draft, direction: e.target.value as "above" | "below" })}
        >
          <option value="above">Rises above</option>
          <option value="below">Falls below</option>
        </select>
        <input
          aria-label="Target price"
          className={field("w-32")}
          value={draft.price}
          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          inputMode="decimal"
          placeholder="Price"
        />
        <Button onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Alert me"}
        </Button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* The honest limit, in the same words the alerts screen uses. A target
          hit and reverted while the app was shut is a target you were not
          told about, and saying so here costs nothing. */}
      <p className="text-xs text-neutral-500">
        One-shot: the alert turns itself off once it fires. A price hit and
        reverted overnight can be missed.
      </p>
    </div>
  );
}

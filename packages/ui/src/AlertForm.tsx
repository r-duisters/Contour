"use client";

import { useState } from "react";
import Button from "./Button";
import Switch from "./Switch";
import { field } from "./field";
import { alertFields, type AlertDraft } from "./alert-fields";
import { priceFieldValue } from "@/lib/price-format";
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
    // One-shot by default, which is what a price target has always done.
    repeat: false,
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

      {/*
        One-shot or standing, said as the two things they are.
        =====================================================

        This was one-shot with no say in it, and a line of prose explaining
        that. It is right for "tell me when it gets there" and wrong for "tell
        me whenever it is there" — a level somebody watches for weeks had to be
        made again after every crossing.

        A switch rather than two radio buttons: it is one question with a
        default, and the label carries the consequence rather than a noun.
      */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">Keep watching after it fires</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {draft.repeat
              ? "Stays on, and can tell you again — at most once a day."
              : "Turns itself off the first time it fires."}
          </p>
        </div>
        <Switch
          checked={draft.repeat}
          onChange={(next) => setDraft({ ...draft, repeat: next })}
          label="Keep watching after it fires"
        />
      </div>

      {/* The honest limit, in the same words the alerts screen uses. A price
          hit and reverted while the app was shut is one you were not told
          about, and saying so here costs nothing. */}
      <p className="text-xs text-neutral-500">
        Checked when you open the app, and every half hour in the background
        when Android allows it. A price hit and reverted between checks can be
        missed.
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import Button from "./Button";
import { field } from "./field";
import { DEFAULT_MOVE_THRESHOLD } from "./move-threshold";
import type { NewAlertInput } from "@/data/client/data-client";

/**
 * The two rules no asset page can make, because they name no asset.
 *
 * Every other alert is created from the thing it watches — you are looking at
 * Ethereum, you say "tell me at €4,000". These two are about the portfolio, so
 * there is no page to make them from, and before this they were a pair of
 * switches sitting above the list. That was the whole confusion: one screen
 * with two idioms, where the same rule appeared as a switch *and* as a row,
 * and the two could disagree about whether it was on.
 *
 * So the switches are gone and this is a form. Rows are the truth; this only
 * creates them, and the row's own controls pause and delete as they do for
 * every other kind.
 *
 * **The two are easy to confuse and the wording works to prevent it.** "The
 * whole portfolio" fires on the total — which is bounded by its largest mover,
 * so it is a question about wealth. "Each holding" fires per asset, and is
 * dominated by whichever position is smallest. The defaults differ for the
 * same reason: 3% of a portfolio is a notable day, 3% of one asset is a
 * Tuesday.
 */
const DEFAULTS = { portfolio_move: 3, pct_move: DEFAULT_MOVE_THRESHOLD } as const;

export default function PortfolioAlertForm({
  portfolioId,
  onSubmit,
}: {
  portfolioId: string | null;
  onSubmit: (alert: NewAlertInput) => Promise<void>;
}) {
  const [kind, setKind] = useState<"portfolio_move" | "pct_move">("portfolio_move");
  const [pct, setPct] = useState(String(DEFAULTS.portfolio_move));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function choose(next: "portfolio_move" | "pct_move") {
    setKind(next);
    // Follow the default when the box still holds the other one's, so the
    // number moves with the meaning rather than staying behind as a figure
    // chosen for a different question.
    if (pct === String(DEFAULTS[kind])) setPct(String(DEFAULTS[next]));
  }

  async function submit() {
    if (!portfolioId) { setError("Add a portfolio first — there is nothing to watch yet."); return; }
    const threshold = Number(pct.replace(",", "."));
    if (!Number.isFinite(threshold) || threshold <= 0) {
      setError("Enter a percentage above zero.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit({ kind, portfolioId, threshold, repeat: true });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <p className="text-sm text-neutral-400">
        Added. It is checked when you open the app, and every half hour in the
        background when Android allows.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="text-neutral-400">Watch</span>
        <select
          aria-label="What to watch"
          className={`mt-1 w-full ${field()}`}
          value={kind}
          onChange={(e) => choose(e.target.value as "portfolio_move" | "pct_move")}
        >
          <option value="portfolio_move">The whole portfolio, added up</option>
          <option value="pct_move">Each holding, separately</option>
        </select>
      </label>

      <p className="text-xs text-neutral-500 max-w-prose">
        {kind === "portfolio_move"
          ? "One notification when everything you hold, added up, rises or falls by more than this in a day. Cash is left out — it does not move."
          : "One notification a day per holding that moves by more than this — including anything bought after this was set."}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-neutral-400">Moves more than</span>
        <input
          aria-label="Move threshold, percent"
          className={field("w-20")}
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          inputMode="decimal"
        />
        <span className="text-xs text-neutral-500">% in a day</span>
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

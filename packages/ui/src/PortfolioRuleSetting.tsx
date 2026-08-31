"use client";

import { useEffect, useState } from "react";
import { useDataClient } from "@/data/client/context";
import Switch from "./Switch";
import { field } from "./field";
import { requestNotifications } from "./device-notifications";

/**
 * A portfolio-scoped threshold rule, and the two controls that are one.
 *
 * `DailyMoveSetting` and `PortfolioMoveSetting` differ in the kind they store
 * and in every word they say, and in nothing else: both find the single
 * portfolio-scoped rule of their kind, both replace it on a change, both
 * feature-detect the same three optional methods. Two files of this length,
 * alike except for their strings, is how two controls start behaving
 * differently for no reason anybody chose.
 *
 * It was called "big moves", which is how somebody describes the feature to a
 * friend rather than what a tool calls it. The app already has one alert kind
 * with a proper name — a price target — and this is the other one, so it takes
 * a name of the same register. "Daily move" also says the two things the old
 * label left out: what is measured (a move) and over what (a day).
 *
 * One stored rule: a `pct_move` alert naming a portfolio and no symbol, which
 * `expandRules` turns into one check per holding at evaluation time. That
 * indirection is the point — something bought next week is covered by a rule
 * written today, and nothing has to be re-saved when the portfolio changes.
 *
 * There is no update on the interface, so a changed threshold is a delete and
 * a create. That is honest about what the row is: a rule with a different
 * number in it is a different rule, and the dedupe marks keyed to the old id
 * should not survive the change — otherwise a threshold lowered this morning
 * stays quiet until tomorrow.
 *
 * Feature-detected end to end. `listAlerts`, `createAlert` and `deleteAlert`
 * are all optional on `DataClient`, so a build without them draws nothing
 * rather than a control that cannot work.
 */
export type PortfolioRuleCopy = {
  /** The stored kind. Both are portfolio-scoped rules with a threshold. */
  kind: "pct_move" | "portfolio_move";
  title: string;
  description: string;
  /** What follows the number in the field, e.g. "% in a day". */
  unit: string;
  defaultThreshold: number;
  /** Said after turning it on, with the chosen figure. */
  confirm: (value: number) => string;
  /** Said after turning it off. */
  offMessage: string;
};

export default function PortfolioRuleSetting({ copy }: { copy: PortfolioRuleCopy }) {
  const client = useDataClient();
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(String(copy.defaultThreshold));
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline rather than a `useCallback` the effect then calls: the lint rule
  // reads that shape as a synchronous setState in an effect, and this file is
  // not the place to argue with it. The mutations below update their own state
  // directly, so nothing needs to re-run this.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [alerts, portfolios] = await Promise.all([
        client.listAlerts?.().catch(() => []) ?? [],
        client.listPortfolios().catch(() => []),
      ]);
      if (cancelled) return;
      setPortfolioId(portfolios[0]?.id ?? null);
      const rule = alerts.find((a) => a.kind === copy.kind && !a.symbol);
      setRuleId(rule?.id ?? null);
      const stored = rule?.params?.threshold;
      if (typeof stored === "number") setThreshold(String(stored));
    })();
    return () => { cancelled = true; };
  }, [client, copy.kind]);

  async function turnOn(value: number) {
    if (!portfolioId) {
      setMsg("Add a portfolio first — there is nothing to watch yet.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // Permission before the rule, so a rule that cannot notify is never
      // left looking as though it works.
      const permission = await requestNotifications();
      if (permission === "denied") {
        setMsg("Android refused notification permission, so nothing would arrive.");
        return;
      }
      if (ruleId) await client.deleteAlert?.(ruleId);
      const made = await client.createAlert?.({ kind: copy.kind, portfolioId, threshold: value });
      setRuleId(made?.id ?? null);
      setMsg(copy.confirm(value));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!ruleId) return;
    setBusy(true);
    try {
      await client.deleteAlert?.(ruleId);
      setRuleId(null);
      setMsg(copy.offMessage);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not turn that off.");
    } finally {
      setBusy(false);
    }
  }

  if (!client.listAlerts || !client.createAlert || !client.deleteAlert) return null;

  const parsed = Number(threshold);
  const valid = Number.isFinite(parsed) && parsed > 0;

  return (
    <div className="mt-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">{copy.title}</p>
          <p className="text-xs text-neutral-500 mt-0.5">{copy.description}</p>
        </div>
        <Switch
          checked={ruleId !== null}
          onChange={(next) => void (next ? turnOn(valid ? parsed : copy.defaultThreshold) : turnOff())}
          label={copy.title}
        />
      </div>

      {ruleId !== null && (
        <div className="flex items-center gap-2 mt-3">
          <input
            className={`${field()} w-20`}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            inputMode="decimal"
            aria-label="Move threshold, percent"
          />
          <span className="text-xs text-neutral-500">{copy.unit}</span>
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => void turnOn(parsed)}
            className="text-xs text-blue-500 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-neutral-400 mt-2">{msg}</p>}
    </div>
  );
}

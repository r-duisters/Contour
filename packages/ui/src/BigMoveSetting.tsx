"use client";

import { useEffect, useState } from "react";
import { useDataClient } from "@/data/client/context";
import Switch from "./Switch";
import { field } from "./field";
import { DEFAULT_MOVE_THRESHOLD } from "./move-threshold";
import { requestNotifications } from "./device-notifications";

/**
 * The switch the setup flow promised could be changed here.
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
export default function BigMoveSetting() {
  const client = useDataClient();
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(String(DEFAULT_MOVE_THRESHOLD));
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
      const rule = alerts.find((a) => a.kind === "pct_move" && !a.symbol);
      setRuleId(rule?.id ?? null);
      const stored = rule?.params?.threshold;
      if (typeof stored === "number") setThreshold(String(stored));
    })();
    return () => { cancelled = true; };
  }, [client]);

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
      const made = await client.createAlert?.({ kind: "pct_move", portfolioId, threshold: value });
      setRuleId(made?.id ?? null);
      setMsg(`Watching for moves over ${value}%.`);
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
      setMsg("Turned off. Alerts you set on an asset still fire.");
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
          <p className="text-sm">Tell me about big moves</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            One notification a day per holding, when it rises or falls by more than
            the figure below. Coins and shares both.
          </p>
        </div>
        <Switch
          checked={ruleId !== null}
          onChange={(next) => void (next ? turnOn(valid ? parsed : DEFAULT_MOVE_THRESHOLD) : turnOff())}
          label="Tell me about big moves"
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
          <span className="text-xs text-neutral-500">% in a day</span>
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

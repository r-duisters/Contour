"use client";

import { useEffect, useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import type { AlertSummary } from "@/data/client/data-client";
import PageLabel from "@/components/PageLabel";
import EmptyState from "@/components/EmptyState";
import LastChecked from "@/components/LastChecked";
import SubHeading from "@/components/SubHeading";
import BigMoveSetting from "@/components/BigMoveSetting";
import Switch from "@/components/Switch";
import Button from "@/components/Button";
import { isBatteryExempt, requestBatteryExemption } from "@/components/device-notifications";
import { deleteButton } from "@/components/icon-button";
import { KEYS, readKey } from "@/lib/storage-keys";

/**
 * The alerts this phone is watching.
 *
 * No create form: they are made from an asset's own page, where the live price
 * is on screen to aim at, and from the setup flow's one switch. A second form
 * here would be a second place for the same decision to drift.
 *
 * **Rows, not a line of text each.** Every alert answers three questions — what
 * it watches, what would fire it, and whether it is on — and they were one
 * truncating line with a bin at the end. The subject leads on its own line at
 * full size, the condition sits under it, and the switch is the control: a row
 * whose state is the thing you came to change.
 *
 * **Paused is not deleted, and that is the point.** A target you are about to
 * trip deliberately, or a swing rule during a loud week, is worth silencing for
 * a few days rather than rebuilding afterwards. The evaluators already skip a
 * disabled row, so this needed no new logic anywhere below it.
 */
export default function AlertsPage() {
  const client = useDataClient();
  const [alerts, setAlerts] = useState<AlertSummary[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Null while unknown or where the question does not apply. Only `false` —
   * Android saying it is holding background work back — draws anything.
   */
  const [batteryExempt, setBatteryExempt] = useState<boolean | null>(null);
  /**
   * What the background runner reports about itself. Null while unknown, or
   * where there is no runner to ask — a browser, or a plugin that is not
   * registered yet on a first launch.
   */
  const [runner, setRunner] = useState<RunnerStatus | null>(null);

  // Inlined rather than a `void load()` in the effect: the lint rule cannot
  // see through a callback to know the assignment happens after an await, and
  // a lint budget is only worth having if it is not widened for shapes that
  // are already used elsewhere.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [listed, portfolios] = await Promise.all([
        client.listAlerts?.().catch(() => []) ?? [],
        // A portfolio-wide rule names an id, and an id is not something to
        // show anybody. Without this the row would read "portfolio ?".
        client.listPortfolios().catch(() => []),
      ]);
      if (cancelled) return;
      setAlerts(listed);
      setNames(Object.fromEntries(portfolios.map((p) => [p.id, p.name])));
      const raw = readKey(KEYS.alertsLastChecked);
      setChecked(raw ? Number(JSON.parse(raw)) : null);
      // Asked here as well as during setup, because "Not now" there left no
      // way back: the one screen about alerts is where somebody goes when
      // they stop arriving.
      const exempt = await isBatteryExempt();
      if (!cancelled) setBatteryExempt(exempt);
      const status = await runnerStatus();
      if (!cancelled) setRunner(status);
    })();
    return () => { cancelled = true; };
  }, [client]);

  async function toggle(alert: AlertSummary, enabled: boolean) {
    setBusy(alert.id);
    try {
      const updated = await client.setAlertEnabled?.(alert.id, enabled);
      if (updated) setAlerts((cur) => cur?.map((a) => (a.id === alert.id ? updated : a)) ?? cur);
    } catch {
      // Left as it was rather than flipped optimistically: a switch that moves
      // and then silently means nothing is worse than one that did not move.
    } finally {
      setBusy(null);
    }
  }

  async function remove(alert: AlertSummary) {
    // Asked for, as the ellipsis in the button's name promises — and because
    // this sits a thumb's width from the switch, where the two outcomes are
    // "quiet for a while" and "gone".
    const what = subject(alert, names);
    if (!window.confirm(`Delete the alert on ${what}?`)) return;
    const id = alert.id;
    setBusy(id);
    try {
      await client.deleteAlert?.(id);
      setAlerts((cur) => cur?.filter((a) => a.id !== id) ?? cur);
    } catch {
      // Same: the row stays until the store agrees it is gone.
    } finally {
      setBusy(null);
    }
  }

  const rows = alerts ?? [];
  const watching = rows.filter((a) => a.enabled);
  const paused = rows.filter((a) => !a.enabled);

  return (
    <main className="min-h-screen px-4 py-5 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <PageLabel icon={Bell}>Alerts</PageLabel>
      </div>

      <div className="mb-6">
        <LastChecked
          at={checked}
          note="Checked when you open the app, and every half hour in the background."
        />
        {/*
          What the background half has been doing, which the line above cannot
          say: it reports this app's own foreground checks, from localStorage,
          and the runner keeps its record in CapacitorKV — a different store in
          a different runtime. For as long as both existed, "last checked" was
          only ever half the answer, and the half that Android might silently
          never run was the invisible one.
        */}
        {runner && (
          <p className="text-xs text-neutral-500 mt-1">
            {runner.lastRun
              ? <>In the background: last ran {sinceWords(runner.lastRun)}, watching{" "}
                  {runner.ruleCount} {runner.ruleCount === 1 ? "check" : "checks"}
                  {runner.notified > 0 && <> · {runner.notified} sent that time</>}.</>
              : <span className="text-amber-500">
                  In the background: has not run yet. Android schedules it when it
                  chooses to, and a new install may wait a while for the first one.
                </span>}
          </p>
        )}
        {runner?.lastError && (
          <p className="text-xs text-amber-500 mt-1">
            Last background attempt failed {sinceWords(runner.lastError.at)}: {runner.lastError.message}
          </p>
        )}

        {/*
          Only when Android says it is throttling this app. A button that
          cannot change anything is worse than no button, and on a phone that
          never had the restriction there is nothing to fix.
        */}
        {batteryExempt === false && (
          <div className="mt-2 flex items-start gap-2 flex-wrap">
            <p className="text-xs text-amber-500 flex-1 min-w-40">
              Android is holding background checks back to save battery, so the half-hourly
              check may be delayed for hours or skipped.
            </p>
            <Button
              variant="secondary"
              onClick={() => void (async () => {
                setBatteryExempt(await requestBatteryExemption());
              })()}
            >
              Allow background checks
            </Button>
          </div>
        )}
      </div>

      {/*
        The one rule that is not about a single asset, and so has nowhere to be
        made from.
        ======================================================================

        It lived in Settings, which is where the setup flow left it. But it is
        not a setting: it writes a `pct_move` row with no symbol, which is an
        alert — it appears in the list below, it can be paused there, and
        deleting it there turns this switch off. A control whose effect is a
        row in a list belongs beside the list.

        Every other rule is made from the asset it watches. This one names no
        asset on purpose, so there is no page to make it from, which is why it
        needs a home of its own here.
      */}
      <div className="mb-6 rounded-lg border border-neutral-800 p-3">
        <BigMoveSetting />
      </div>

      {alerts === null ? null : rows.length === 0 ? (
        <EmptyState>
          Nothing watched yet — open an asset and choose &ldquo;Alert me&rdquo;, or turn on
          big moves above.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {/*
            Split, because the two groups are read differently: the first is
            "what will reach me", the second is "what I have switched off and
            might want back". Mixed together, a paused row is just a row that
            looks slightly wrong.
          */}
          <Group title="Watching" alerts={watching} empty="Everything is paused.">
            {(a) => row(a)}
          </Group>
          {paused.length > 0 && (
            <Group title="Paused" alerts={paused} empty="">
              {(a) => row(a)}
            </Group>
          )}
        </div>
      )}

      <p className="text-xs text-neutral-500 mt-10 max-w-prose">
        Android treats the half-hourly schedule as a target rather than a promise, so a
        price hit and reverted between checks can still be missed. Opening the app always
        runs one. Indicator alerts need about 1,460 days of history to warm up and stay on
        the desktop.
      </p>
    </main>
  );

  function row(a: AlertSummary) {
    const p = a.params as { direction?: string; price?: number; threshold?: number };
    return (
      // `items-center`, so the switch and the bin sit on the row's own centre
      // line rather than each at the top of a two-line block, where they read
      // as floating beside the text instead of belonging to it.
      <li key={a.id} className={`flex items-center gap-3 py-3 ${a.enabled ? "" : "opacity-60"}`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm truncate">{subject(a, names)}</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {/* The mode is stated because it is a choice now. A target used
                to be one-shot with no say in it, so the word was a fact about
                the app; it is a fact about this alert. */}
            {a.kind === "price_target"
              ? `${p.direction === "below" ? "Falls below" : "Rises above"} ${p.price} · ${a.repeat ? "keeps watching" : "one-shot"}`
              : `Moves ±${p.threshold}% in a day${a.repeat ? "" : " · one-shot"}`}
          </p>
        </div>
        <Switch
          checked={a.enabled}
          onChange={(next) => void toggle(a, next)}
          label={`${a.enabled ? "Pause" : "Resume"} ${subject(a, names)}`}
        />
        <button
          onClick={() => void remove(a)}
          disabled={busy === a.id}
          aria-label={`Delete alert on ${subject(a, names)}…`}
          className={deleteButton()}
        >
          <Trash2 size={16} aria-hidden />
        </button>
      </li>
    );
  }
}

function Group({
  title, alerts, empty, children,
}: {
  title: string;
  alerts: AlertSummary[];
  empty: string;
  children: (a: AlertSummary) => React.ReactNode;
}) {
  return (
    <section>
      <SubHeading className="mb-1">{title}</SubHeading>
      {alerts.length === 0
        ? <EmptyState className="py-2">{empty}</EmptyState>
        : <ul className="divide-y divide-neutral-800">{alerts.map(children)}</ul>}
    </section>
  );
}

type RunnerStatus = {
  lastRun: number | null;
  lastError: { at: number; message: string } | null;
  ruleCount: number;
  notified: number;
};

/**
 * Ask the background runner what it has been doing.
 *
 * The only channel out of that runtime: `dispatchEvent` resolves with whatever
 * the runner passes to `resolve`. Absent on anything that is not a phone with
 * the plugin registered, which is why every failure answers null rather than
 * throwing — a diagnostic that breaks the screen it diagnoses is worse than no
 * diagnostic.
 */
async function runnerStatus(): Promise<RunnerStatus | null> {
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    return await BackgroundRunner.dispatchEvent<RunnerStatus>({
      label: "app.contour.standalone.alerts",
      event: "getStatus",
      details: {},
    });
  } catch {
    return null;
  }
}

/** "12 minutes ago", in the same words `LastChecked` uses. */
function sinceWords(at: number): string {
  const ago = Date.now() - at;
  const minutes = Math.floor(ago / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * What the alert watches, in words rather than in stored fields.
 *
 * A portfolio-scoped rule has no symbol — that is the shape that means "every
 * holding" — and this rendered a blank ticker for it, which is the row the
 * setup flow's switch creates. It says what the rule actually does instead,
 * and names the portfolio rather than showing its id.
 */
function subject(a: AlertSummary, names: Record<string, string>): string {
  if (a.symbol) return a.symbol;
  const name = a.portfolioId ? names[a.portfolioId] : undefined;
  return name ? `Everything in ${name}` : "Everything you own";
}

"use client";

import { useEffect, useState } from "react";
import { Bell, Plus, Trash2 } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import type { AlertSummary } from "@/data/client/data-client";
import PageLabel from "@/components/PageLabel";
import EmptyState from "@/components/EmptyState";
import LastChecked from "@/components/LastChecked";
import SubHeading from "@/components/SubHeading";
import PortfolioAlertForm from "@/components/PortfolioAlertForm";
import Sheet from "@/components/Sheet";
import Switch from "@/components/Switch";
import Button from "@/components/Button";
import { isBatteryExempt, requestBatteryExemption } from "@/components/device-notifications";
import { deleteButton, iconButton } from "@/components/icon-button";
import { alertCondition, alertSubject } from "@/components/alert-wording";
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
 * **One idiom, not two.** The two portfolio-wide rules used to be a pair of
 * switches above the list, and the list filtered them out so they would not
 * appear twice — a filter that only knew one of the two, so the other did
 * appear twice and the copy disagreed with itself. They are rows now like
 * everything else, and the `+` above makes them, because they are the only
 * rules with no asset page to be made from.
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
  /**
   * Which portfolio a new portfolio-wide rule would watch. The first, because
   * these rules are about "everything I own" and the app has no notion of
   * watching two portfolios at once — a picker here would be offering a choice
   * the alert kinds cannot express.
   */
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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
      setPortfolioId(portfolios[0]?.id ?? null);
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
    const what = alertSubject(alert.symbol, portfolioName(alert, names));
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

  /*
   * One list, grouped by what a rule watches rather than by its state.
   *
   * This page used to draw the portfolio-wide rules as switches above a list
   * of everything else, and filter them out of the list so they did not appear
   * twice. That filter only ever knew one of them, so `portfolio_move` did
   * appear twice — as a switch reading "off" and a row reading "on", because
   * the switch looks for its own kind and the store was handing back another.
   *
   * Two idioms on one screen is what made it unreadable, so there is one now:
   * every rule is a row, with the same pause and the same delete. Grouping by
   * subject rather than by state keeps the two portfolio rules adjacent, which
   * is where the confusion was — they are easy to mistake for each other and
   * they are only comparable side by side.
   */
  const rows = alerts ?? [];
  const portfolioRules = rows.filter((a) => !a.symbol);
  const assetRules = rows.filter((a) => a.symbol);

  return (
    <main className="min-h-screen px-4 py-5 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <PageLabel icon={Bell}>Alerts</PageLabel>
        {/*
          Only the two rules that have nowhere else to be made.
          =====================================================

          A price target or a per-asset move is made from the asset's own page,
          where the live price is on screen to aim at; a form here would be a
          second place for the same decision, and the two would drift. What is
          left is the pair that names no asset — and before this they had no
          creation affordance at all except a switch that also served as their
          only display.
        */}
        <button
          onClick={() => setAdding(true)}
          aria-label="Add a portfolio-wide alert"
          className={`${iconButton()} ml-auto`}
        >
          <Plus size={18} aria-hidden />
        </button>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Watch the portfolio">
        <PortfolioAlertForm
          portfolioId={portfolioId}
          onSubmit={async (alert) => {
            const made = await client.createAlert?.(alert);
            if (made) setAlerts((cur) => [made, ...(cur ?? [])]);
          }}
        />
      </Sheet>

      {/*
        The page in the order the two kinds of rule deserve.
        ==================================================

        This opened with the machinery — when the check last ran, whether
        Android is throttling it — and buried what is actually being watched
        below it. Reassurance about delivery matters, but it is the answer to a
        question somebody asks second. What they came for is the list.

        Two groups, by subject. Paused rows stay where they are, dimmed: a rule
        you switched off last week is still a rule about that asset, and moving
        it to the bottom of the page hid it from the only place you would look
        for it.
      */}
      {alerts === null ? null : rows.length === 0 ? (
        <EmptyState className="mb-8">
          None yet — open an asset and choose &ldquo;Alert me&rdquo;, or use + above to
          watch the whole portfolio.
        </EmptyState>
      ) : (
        <div className="space-y-8 mb-8">
          <Group title="Your portfolio" alerts={portfolioRules}>{(a) => row(a)}</Group>
          <Group title="Individual assets" alerts={assetRules}>{(a) => row(a)}</Group>
        </div>
      )}

      <section>
        <SubHeading className="mb-2">Checks</SubHeading>
        <div>
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
              check may be delayed for hours or skipped. Lifting it means finding Contour
              in Android&rsquo;s own battery list.
            </p>
            <Button
              variant="secondary"
              onClick={() => void (async () => {
                setBatteryExempt(await requestBatteryExemption());
              })()}
            >
              Open battery settings
            </Button>
          </div>
        )}
      </div>
      </section>

      <p className="text-xs text-neutral-500 mt-10 max-w-prose">
        Android treats the half-hourly schedule as a target rather than a promise, so a
        price hit and reverted between checks can still be missed. Opening the app always
        runs one. Indicator alerts need about 1,460 days of history to warm up and stay on
        the desktop.
      </p>
    </main>
  );

  function row(a: AlertSummary) {
    return (
      // `items-center`, so the switch and the bin sit on the row's own centre
      // line rather than each at the top of a two-line block, where they read
      // as floating beside the text instead of belonging to it.
      <li key={a.id} className={`flex items-center gap-3 py-3 ${a.enabled ? "" : "opacity-60"}`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm truncate">{alertSubject(a.symbol, portfolioName(a, names))}</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {alertCondition(a)}
          </p>
        </div>
        <Switch
          checked={a.enabled}
          onChange={(next) => void toggle(a, next)}
          label={`${a.enabled ? "Pause" : "Resume"} ${alertSubject(a.symbol, portfolioName(a, names))}`}
        />
        <button
          onClick={() => void remove(a)}
          disabled={busy === a.id}
          aria-label={`Delete alert on ${alertSubject(a.symbol, portfolioName(a, names))}…`}
          className={deleteButton()}
        >
          <Trash2 size={16} aria-hidden />
        </button>
      </li>
    );
  }
}

/**
 * A heading and its rows, or nothing at all.
 *
 * The empty case used to say something — "Everything is paused." — because the
 * two groups were "watching" and "paused" and an empty first group was a state
 * worth reporting. Grouped by subject instead, an empty group means the person
 * has never made that kind of rule, and a heading over a sentence explaining
 * its own absence is just noise on the way to the group that does have rows.
 */
function Group({
  title, alerts, children,
}: {
  title: string;
  alerts: AlertSummary[];
  children: (a: AlertSummary) => React.ReactNode;
}) {
  if (alerts.length === 0) return null;
  return (
    <section>
      <SubHeading className="mb-1">{title}</SubHeading>
      <ul className="divide-y divide-neutral-800">{alerts.map(children)}</ul>
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

/** The portfolio's name for a rule that names one, never its id. */
function portfolioName(a: AlertSummary, names: Record<string, string>): string | null {
  return a.portfolioId ? names[a.portfolioId] ?? null : null;
}

"use client";

import { useEffect, useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import type { AlertSummary } from "@/data/client/data-client";
import PageLabel from "@/components/PageLabel";
import EmptyState from "@/components/EmptyState";
import LastChecked from "@/components/LastChecked";
import SubHeading from "@/components/SubHeading";
import Switch from "@/components/Switch";
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

  async function remove(id: string) {
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
        <LastChecked at={checked} />
      </div>

      {alerts === null ? null : rows.length === 0 ? (
        <EmptyState>
          Nothing watched yet — open an asset and choose &ldquo;Alert me&rdquo;, or turn on
          big moves in Settings.
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
        Checked every time you open the app, and every half hour in the background when
        Android allows it — it treats that schedule as a target rather than a promise, so a
        price hit and reverted overnight can still be missed. Indicator alerts need about
        1,460 days of history to warm up and stay on the desktop.
      </p>
    </main>
  );

  function row(a: AlertSummary) {
    const p = a.params as { direction?: string; price?: number; threshold?: number };
    return (
      <li key={a.id} className={`flex items-start gap-3 py-3 ${a.enabled ? "" : "opacity-60"}`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm truncate">{subject(a, names)}</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {a.kind === "price_target"
              // "one-shot" and not "fired, paused": a target disables itself
              // when it fires, and pausing by hand leaves the identical row.
              ? `${p.direction === "below" ? "Falls below" : "Rises above"} ${p.price} · one-shot`
              : `Moves ±${p.threshold}% in a day`}
          </p>
        </div>
        <Switch
          checked={a.enabled}
          onChange={(next) => void toggle(a, next)}
          label={`${a.enabled ? "Pause" : "Resume"} ${subject(a, names)}`}
        />
        <button
          onClick={() => void remove(a.id)}
          disabled={busy === a.id}
          aria-label={`Delete alert on ${subject(a, names)}`}
          className="shrink-0 mt-0.5 text-neutral-700 hover:text-red-500 disabled:opacity-50 transition-colors"
        >
          <Trash2 size={14} aria-hidden />
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

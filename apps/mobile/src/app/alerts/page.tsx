"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import type { AlertSummary } from "@/data/client/data-client";
import PageLabel from "@/components/PageLabel";
import EmptyState from "@/components/EmptyState";
import LastChecked from "@/components/LastChecked";
import { KEYS, readKey } from "@/lib/storage-keys";

/**
 * The alerts this phone is watching.
 *
 * Reading and removing only: they are created from an asset's own page, where
 * the live price is on screen to aim at. A second create form here would be a
 * second place for the same decision to drift.
 *
 * The two kinds a phone can evaluate. The indicator alerts need 1,460 daily
 * bars to warm up and stay on the desktop, which the copy says rather than
 * leaving a reader to wonder where they went.
 */
export default function AlertsPage() {
  const client = useDataClient();
  const [alerts, setAlerts] = useState<AlertSummary[] | null>(null);
  const [checked, setChecked] = useState<number | null>(null);

  /**
   * Nothing is set before the first await. A build with no alerts derives its
   * empty list below rather than assigning one here, which would be a setState
   * in an effect body — a cascading render to say something already known from
   * the client's own shape.
   */
  const load = useCallback(async () => {
    const listed = await client.listAlerts?.().catch(() => []) ?? [];
    setAlerts(listed);
    const raw = readKey(KEYS.alertsLastChecked);
    setChecked(raw ? Number(JSON.parse(raw)) : null);
  }, [client]);

  // Inlined rather than `void load()`: the rule cannot see through a callback
  // to know the assignment happens after an await, and a lint budget is only
  // worth having if it is not widened for shapes that are already used.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listed = (await client.listAlerts?.().catch(() => [])) ?? [];
      if (cancelled) return;
      setAlerts(listed);
      const raw = readKey(KEYS.alertsLastChecked);
      setChecked(raw ? Number(JSON.parse(raw)) : null);
    })();
    return () => { cancelled = true; };
  }, [client]);

  async function remove(id: string) {
    await client.deleteAlert?.(id).catch(() => {});
    await load();
  }

  return (
    <main className="min-h-screen px-4 py-5 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <PageLabel icon={Bell}>Alerts</PageLabel>
      </div>

      <div className="mb-5">
        <LastChecked at={checked} />
      </div>

      {alerts === null ? null : alerts.length === 0 ? (
        <EmptyState>
          Nothing watched yet — open an asset and choose &ldquo;Alert me&rdquo;.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-neutral-800">
          {alerts.map((a) => {
            const p = a.params as { direction?: string; price?: number; threshold?: number };
            return (
              <li key={a.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">
                    <span className="font-mono">{a.symbol}</span>{" "}
                    {a.kind === "price_target"
                      ? `${p.direction === "below" ? "falls below" : "rises above"} ${p.price}`
                      : `moves ±${p.threshold}% in a day`}
                  </span>
                  <span className="block text-[11px] text-neutral-500">
                    {a.assetType === "equity" ? "Stock / ETF" : "Crypto"}
                    {a.kind === "price_target" && " · one-shot"}
                  </span>
                </span>
                <button
                  onClick={() => remove(a.id)}
                  aria-label={`Delete alert on ${a.symbol}`}
                  className="shrink-0 text-neutral-700 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-neutral-500 mt-8 max-w-prose">
        Checked every time you open the app. There is no server behind this build, so nothing
        checks while it is shut — a price hit and reverted overnight can be missed. Indicator
        alerts need about 1,460 days of history to warm up and stay on the desktop.
      </p>
    </main>
  );
}

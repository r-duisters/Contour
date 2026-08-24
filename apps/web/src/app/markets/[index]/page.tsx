"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import SubHeading from "@/components/SubHeading";
import Sparkline from "@/components/Sparkline";
import { useDataClient } from "@/data/client/context";
import type { IndexDetail } from "@/data/client/data-client";
import { percent } from "@/lib/display";
import { NotFoundError } from "@/data/errors";

/**
 * One exchange's index: what it is, where it sits in its own year, and the
 * companies in it.
 *
 * The figures at the top all come from the index's own chart metadata — the
 * venue's name for itself, its currency, its trading timezone, its 52-week
 * range, the first day Yahoo holds. Nothing on this half is asserted here.
 *
 * The members below are a fixed list, and the heading says so. Yahoo's
 * components module needs a crumb this app cannot get, so there is no feed to
 * rank membership from; every ticker was checked to resolve, but "these are
 * the ten largest today" is a claim nothing here can stand behind.
 */
export default function IndexPage({ params }: { params: Promise<{ index: string }> }) {
  const { index: slug } = use(params);
  const client = useDataClient();
  const [detail, setDetail] = useState<IndexDetail | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    client.getIndex(slug)
      .then((d) => { if (live) setDetail(d); })
      .catch((e) => {
        if (!live) return;
        if (e instanceof NotFoundError) setDetail(null);
        else setFailed(true);
      });
    return () => { live = false; };
  }, [client, slug]);

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-3xl mx-auto">
      <Link href="/markets" className="text-xs text-neutral-400 inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={14} aria-hidden />Markets
      </Link>

      {detail === undefined && !failed && <EmptyState>Loading…</EmptyState>}
      {failed && <EmptyState>Could not reach this index. Try again in a minute.</EmptyState>}
      {detail === null && <EmptyState>No index by that name.</EmptyState>}

      {detail && <IndexBody detail={detail} />}
    </main>
  );
}

function IndexBody({ detail }: { detail: IndexDetail }) {
  const { meta, points, changePct, constituents } = detail;
  const up = changePct >= 0;
  const day = meta.previousClose && meta.previousClose > 0
    ? ((meta.level - meta.previousClose) / meta.previousClose) * 100
    : null;

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold truncate">{meta.name}</h1>
          <p className="text-[11px] text-neutral-500">
            {[meta.exchange, meta.currency, meta.timezone].filter(Boolean).join(" · ")}
            {meta.since && <> · since {new Date(meta.since).getFullYear()}</>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-medium tabular-nums">{level(meta.level)}</div>
          {day !== null && (
            <div className={`text-xs tabular-nums ${day >= 0 ? "text-green-500" : "text-red-500"}`}>
              {percent(day)} <span className="text-neutral-500">today</span>
            </div>
          )}
        </div>
      </div>

      {points.length > 1 && (
        <div className="rounded-lg border border-neutral-800/60 bg-neutral-900/40 px-3 pt-3 pb-2 mb-6">
          <Sparkline points={points} up={up} height={96} />
          <div className="flex items-baseline justify-between mt-1">
            <span className={`text-xs tabular-nums ${up ? "text-green-500" : "text-red-500"}`}>
              {percent(changePct)}
            </span>
            <span className="text-[11px] text-neutral-500">30d</span>
          </div>
        </div>
      )}

      {meta.yearLow !== null && meta.yearHigh !== null && meta.yearHigh > meta.yearLow && (
        <section className="mb-8">
          <SubHeading className="mb-2">Its own year</SubHeading>
          <Band low={meta.yearLow} high={meta.yearHigh} at={meta.level} />
          {meta.dayLow !== null && meta.dayHigh !== null && (
            <p className="text-[11px] text-neutral-500 mt-2 tabular-nums">
              Today {level(meta.dayLow)} – {level(meta.dayHigh)}
            </p>
          )}
        </section>
      )}

      <section>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <SubHeading>Major members</SubHeading>
          {/* Said plainly rather than in a tooltip: the ranking is not live,
              and a reader who assumes it is would be reading a claim nobody
              made. */}
          <span className="text-[11px] text-neutral-500">fixed list, priced live</span>
        </div>
        {constituents.length === 0 ? (
          <EmptyState>Could not price any members just now.</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-800/60">
            {constituents.map((c) => (
              <li key={c.symbol}>
                <Link
                  href={`/portfolio/${encodeURIComponent(c.symbol)}?type=equity`}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{c.name}</span>
                    <span className="block text-[11px] text-neutral-500 tabular-nums truncate">
                      <span className="font-mono tracking-wider">{c.symbol}</span>
                      {c.currency && <> · {c.currency}</>}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm tabular-nums">{level(c.price)}</span>
                    <span className={`block text-[11px] tabular-nums ${
                      c.changePct >= 0 ? "text-green-500" : "text-red-500"
                    }`}>
                      {percent(c.changePct)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * Where the level sits between the year's low and high.
 *
 * An index level is a number without a scale — 1,106 means nothing until you
 * know the year ran 884 to 1,124. `BRAND.md` asks for the high and low
 * wherever an axis is hidden, and this is that rule at a section's size.
 */
function Band({ low, high, at }: { low: number; high: number; at: number }) {
  const pos = Math.min(100, Math.max(0, ((at - low) / (high - low)) * 100));
  return (
    <>
      <div className="relative h-1.5 rounded-full bg-neutral-800">
        <span
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-neutral-200"
          style={{ left: `${pos}%` }}
          aria-hidden
        />
      </div>
      <div className="flex justify-between text-[11px] text-neutral-500 tabular-nums mt-1.5">
        <span>{level(low)}</span>
        <span>{pos.toFixed(0)}% of the way up</span>
        <span>{level(high)}</span>
      </div>
    </>
  );
}

/**
 * An index level, or a share price in its own currency.
 *
 * Neither is the owner's money, so neither is masked and neither takes a
 * currency symbol — the currency is named beside it, and guessing a symbol for
 * GBp or JPY would be worse than naming it.
 */
function level(n: number): string {
  // Both digit counts move together. Setting a maximum below the minimum is a
  // RangeError, not a clamp, and it threw on every index over 1,000 — which
  // is most of them.
  const digits = Math.abs(n) >= 1000 ? 0 : 2;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import type { AssetInfo } from "@/lib/asset-info";

/**
 * What an asset is, how the market feels about it, and what is being written
 * about it. Loaded after the page has already answered the question it exists
 * for — the position — because none of this is worth delaying that.
 */
export default function AssetInfoPanel({
  symbol, assetType,
}: {
  symbol: string;
  assetType: "crypto" | "equity" | "cash";
}) {
  const client = useDataClient();
  const [info, setInfo] = useState<AssetInfo | null | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (assetType === "cash") { setInfo(null); return; }
    let cancelled = false;
    setInfo(undefined);
    // The client encodes the symbol itself, so this must not — a ticker with a
    // dot in it (equities have them) would otherwise arrive double-encoded.
    client.getAssetInfo(symbol, assetType)
      .then((d) => { if (!cancelled) setInfo(d); })
      .catch(() => { if (!cancelled) setInfo(null); });
    return () => { cancelled = true; };
  }, [client, symbol, assetType]);

  if (info === undefined) {
    return <div className="mt-8 h-24 rounded border border-neutral-800 bg-neutral-900/40 animate-pulse" />;
  }
  const empty = !info || (!info.about && !info.stats.length && !info.news.length && !info.sentiment);
  if (empty) return null;

  const about = info.about ?? "";
  const long = about.length > 240;

  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">About</h2>

      {info.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {info.tags.map((t) => (
            <span key={t} className="text-xs px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400">
              {t}
            </span>
          ))}
        </div>
      )}

      {about && (
        <p className="text-sm text-neutral-300 leading-relaxed">
          {long && !expanded ? `${about.slice(0, 240).trimEnd()}…` : about}
          {long && (
            <button onClick={() => setExpanded((v) => !v)} className="text-blue-400 ml-1 text-xs">
              {expanded ? "less" : "more"}
            </button>
          )}
        </p>
      )}

      {info.sentiment && <SentimentBar sentiment={info.sentiment} />}

      {info.stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {info.stats.map((s) => (
            <div key={s.label} className="bg-neutral-900 border border-neutral-800 rounded p-2">
              <div className="text-xs text-neutral-500">{s.label}</div>
              <div className="text-sm text-neutral-200">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {info.news.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">
            Headlines
          </h3>
          <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
            {info.news.map((n) => (
              <li key={n.link}>
                <a
                  href={n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-2 items-start py-2 text-sm text-neutral-300 hover:text-neutral-100"
                >
                  <span className="flex-1">
                    {n.title}
                    <span className="block text-xs text-neutral-600">
                      {[n.source, n.published ? relative(n.published) : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <ExternalLink size={12} className="mt-1 shrink-0 text-neutral-600" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {info.sources.length > 0 && (
        <p className="text-xs text-neutral-600">
          Background from {info.sources.join(", ")}. Not advice, and not checked against your position.
        </p>
      )}
    </section>
  );
}

/** Sentiment as a position on a line, because a number alone says little. */
function SentimentBar({ sentiment }: { sentiment: NonNullable<AssetInfo["sentiment"]> }) {
  const score = sentiment.score;
  const pos = score === null ? 50 : ((score + 1) / 2) * 100;
  const tone = score === null ? "text-neutral-300" : score > 0.15 ? "text-green-500" : score < -0.15 ? "text-red-500" : "text-neutral-300";
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded p-3">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-neutral-500">{sentiment.label}</span>
        <span className={`text-sm capitalize ${tone}`}>{sentiment.value}</span>
        <span className="flex-1" />
        {sentiment.detail && <span className="text-xs text-neutral-600">{sentiment.detail}</span>}
      </div>
      {score !== null && (
        <div className="relative h-1.5 mt-2 rounded-full bg-gradient-to-r from-red-900 via-neutral-700 to-green-900">
          <span
            className="absolute top-1/2 w-2 h-2 -mt-1 -ml-1 rounded-full bg-neutral-100"
            style={{ left: `${pos}%` }}
          />
        </div>
      )}
    </div>
  );
}

function relative(t: number): string {
  const hours = Math.round((Date.now() - t) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

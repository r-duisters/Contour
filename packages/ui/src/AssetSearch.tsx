"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import type { AssetHit } from "@/data/client/data-client";
import { useAssetHref } from "./routing";
import CoinIcon from "./CoinIcon";
import Sheet from "./Sheet";
import EmptyState from "./EmptyState";
import { field } from "./field";

/**
 * Find an asset and open it.
 *
 * Sits in the top right of the portfolio and markets screens, which are the
 * two places a person is already looking at assets. It does not add a
 * transaction itself: a result opens the asset page, which renders for
 * something unheld — that is what Markets already links into — and carries the
 * Add sheet. One flow to maintain rather than two forms that can disagree
 * about what a trade is.
 *
 * Only what the app can price is offered, so a result always leads to a page
 * with numbers on it. `searchAssets` decides that; see its note on why coins
 * come from Binance's list rather than from Yahoo, which spells them
 * differently and would produce a page nothing can look up.
 */
export default function AssetSearch() {
  const client = useDataClient();
  const assetHref = useAssetHref();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AssetHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // The sheet animates in; focusing during that frame scrolls the phone's
    // keyboard over a panel still moving.
    const id = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(id);
  }, [open]);

  // Derived, not stored: a query too short to search has no results by
  // definition, and clearing state for it would be a setState in an effect
  // body — a cascading render to express something already known from `query`.
  const tooShort = query.trim().length < 2;
  const shown = tooShort ? null : hits;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    let cancelled = false;
    // Typing is faster than a round trip. Without this every keystroke of
    // "ethereum" is a request, and the answers arrive in whatever order the
    // network settles them.
    const id = setTimeout(() => {
      client.searchAssets(q)
        .then((found) => { if (!cancelled) { setHits(found); setFailed(false); } })
        .catch(() => { if (!cancelled) { setHits([]); setFailed(true); } });
    }, 250);

    return () => { cancelled = true; clearTimeout(id); };
  }, [client, query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search for an asset"
        className="text-neutral-400 hover:text-neutral-200 transition-colors p-1 -m-1"
      >
        <Search size={18} aria-hidden />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Search">
        <div className="p-3 space-y-3">
          <input
            ref={input}
            className={`w-full ${field()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ticker or name — BTC, ASML, Vanguard"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />

          {failed && !tooShort && (
            <p className="text-xs text-amber-500">
              Could not reach the search. What you type is not sent anywhere else.
            </p>
          )}

          {shown !== null && shown.length === 0 && !failed && (
            <EmptyState className="py-4">
              Nothing this app can price matches that.
            </EmptyState>
          )}

          <ul className="divide-y divide-neutral-800">
            {(shown ?? []).map((hit) => (
              <li key={`${hit.assetType}:${hit.symbol}`}>
                <Link
                  href={assetHref(hit.symbol, hit.assetType)}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 py-2.5"
                >
                  <CoinIcon symbol={hit.symbol} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{hit.name}</span>
                    <span className="block text-xs text-neutral-500 truncate">
                      {hit.symbol}
                      {hit.exchange ? ` · ${hit.exchange}` : ""}
                    </span>
                  </span>
                  {/* The kind, because a ticker can exist in both worlds and
                      they are different assets that spell themselves alike. */}
                  <span className="text-xs text-neutral-500 shrink-0">
                    {hit.assetType === "crypto" ? "Crypto" : "Stock / ETF"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
    </>
  );
}

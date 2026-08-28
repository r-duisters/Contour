"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { money, quantity } from "@/lib/display";

/**
 * One transaction, in the row the rest of the app already uses.
 *
 * `BRAND.md` defines a single list row — icon, primary, figure, sub-line — and
 * every list of assets is that row at one of two densities. The trade log was
 * the one list that invented its own structure: a two-column grid whose six
 * parts were re-ordered with `order-*` to fit a phone, so one transaction took
 * three visual lines and the eye had to reassemble it. Reading down the left
 * edge gave date, then type, then price; down the right, value, quantity,
 * delete.
 *
 * The parts map onto the house row exactly. Direction takes the icon slot,
 * where colour says what a worded pill was saying; the primary line says what
 * happened; the sub-line says when and at what price; the figure is what it
 * came to, with the position it left behind beneath it.
 *
 * `ticker` is the only difference between the asset page's list and a ledger
 * of every asset at once. On an asset page the subject is the page itself and
 * repeating it in every row says nothing; in a mixed list it is the first
 * thing a reader needs. It is set in mono because it is an identifier — the
 * one part of a row that is, per `BRAND.md`.
 */
export type TransactionRowProps = {
  side: string;
  quantity: number;
  price: number;
  fee: number;
  time: number;
  /** Units held once this transaction settled. */
  positionAfter: number;
  /** What a sale made, net of its fee. Null for everything else. */
  realized: number | null;
  /** Shown only where the list mixes assets. */
  ticker?: string;
  onDelete?: () => void;
};

/** What a person calls it, rather than what the column is named. */
const VERB: Record<string, string> = {
  buy: "Bought",
  sell: "Sold",
  transfer_in: "Received",
  transfer_out: "Sent",
  income: "Income",
};

export default function TransactionRow({
  side, quantity: qty, price, fee, time, positionAfter, realized, ticker, onDelete,
}: TransactionRowProps) {
  const incoming = side === "buy" || side === "transfer_in" || side === "income";
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  const value = qty * price;
  // Income is cash attributed to a security: it moves no units, so "held
  // after" would repeat the line above and mean nothing new.
  const movesPosition = side !== "income";

  return (
    <li className="flex items-center gap-3 py-2.5 group">
      <span
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          incoming ? "bg-green-950 text-green-500" : "bg-red-950 text-red-500"
        }`}
      >
        <Icon size={15} aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">
          {/*
            No added tracking, unlike BRAND's `tracking-wider`. That spelling
            is for the ticker inside an 11px sub-line, where short tickers need
            the air; at the primary's 14px it opens a gap either side of a dot
            and `SHELL.AS` reads as "SHELL . AS".
            Mono still gives a period its own character cell, so some of that
            space is the typeface and not a setting — this is as close as it
            gets without giving up the mono that says "identifier".
          */}
          {ticker && <span className="font-mono">{ticker}</span>}
          {ticker && " · "}
          {VERB[side] ?? side.replace("_", " ")}
          {movesPosition && <> <span className="tabular-nums">{quantity(qty)}</span></>}
        </span>
        <span className="block text-[11px] text-neutral-500 tabular-nums truncate">
          {new Date(time).toLocaleDateString(undefined, {
            year: "numeric", month: "short", day: "numeric",
          })}
          {price > 0 && <> · {money(price)}</>}
          {fee > 0 && <> · fee {money(fee)}</>}
        </span>
      </span>

      <span className="text-right shrink-0">
        <span className="block text-sm font-medium tabular-nums tracking-tight">
          {realized !== null ? (
            // A sale is read for what it made, not for what it was worth.
            <span className={realized >= 0 ? "text-green-500" : "text-red-500"}>
              {realized >= 0 ? "+" : ""}{money(realized)}
            </span>
          ) : (
            <span className={incoming ? "text-neutral-100" : "text-neutral-400"}>
              {value > 0 ? money(value) : "—"}
            </span>
          )}
        </span>
        {movesPosition && (
          <span className="block text-[11px] text-neutral-500 tabular-nums">
            held {quantity(positionAfter)}
          </span>
        )}
      </span>

      {onDelete && (
        <button
          onClick={onDelete}
          aria-label="Delete transaction"
          className="shrink-0 text-neutral-700 hover:text-red-500 md:opacity-0
                     md:group-hover:opacity-100 transition-opacity"
        >
          <span className="sr-only">Delete</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      )}
    </li>
  );
}

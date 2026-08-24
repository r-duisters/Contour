/**
 * Whole-ledger checks, for the errors a per-row importer cannot see.
 *
 * `parseDeltaCsv` already reports rows it could not read and rows it could not
 * price. Both judge one line at a time, and the failures that actually bite
 * are invisible that way: a €17,103 purchase is a perfectly well-formed row.
 * It is only wrong relative to the balance it implies — and that balance only
 * exists once every other row has been read.
 *
 * The checks here are deliberately conservative. Each one fires only where a
 * ledger is internally impossible — money spent that was never received, an
 * asset sold that was never held — never merely unusual. A warning a person
 * learns to dismiss is worse than no warning, because it teaches them to
 * dismiss the next one too.
 *
 * Nothing here repairs anything. It has no way to know what the missing rows
 * said, and a synthesised deposit would turn a visible gap into an invisible
 * fiction.
 */

import { isFiat } from "./currencies";

/** The columns an audit reads. A superset of what both the parser and the store hold. */
export type AuditTx = {
  symbol: string;
  assetType: "crypto" | "equity" | "cash";
  side: string;
  quantity: number;
  price: number;
  fee: number;
  time: number;
  nativeCurrency?: string | null;
  nativePrice?: number | null;
  nativeFee?: number | null;
};

export type Finding =
  | {
      kind: "underfunded-currency";
      currency: string;
      /** How much more must have been deposited for the balance never to go negative. */
      shortfall: number;
      /** When the balance first reached its deepest point. */
      at: number;
    }
  | {
      kind: "inconsistent-cash-legs";
      currency: string;
      withLeg: number;
      total: number;
    }
  | {
      kind: "oversold-asset";
      symbol: string;
      /** How much more was sold than was ever acquired. */
      shortfall: number;
      at: number;
    };

/**
 * Below this, a negative balance is arithmetic rather than a missing row.
 * Prices and quantities arrive rounded, and a chain of them drifts.
 */
const CASH_EPSILON = 0.01;
const QTY_EPSILON = 1e-6;

/** A fiat row sits within this of its trade to count as that trade's cash leg. */
const LEG_WINDOW_MS = 2_000;

/**
 * A negative holding repaired inside this window is read as rows arriving out
 * of order, not as a row that is missing.
 */
const REORDER_WINDOW_MS = 24 * 60 * 60 * 1_000;

export function auditLedger(txs: AuditTx[]): Finding[] {
  const ordered = [...txs].sort((a, b) => a.time - b.time);
  return [
    ...underfundedCurrencies(ordered),
    ...inconsistentCashLegs(ordered),
    ...oversoldAssets(ordered),
  ];
}

/**
 * Replay every fiat movement and report any currency whose balance goes
 * negative.
 *
 * This is double entry from the trades themselves — deposits in, withdrawals
 * out, purchases debited, sales credited — rather than a sum of the fiat rows
 * the broker happened to export. That distinction is the point: a broker that
 * writes a fiat row for some trades and not others produces a "balance" that
 * is a sum over an arbitrary subset, and the cash legs are therefore skipped
 * here entirely (the trade beside each one already carries the same movement).
 *
 * The figure reported is the deepest overdraft, not the closing one. An
 * account that dips to −€4,000 in March and recovers by December was still
 * short €4,000 in March, and that is the deposit that is missing.
 */
function underfundedCurrencies(txs: AuditTx[]): Finding[] {
  const legTimes = cashLegTimes(txs);
  const balance = new Map<string, number>();
  const worst = new Map<string, { shortfall: number; at: number }>();

  for (const t of txs) {
    const currency = t.nativeCurrency;
    if (!currency || !isFiat(currency)) continue;

    let delta: number;
    if (t.assetType === "cash") {
      // A fiat row that sits beside a trade is that trade's own cash leg, and
      // the trade below already accounts for the movement. Counting both would
      // debit every purchase twice.
      if (legTimes.has(t.time)) continue;
      delta = t.side === "transfer_in" || t.side === "buy" ? t.quantity : -t.quantity;
    } else {
      const price = t.nativePrice ?? t.price;
      const fee = t.nativeFee ?? t.fee ?? 0;
      const gross = t.quantity * price;
      if (t.side === "buy") delta = -(gross + fee);
      else if (t.side === "sell") delta = gross - fee;
      else continue; // a transfer of the asset itself moves no money
    }

    const next = (balance.get(currency) ?? 0) + delta;
    balance.set(currency, next);

    const seen = worst.get(currency);
    if (next < -CASH_EPSILON && (!seen || next < -seen.shortfall)) {
      worst.set(currency, { shortfall: -next, at: t.time });
    }
  }

  return [...worst.entries()].map(([currency, w]): Finding => ({
    kind: "underfunded-currency",
    currency,
    shortfall: round(w.shortfall),
    at: w.at,
  }));
}

/**
 * Report a currency whose trades disagree about whether a fiat leg exists.
 *
 * All or none is fine: both are consistent records, and a reader can be told
 * which convention applies. A mixture is not, because any total drawn from the
 * fiat rows then covers an arbitrary subset of the trades — debits recorded
 * without their matching credits — and the resulting "cash balance" means
 * nothing at all.
 */
function inconsistentCashLegs(txs: AuditTx[]): Finding[] {
  const legTimes = cashLegTimes(txs);
  const tally = new Map<string, { withLeg: number; total: number }>();

  for (const t of txs) {
    if (t.assetType === "cash") continue;
    if (t.side !== "buy" && t.side !== "sell") continue;
    const currency = t.nativeCurrency;
    if (!currency || !isFiat(currency)) continue;
    const row = tally.get(currency) ?? { withLeg: 0, total: 0 };
    row.total += 1;
    if (legTimes.has(t.time)) row.withLeg += 1;
    tally.set(currency, row);
  }

  return [...tally.entries()]
    .filter(([, r]) => r.withLeg > 0 && r.withLeg < r.total)
    .map(([currency, r]): Finding => ({
      kind: "inconsistent-cash-legs", currency, withLeg: r.withLeg, total: r.total,
    }));
}

/**
 * Report an asset sold in greater quantity than was ever acquired.
 *
 * The cash-side failure with the sign flipped: a missing buy rather than a
 * missing deposit. A transfer in counts as an acquisition — coins moved from
 * another wallet were never bought here, but they are held, and selling them
 * is not an error.
 *
 * A dip that repairs itself within a day is ignored. Exports order rows by
 * something other than settlement, and a real one recorded a sale of 6,023
 * ALGO three minutes *before* the incoming transfer that supplied them: the
 * position nets to zero and nothing is missing, only the order is wrong. A
 * shortfall that outlives a day, or that the ledger never repairs at all, is a
 * different thing — that is a row nobody wrote.
 */
function oversoldAssets(txs: AuditTx[]): Finding[] {
  const held = new Map<string, number>();
  /** The open episode per symbol: when the position went negative, and how deep. */
  const open = new Map<string, { shortfall: number; at: number; since: number }>();
  const kept = new Map<string, { shortfall: number; at: number }>();

  const keep = (symbol: string, e: { shortfall: number; at: number }) => {
    const seen = kept.get(symbol);
    if (!seen || e.shortfall > seen.shortfall) kept.set(symbol, e);
  };

  for (const t of txs) {
    if (t.assetType === "cash") continue;
    const delta =
      t.side === "buy" || t.side === "transfer_in" ? t.quantity
      : t.side === "sell" || t.side === "transfer_out" ? -t.quantity
      : 0;
    if (delta === 0) continue;

    const next = (held.get(t.symbol) ?? 0) + delta;
    held.set(t.symbol, next);

    const episode = open.get(t.symbol);
    if (next < -QTY_EPSILON) {
      if (!episode) open.set(t.symbol, { shortfall: -next, at: t.time, since: t.time });
      else if (-next > episode.shortfall) {
        episode.shortfall = -next;
        episode.at = t.time;
      }
    } else if (episode) {
      // Repaired. Whether it counts depends on how long it stood.
      if (t.time - episode.since > REORDER_WINDOW_MS) {
        keep(t.symbol, { shortfall: episode.shortfall, at: episode.at });
      }
      open.delete(t.symbol);
    }
  }

  // Anything still open was never repaired at all.
  for (const [symbol, e] of open) keep(symbol, { shortfall: e.shortfall, at: e.at });

  return [...kept.entries()].map(([symbol, w]): Finding => ({
    kind: "oversold-asset", symbol, shortfall: w.shortfall, at: w.at,
  }));
}

/** Timestamps carrying a fiat row, so a trade can ask whether it has a cash leg. */
function cashLegTimes(txs: AuditTx[]): Set<number> {
  const out = new Set<number>();
  for (const t of txs) {
    if (t.assetType !== "cash") continue;
    if (!t.nativeCurrency || !isFiat(t.nativeCurrency)) continue;
    // Only a fiat row that shares a moment with a trade is a leg; a standalone
    // one is a real deposit or withdrawal.
    if (txs.some((o) => o.assetType !== "cash" && Math.abs(o.time - t.time) <= LEG_WINDOW_MS)) {
      out.add(t.time);
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

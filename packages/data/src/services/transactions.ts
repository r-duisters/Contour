import { NotFoundError } from "../errors";
import type { Net } from "../ports/net";
import type { NewTransaction, Store, Transaction, TransactionPatch } from "../ports/store";
import { usdRateOn } from "./pricing";

/**
 * Storage in, storage out. Zod validation of an inbound HTTP body stays in the
 * route; these take already-typed arguments so a device build (no HTTP, no
 * Zod) can call them the same way.
 *
 * `addTransaction` is the one exception to "no network": a price typed in
 * euros has to become the USD figure every other calculation runs on, at the
 * rate on the *trade's* date. Doing that in the form would need a rate lookup
 * in the browser and would let two screens disagree; doing it in the route
 * would leave the device build without it.
 */

/**
 * The current POST checks `prisma.portfolio.findUnique` before ever calling
 * `transaction.create`, and turns a miss into a 404 `{ error: "not found" }`.
 * `store.transactions.add` has no opinion about whether the portfolio exists,
 * so that check has to live here for the route to keep the same behaviour.
 */
export async function addTransaction(
  store: Store,
  net: Net,
  portfolioId: string,
  tx: NewTransaction,
): Promise<Transaction> {
  const portfolio = await store.portfolios.get(portfolioId);
  if (!portfolio) throw new NotFoundError(`no portfolio ${portfolioId}`);
  return store.transactions.add(portfolioId, await inUsd(net, tx));
}

/**
 * A transaction whose `price` and `fee` are USD, given one whose native
 * figures may not be.
 *
 * When no rate can be had the native figures are kept and the USD price is
 * zero — the same shape the importer produces for an unpriceable row, and
 * recoverable, because what was actually paid is still on the row.
 */
async function inUsd(net: Net, tx: NewTransaction): Promise<NewTransaction> {
  // A cash row is worth one unit of itself: EUR 120 is EUR 120, and its
  // `nativePrice` of 1 is a statement of that, not a price to convert. Running
  // it through `usdRateOn` would multiply the amount by the exchange rate and
  // store a euro balance as a dollar one.
  if (tx.assetType === "cash") return tx;
  if (!tx.nativeCurrency || tx.nativePrice === null || tx.nativePrice === undefined) return tx;
  const rate = await usdRateOn(net, tx.nativeCurrency, Number(tx.time));
  if (rate === null) return { ...tx, price: 0, fee: 0 };
  return {
    ...tx,
    price: tx.nativePrice * rate,
    fee: (tx.nativeFee ?? 0) * rate,
  };
}

/**
 * Today's PATCH has no existence check of its own — an unknown id reaches
 * Prisma's throwing `update` uncaught, which is a 500. `store.transactions
 * .update` throws on the same input; letting that propagate unwrapped is what
 * keeps this conversion from quietly upgrading a 500 into a 404.
 */
export function updateTransaction(store: Store, id: string, patch: TransactionPatch): Promise<Transaction> {
  return store.transactions.update(id, patch);
}

/** Same reasoning as updateTransaction: an unknown id is a 500 today, not a 404. */
export function deleteTransaction(store: Store, id: string): Promise<void> {
  return store.transactions.remove(id);
}

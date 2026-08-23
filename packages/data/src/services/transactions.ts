import { NotFoundError } from "../errors";
import type { NewTransaction, Store, Transaction, TransactionPatch } from "../ports/store";

/**
 * Storage in, storage out — no pricing, no network. Zod validation of an
 * inbound HTTP body stays in the route; these take already-typed arguments so
 * a device build (no HTTP, no Zod) can call them the same way.
 */

/**
 * The current POST checks `prisma.portfolio.findUnique` before ever calling
 * `transaction.create`, and turns a miss into a 404 `{ error: "not found" }`.
 * `store.transactions.add` has no opinion about whether the portfolio exists,
 * so that check has to live here for the route to keep the same behaviour.
 */
export async function addTransaction(store: Store, portfolioId: string, tx: NewTransaction): Promise<Transaction> {
  const portfolio = await store.portfolios.get(portfolioId);
  if (!portfolio) throw new NotFoundError(`no portfolio ${portfolioId}`);
  return store.transactions.add(portfolioId, tx);
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

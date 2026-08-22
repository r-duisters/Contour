import { NotFoundError } from "../errors";
import type { Portfolio, PortfolioWithTransactions, Store } from "../ports/store";

/**
 * Storage in, storage out — no pricing, no network. Zod validation of an
 * inbound HTTP body stays in the route; these take already-typed arguments so
 * a device build (no HTTP, no Zod) can call them the same way.
 */

export function listPortfolios(store: Store): Promise<Portfolio[]> {
  return store.portfolios.list();
}

/**
 * The route's GET turns a missing row into a 404 with body
 * `{ error: "not found" }`. `store.portfolios.get` only signals "missing" by
 * returning `null` (see store-contract.ts), so this is the one place that
 * turns that into something a route can map without knowing the store exists.
 */
export async function getPortfolio(store: Store, id: string): Promise<PortfolioWithTransactions> {
  const portfolio = await store.portfolios.get(id);
  if (!portfolio) throw new NotFoundError(`no portfolio ${id}`);
  return portfolio;
}

export function createPortfolio(store: Store, name: string): Promise<Portfolio> {
  return store.portfolios.create(name);
}

/**
 * Today's PATCH has no existence check of its own — an unknown id reaches
 * Prisma's throwing `update` uncaught, which is a 500. `store.portfolios
 * .rename` throws on the same input; letting that propagate unwrapped is what
 * keeps this conversion from quietly upgrading a 500 into a 404.
 */
export function renamePortfolio(store: Store, id: string, name: string): Promise<Portfolio> {
  return store.portfolios.rename(id, name);
}

/** Same reasoning as renamePortfolio: an unknown id is a 500 today, not a 404. */
export function deletePortfolio(store: Store, id: string): Promise<void> {
  return store.portfolios.remove(id);
}

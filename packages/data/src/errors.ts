/**
 * A service's way of saying "no such record" without importing anything
 * Next-shaped. A route handler catches this and maps it to the 404 the route
 * already returned before the service existed.
 *
 * It is deliberately not what a `Store`'s throwing `remove`/`rename`/`update`
 * raises on an unknown id — those already bubble past every route uncaught
 * today (an uncaught Prisma `P2025` becomes Next's default 500), and
 * `store-contract.ts` pins that as the behaviour to keep, not something to
 * upgrade into a clean 404 while converting these routes.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

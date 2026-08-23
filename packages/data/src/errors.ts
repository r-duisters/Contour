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

/**
 * Anything a `DataClient` call could not do that is not a missing record: the
 * network is unreachable, the server refused the write, an upstream feed died.
 *
 * It exists so a screen has one thing to catch and one thing to show. The
 * alternative — letting `Net`'s raw `Error` through — would put a method and a
 * URL into a message the user reads, and would leave `LocalClient`, which has
 * neither, with nothing comparable to throw.
 */
export class RequestFailedError extends Error {
  constructor(
    message: string,
    /**
     * Whatever the implementation was told about the failure, unparsed — an
     * error body, a driver message. The settings screen shows it verbatim
     * today (`Error: ${await r.text()}`), so it has to survive the trip.
     */
    readonly detail: string = "",
    /**
     * Whether anything answered at all. See `data-client.ts` for what each
     * value means and why an implementation has to set it deliberately.
     * Defaulted to the more common case so the many call sites that predate
     * this field — and any new one that forgets it — stay `"refused"` rather
     * than silently wrong about connectivity.
     */
    readonly kind: "unreachable" | "refused" = "refused",
  ) {
    super(message);
    this.name = "RequestFailedError";
  }
}

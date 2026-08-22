import type { Net } from "@/data/ports/net";
import type { Store } from "@/data/ports/store";
import { WebNet } from "./net/web-net";
import { PrismaStore } from "./store/prisma-store";

/**
 * The server's wiring of the ports, built once at module scope: route handlers
 * are the only place that knows which implementations exist, so a service can
 * be handed a `MemoryStore` and a `FakeNet` in a test and never notice.
 *
 * Phase 4 supplies its own `deps()` inside the APK — SQLite and CapacitorHttp —
 * against the same two interfaces.
 */
const store: Store = PrismaStore();
const net: Net = WebNet();

export function deps(): { store: Store; net: Net } {
  return { store, net };
}

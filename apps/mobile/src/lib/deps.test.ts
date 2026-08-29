import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * One question: does a failed open leave anything behind that stops the next
 * attempt from happening?
 *
 * `client()` memoises its promise so that two callers racing at launch share
 * one connection. A rejected promise memoised the same way is a different
 * thing: it answers every later call from the moment it failed, without
 * touching the database. The "Try again" button on the failure screen would
 * then be a control that cannot work — it would re-read a stale rejection and
 * report the same failure however healthy the database had become. The
 * duplicate-connection case `openDb` guards against is exactly a cause that
 * clears itself, so this is not hypothetical.
 *
 * Nothing here asserts against SQLite. The plugin is mocked, and what is
 * counted is how many times an open was *attempted*.
 */

let opens = 0;
let failNext = true;

vi.mock("@capacitor-community/sqlite", () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    async isConnection() { return { result: false }; }
    async createConnection() {
      opens++;
      if (failNext) throw new Error("could not open");
      return {
        async isDBOpen() { return { result: true }; },
        async open() {},
        async execute() {},
        async query() { return { values: [] }; },
        async run() { return { changes: { changes: 0 } }; },
        async executeSet() {},
      };
    }
  },
}));

describe("client()", () => {
  beforeEach(() => {
    opens = 0;
    failNext = true;
    vi.resetModules();
  });

  it("shares one open between callers that race at launch", async () => {
    failNext = false;
    const { client } = await import("./deps");
    const [a, b] = await Promise.all([client(), client()]);
    expect(opens).toBe(1);
    expect(a).toBe(b);
  });

  it("attempts the open again after one fails", async () => {
    const { client } = await import("./deps");
    await expect(client()).rejects.toThrow();
    expect(opens).toBe(1);

    // What the "Try again" button does. Without clearing the memo this second
    // call returns the first call's rejection and `opens` stays at 1.
    await expect(client()).rejects.toThrow();
    expect(opens).toBe(2);
  });

  it("succeeds on a retry once the cause has gone", async () => {
    const { client } = await import("./deps");
    await expect(client()).rejects.toThrow();
    failNext = false;
    await expect(client()).resolves.toBeDefined();
    expect(opens).toBe(2);
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll } from "vitest";
import { runStoreContract } from "@/data/testing/store-contract";
import { PrismaStore } from "./prisma-store";

/**
 * `apps/web/prisma/dev.db` is the owner's real portfolio. This suite never goes
 * near it: it builds a throwaway database under the OS temp directory, migrates
 * it, and deletes it afterwards. `DATABASE_URL` is passed to the migrate child
 * process explicitly rather than mutated globally, so nothing else in the run
 * can inherit a redirected database — or fail to.
 */
let dir: string;
let url: string;
let client: PrismaClient;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "contour-store-contract-"));
  url = `file:${join(dir, "test.db")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  client = new PrismaClient({ datasourceUrl: url });
}, 120_000);

afterAll(async () => {
  await client?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

runStoreContract("PrismaStore", async () => {
  // One database, reset between cases: cheaper than a migration per test, and
  // the contract's assertions are absolute counts, so leftovers would show up.
  await client.transaction.deleteMany();
  await client.portfolio.deleteMany();
  await client.settings.deleteMany();
  return PrismaStore(client);
});

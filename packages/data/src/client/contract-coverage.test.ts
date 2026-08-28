import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every method on `DataClient` must be exercised by the contract suite.
 *
 * The contract is the only thing holding the two implementations together. It
 * works — 24 of the 25 methods are covered — but that was discipline rather
 * than a rule, and discipline is what runs out at the twenty-sixth. A method
 * the suite never calls is a method `LocalClient` can implement differently
 * from `HttpClient` for as long as nobody opens it on a phone.
 *
 * This is the cheap half of the defence. The expensive half is what the suite
 * *asserts*: `getAssetInfo` was covered here and still shipped a bug, because
 * the case checked its shape rather than whether `assetType` changed the
 * answer. Coverage is necessary and is not sufficient — see the note on
 * `computedReads` in `client-contract.ts`.
 */
const HERE = __dirname;

/** Optional by design, with the reason `data-client.ts` gives for each. */
const NOT_UNIVERSAL: Record<string, string> = {
  sendTestNotification:
    "Optional on the interface itself (`method?()`). Home Assistant and Web Push do not exist " +
    "inside an APK, so the settings screen feature-detects it and draws no button when it is " +
    "absent. A contract case would have to assert one behaviour or the other.",
};

describe("the contract covers the interface", () => {
  const iface = readFileSync(join(HERE, "data-client.ts"), "utf8");
  const contract = readFileSync(join(HERE, "client-contract.ts"), "utf8");

  const methods = [
    ...new Set(
      [...iface.slice(iface.indexOf("export interface DataClient")).matchAll(/^ {2}(\w+)\??\(/gm)]
        .map((m) => m[1]!),
    ),
  ];

  it("finds the interface, so an empty list cannot pass for coverage", () => {
    // Without this the regex could silently match nothing and every assertion
    // below would hold vacuously.
    expect(methods.length).toBeGreaterThan(20);
  });

  it("calls every method, or says why it cannot", () => {
    const uncovered = methods
      .filter((m) => !contract.includes(`.${m}(`))
      .filter((m) => !(m in NOT_UNIVERSAL));
    expect(uncovered).toEqual([]);
  });

  it("keeps no stale exemptions", () => {
    // An exemption that no longer names a real method is a reason nobody has
    // reread. Deleting it is the point at which someone notices.
    const gone = Object.keys(NOT_UNIVERSAL).filter((m) => !methods.includes(m));
    expect(gone).toEqual([]);
  });
});

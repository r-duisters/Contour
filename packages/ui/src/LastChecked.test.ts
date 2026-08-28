import { describe, expect, it } from "vitest";
import { describeLastChecked } from "./LastChecked";

const NOW = 1_700_000_000_000;

describe("describeLastChecked", () => {
  it("calls a check that never ran degraded, rather than showing nothing", () => {
    // The whole point: an app that has never checked must not look like an
    // app with nothing to report.
    expect(describeLastChecked(null, NOW)).toEqual({ text: "Not checked yet", stale: true });
  });

  it("reads in the unit a person would use", () => {
    expect(describeLastChecked(NOW - 30_000, NOW).text).toBe("Last checked just now");
    expect(describeLastChecked(NOW - 60_000, NOW).text).toBe("Last checked 1 minute ago");
    expect(describeLastChecked(NOW - 20 * 60_000, NOW).text).toBe("Last checked 20 minutes ago");
    expect(describeLastChecked(NOW - 3_600_000, NOW).text).toBe("Last checked 1 hour ago");
    expect(describeLastChecked(NOW - 3 * 3_600_000, NOW).text).toBe("Last checked 3 hours ago");
  });

  it("turns amber only past a day, because opening the app runs a check", () => {
    expect(describeLastChecked(NOW - 23 * 3_600_000, NOW).stale).toBe(false);
    expect(describeLastChecked(NOW - 25 * 3_600_000, NOW)).toEqual({
      text: "Not checked since yesterday",
      stale: true,
    });
    expect(describeLastChecked(NOW - 5 * 86_400_000, NOW).text).toBe("Not checked for 5 days");
  });
});

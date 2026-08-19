import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./auth";

describe("password hashing", () => {
  it("round-trips the right password", async () => {
    const stored = await hashPassword("hunter22!");
    expect(stored.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("hunter22!", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("hunter22!");
    expect(await verifyPassword("hunter23!", stored)).toBe(false);
  });

  it("salts: same password hashes differently", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });

  it("rejects malformed stored values without throwing", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "scrypt:zz")).toBe(false);
  });
});

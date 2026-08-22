import { describe, it, expect, beforeEach, vi } from "vitest";
import { KEYS, readKey } from "./storage-keys";

/** A localStorage good enough to prove the rename carries values forward. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    store: map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe("readKey", () => {
  it("returns the current value when one exists", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [KEYS.rangeAsset]: "5y" }));
    expect(readKey(KEYS.rangeAsset)).toBe("5y");
  });

  it("adopts a value left under the app's former name", () => {
    const s = fakeStorage({ "nabla:range:asset": "2y" });
    vi.stubGlobal("localStorage", s);
    expect(readKey(KEYS.rangeAsset)).toBe("2y");
    // and having moved it, does not leave the old key behind
    expect(s.store.has("nabla:range:asset")).toBe(false);
    expect(s.store.get(KEYS.rangeAsset)).toBe("2y");
  });

  it("prefers the current value over a stale legacy one", () => {
    vi.stubGlobal("localStorage", fakeStorage({
      [KEYS.rangeAsset]: "1y", "nabla:range:asset": "all",
    }));
    expect(readKey(KEYS.rangeAsset)).toBe("1y");
  });

  it("returns null when neither name holds anything", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(readKey(KEYS.rangePortfolio)).toBeNull();
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    });
    expect(readKey(KEYS.hideAmounts)).toBeNull();
  });
});

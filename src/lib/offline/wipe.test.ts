import { clear } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENTITLEMENT_KEY, LAST_USER_KEY } from "./constants";
import { wipeOfflineData } from "./wipe";

// jsdom has real localStorage but no Cache Storage and no real IndexedDB, so
// idb-keyval's `clear` is mocked and the `caches` global is stubbed per test.
vi.mock("idb-keyval", () => ({
  clear: vi.fn(() => Promise.resolve()),
}));

function stubCaches(overrides: {
  keys?: () => Promise<string[]>;
  del?: (key: string) => Promise<boolean>;
}) {
  vi.stubGlobal("caches", {
    keys: vi.fn(overrides.keys ?? (() => Promise.resolve([]))),
    delete: vi.fn(overrides.del ?? (() => Promise.resolve(true))),
  });
}

describe("wipeOfflineData", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(LAST_USER_KEY, "user-a");
    localStorage.setItem(ENTITLEMENT_KEY, "granted");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("clears both localStorage identity markers, the IndexedDB store, and every Cache API entry", async () => {
    const deleted: string[] = [];
    stubCaches({
      keys: () => Promise.resolve(["precache-v1", "runtime"]),
      del: (key) => {
        deleted.push(key);
        return Promise.resolve(true);
      },
    });

    await wipeOfflineData();

    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
    expect(localStorage.getItem(ENTITLEMENT_KEY)).toBeNull();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(deleted.sort()).toEqual(["precache-v1", "runtime"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("still resolves, still clears the localStorage markers, and logs an error when the IndexedDB clear rejects", async () => {
    vi.mocked(clear).mockRejectedValueOnce(new Error("blocked"));
    stubCaches({ keys: () => Promise.resolve(["runtime"]) });

    await expect(wipeOfflineData()).resolves.toBeUndefined();

    // The identity markers are cleared before IndexedDB is touched, so a failed
    // IndexedDB clear must not leave them behind — that is the whole point of
    // the ordering documented in wipe.ts.
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
    expect(localStorage.getItem(ENTITLEMENT_KEY)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("IndexedDB");
  });

  it("still resolves and reports exactly which cache entry failed when a cache delete rejects", async () => {
    stubCaches({
      keys: () => Promise.resolve(["precache-v1", "runtime"]),
      del: (key) =>
        key === "runtime"
          ? Promise.reject(new Error("delete blocked"))
          : Promise.resolve(true),
    });

    await expect(wipeOfflineData()).resolves.toBeUndefined();

    expect(clear).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('"runtime"');
  });
});

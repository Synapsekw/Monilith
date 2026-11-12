import { beforeEach, describe, expect, it, vi } from "vitest";

// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
const cacheTag = vi.fn();
const cacheLife = vi.fn();
vi.mock("next/cache", () => ({
  cacheTag: (tag: string) => cacheTag(tag),
  cacheLife: (profile: string) => cacheLife(profile),
}));

// Read path: from("profiles").select(<columns>).eq("id", userId).maybeSingle()
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import {
  getUserCelebrateDoneCached,
  getUserThemePresetCached,
  getUserThemeReachCached,
  getUserTimeZoneCached,
} from "./queries-cached";

/** The ONE read every getter is a selector over. */
const PROFILE_COLUMNS = "timezone, theme_preset, theme_reach, celebrate_done";

const row = (over: Record<string, unknown> = {}) => ({
  data: {
    timezone: "Europe/Vienna",
    theme_preset: "ocean",
    theme_reach: "vivid",
    celebrate_done: false,
    ...over,
  },
});

beforeEach(() => {
  cacheTag.mockReset();
  cacheLife.mockReset();
  maybeSingle.mockReset();
  eq.mockClear();
  select.mockClear();
  from.mockClear();
});

describe("the shared cached profile read", () => {
  /**
   * `use cache` keys an entry on the function and its arguments. Four getters
   * with four different selects were four entries (four queries on a cold
   * cache) under one tag. Vitest does not compile `use cache`, so what is
   * pinned here is the precondition for sharing: every getter issues the
   * IDENTICAL read — same table, same column list, same filter, same tag — and
   * none of them issues a per-column query of its own.
   */
  it("serves all four getters from the one identical query", async () => {
    maybeSingle.mockResolvedValue(row());

    expect(await getUserTimeZoneCached("user-1")).toBe("Europe/Vienna");
    expect(await getUserThemePresetCached("user-1")).toBe("ocean");
    expect(await getUserThemeReachCached("user-1")).toBe("vivid");
    expect(await getUserCelebrateDoneCached("user-1")).toBe(false);

    // One query per getter call, and it is the same one every time.
    expect(select).toHaveBeenCalledTimes(4);
    expect(new Set(select.mock.calls.map((c) => c.join()))).toEqual(
      new Set([PROFILE_COLUMNS]),
    );
    expect(new Set(from.mock.calls.map((c) => c.join()))).toEqual(
      new Set(["profiles"]),
    );
    // The explicit id filter is the tenant boundary (service client bypasses RLS).
    expect(new Set(eq.mock.calls.map((c) => c.join()))).toEqual(
      new Set(["id,user-1"]),
    );
    expect(new Set(cacheTag.mock.calls.map((c) => c.join()))).toEqual(
      new Set(["profile:user:user-1"]),
    );
    expect(new Set(cacheLife.mock.calls.map((c) => c.join()))).toEqual(
      new Set(["nav"]),
    );
  });

  it("issues exactly one query for one getter call", async () => {
    maybeSingle.mockResolvedValue(row());
    await getUserThemeReachCached("user-1");
    expect(from).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(PROFILE_COLUMNS);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("keys the read, the filter and the tag on the user it was asked for", async () => {
    maybeSingle.mockResolvedValue(row());
    await getUserTimeZoneCached("user-2");
    expect(eq).toHaveBeenCalledWith("id", "user-2");
    expect(cacheTag).toHaveBeenCalledWith("profile:user:user-2");
  });
});

describe("getUserTimeZoneCached", () => {
  it("returns the stored zone", async () => {
    maybeSingle.mockResolvedValue(row({ timezone: "Asia/Tokyo" }));
    expect(await getUserTimeZoneCached("user-1")).toBe("Asia/Tokyo");
  });

  it("returns null for Automatic (a null column)", async () => {
    maybeSingle.mockResolvedValue(row({ timezone: null }));
    expect(await getUserTimeZoneCached("user-1")).toBeNull();
  });

  it("returns null on a missing row", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await getUserTimeZoneCached("user-1")).toBeNull();
  });
});

describe("getUserThemePresetCached", () => {
  it("returns a known preset unchanged", async () => {
    maybeSingle.mockResolvedValue(row({ theme_preset: "nebula" }));
    expect(await getUserThemePresetCached("user-1")).toBe("nebula");
  });

  it("narrows an unknown stored value to keystone", async () => {
    maybeSingle.mockResolvedValue(row({ theme_preset: "retired-preset" }));
    expect(await getUserThemePresetCached("user-1")).toBe("keystone");
  });

  it("falls back to keystone on a missing row", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await getUserThemePresetCached("user-1")).toBe("keystone");
  });
});

describe("getUserThemeReachCached", () => {
  it("returns each known reach id unchanged", async () => {
    for (const theme_reach of ["subtle", "tinted", "vivid"]) {
      maybeSingle.mockResolvedValue(row({ theme_reach }));
      expect(await getUserThemeReachCached("user-1")).toBe(theme_reach);
    }
  });

  it("narrows an unknown stored value to tinted", async () => {
    maybeSingle.mockResolvedValue(row({ theme_reach: "loud" }));
    expect(await getUserThemeReachCached("user-1")).toBe("tinted");
  });

  it("narrows a null column to tinted", async () => {
    maybeSingle.mockResolvedValue(row({ theme_reach: null }));
    expect(await getUserThemeReachCached("user-1")).toBe("tinted");
  });

  it("falls back to tinted on a missing row", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await getUserThemeReachCached("user-1")).toBe("tinted");
  });
});

describe("getUserCelebrateDoneCached", () => {
  it("returns a stored false", async () => {
    maybeSingle.mockResolvedValue(row({ celebrate_done: false }));
    expect(await getUserCelebrateDoneCached("user-1")).toBe(false);
  });

  it("returns a stored true", async () => {
    maybeSingle.mockResolvedValue(row({ celebrate_done: true }));
    expect(await getUserCelebrateDoneCached("user-1")).toBe(true);
  });

  it("defaults to true on a null column", async () => {
    maybeSingle.mockResolvedValue(row({ celebrate_done: null }));
    expect(await getUserCelebrateDoneCached("user-1")).toBe(true);
  });

  it("defaults to true on a missing row", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await getUserCelebrateDoneCached("user-1")).toBe(true);
  });
});

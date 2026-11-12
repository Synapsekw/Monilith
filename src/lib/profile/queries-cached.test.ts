import { beforeEach, describe, expect, it, vi } from "vitest";

// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
const cacheTag = vi.fn();
vi.mock("next/cache", () => ({
  cacheTag: (tag: string) => cacheTag(tag),
  cacheLife: vi.fn(),
}));

// Read path: from("profiles").select(<column>).eq("id", userId).maybeSingle()
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import {
  getUserCelebrateDoneCached,
  getUserThemeReachCached,
} from "./queries-cached";

beforeEach(() => {
  cacheTag.mockReset();
  maybeSingle.mockReset();
  eq.mockClear();
  select.mockClear();
  from.mockClear();
});

describe("getUserThemeReachCached", () => {
  it("reads theme_reach for exactly this user and tags the profile cache", async () => {
    maybeSingle.mockResolvedValue({ data: { theme_reach: "vivid" } });

    expect(await getUserThemeReachCached("user-1")).toBe("vivid");
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("theme_reach");
    // The explicit id filter is the tenant boundary (service client bypasses RLS).
    expect(eq).toHaveBeenCalledWith("id", "user-1");
    expect(cacheTag).toHaveBeenCalledWith("profile:user:user-1");
  });

  it("returns each known reach id unchanged", async () => {
    for (const theme_reach of ["subtle", "tinted", "vivid"]) {
      maybeSingle.mockResolvedValue({ data: { theme_reach } });
      expect(await getUserThemeReachCached("user-1")).toBe(theme_reach);
    }
  });

  it("narrows an unknown stored value to tinted", async () => {
    maybeSingle.mockResolvedValue({ data: { theme_reach: "loud" } });
    expect(await getUserThemeReachCached("user-1")).toBe("tinted");
  });

  it("falls back to tinted on a missing row", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await getUserThemeReachCached("user-1")).toBe("tinted");
  });
});

describe("getUserCelebrateDoneCached", () => {
  it("reads celebrate_done for exactly this user and tags the profile cache", async () => {
    maybeSingle.mockResolvedValue({ data: { celebrate_done: false } });

    expect(await getUserCelebrateDoneCached("user-1")).toBe(false);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("celebrate_done");
    expect(eq).toHaveBeenCalledWith("id", "user-1");
    expect(cacheTag).toHaveBeenCalledWith("profile:user:user-1");
  });

  it("returns a stored true", async () => {
    maybeSingle.mockResolvedValue({ data: { celebrate_done: true } });
    expect(await getUserCelebrateDoneCached("user-1")).toBe(true);
  });

  it("defaults to true on a missing row", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await getUserCelebrateDoneCached("user-1")).toBe(true);
  });
});

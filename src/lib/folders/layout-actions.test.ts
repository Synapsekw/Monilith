import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({
    id: "org-1",
    name: "Org",
    timezone: "UTC",
  })),
}));

// Chain stubs: `insert`/`update`/`upsert` are the vi.fn()s tests configure
// directly with `.mockResolvedValueOnce(...)` — the query-builder chain just
// forwards to them at the terminal `.maybeSingle()` call, so a test controls
// exactly what the mutation "sees" without re-implementing Supabase's chain.
const insert = vi.fn();
const update = vi.fn();
const upsert = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      insert: (payload: unknown) => ({
        select: () => ({
          maybeSingle: () => insert(payload),
        }),
      }),
      update: (payload: unknown) => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () => update(payload),
            }),
          }),
        }),
      }),
      upsert: (...args: unknown[]) => upsert(...args),
    }),
  })),
}));

import { PRESETS } from "@/lib/folders/presets";
import { FOLDER_GONE_ERROR } from "./types";
import { saveFolderLayout } from "./layout-actions";

const FOLDER = "11111111-1111-4111-8111-111111111111";

describe("saveFolderLayout", () => {
  beforeEach(() => {
    insert.mockReset();
    update.mockReset();
    upsert.mockReset();
    updateTag.mockClear();
  });

  it("rejects a config that fails validation before touching the database", async () => {
    const res = await saveFolderLayout({
      folderId: FOLDER,
      version: 1,
      preset: "crm",
      config: { v: 1, tabs: [] },
    });
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("inserts when version is 0 and returns the new version", async () => {
    insert.mockResolvedValueOnce({ data: { version: 1 }, error: null });
    const res = await saveFolderLayout({
      folderId: FOLDER,
      version: 0,
      preset: "project",
      config: PRESETS.project,
    });
    expect(res).toEqual({ ok: true, data: { version: 1 } });
  });

  it("refuses a stale version instead of clobbering", async () => {
    update.mockResolvedValueOnce({ data: null, error: null }); // no row matched
    const res = await saveFolderLayout({
      folderId: FOLDER,
      version: 3,
      preset: "crm",
      config: PRESETS.crm,
    });
    expect(res).toEqual({
      ok: false,
      error: "This layout changed — reload the page and try again.",
    });
  });

  it("maps a missing or cross-tenant folder to the canonical gone message", async () => {
    insert.mockResolvedValueOnce({
      data: null,
      error: { code: "23503", message: "fk" },
    });
    const res = await saveFolderLayout({
      folderId: FOLDER,
      version: 0,
      preset: "project",
      config: PRESETS.project,
    });
    expect(res).toEqual({ ok: false, error: FOLDER_GONE_ERROR });
  });

  it("does not invalidate the folders nav cache", async () => {
    insert.mockResolvedValueOnce({ data: { version: 1 }, error: null });
    await saveFolderLayout({
      folderId: FOLDER,
      version: 0,
      preset: "project",
      config: PRESETS.project,
    });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

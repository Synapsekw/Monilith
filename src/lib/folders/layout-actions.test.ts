import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "user-1" })),
}));

// Chain stubs: `insert`/`update` are the vi.fn()s tests configure directly
// with `.mockResolvedValueOnce(...)` — the query-builder chain just forwards
// to them at the terminal `.maybeSingle()` call, so a test controls exactly
// what the mutation "sees" without re-implementing Supabase's chain.
// `updateEq` records the update's filter arguments so a guard that filtered on
// the wrong column or the wrong value cannot pass.
const insert = vi.fn();
const update = vi.fn();
const updateEq = vi.fn();
/** The `select("org_id")` on `folders` the action uses to derive the org. */
const folderSelect = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) =>
      table === "folders"
        ? {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                maybeSingle: () => folderSelect(col, val),
              }),
            }),
          }
        : {
            insert: (payload: unknown) => ({
              select: () => ({ maybeSingle: () => insert(payload) }),
            }),
            update: (payload: unknown) => {
              const result = update(payload);
              const chain = (col: string, val: unknown) => {
                updateEq(col, val);
                return {
                  eq: chain,
                  select: () => ({ maybeSingle: () => result }),
                };
              };
              return { eq: chain };
            },
          },
  })),
}));

import { PRESETS } from "@/lib/folders/presets";
import { FOLDER_GONE_ERROR } from "./types";
import { saveFolderLayout } from "./layout-actions";

const FOLDER = "11111111-1111-4111-8111-111111111111";
const STALE_MESSAGE = "This layout changed — reload the page and try again.";

describe("saveFolderLayout", () => {
  beforeEach(() => {
    insert.mockReset();
    update.mockReset();
    updateEq.mockReset();
    folderSelect.mockReset();
    folderSelect.mockResolvedValue({ data: { org_id: "org-folder" } });
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
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
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

  it("scopes the insert to the FOLDER's org, not the active-org cookie", async () => {
    // A user in two orgs can open a folder in the org that is not "active" —
    // the folder page has no active-org gate. Deriving org_id from the folder
    // row on the request's RLS client is what stops that legitimate save from
    // being rejected as "gone".
    insert.mockResolvedValueOnce({ data: { version: 1 }, error: null });
    await saveFolderLayout({
      folderId: FOLDER,
      version: 0,
      preset: "project",
      config: PRESETS.project,
    });
    expect(folderSelect).toHaveBeenCalledWith("id", FOLDER);
    expect(insert).toHaveBeenCalledWith({
      folder_id: FOLDER,
      org_id: "org-folder",
      preset: "project",
      config: PRESETS.project,
      updated_by: "user-1",
    });
  });

  it("is the gone case, with no insert, when the folder is unreadable", async () => {
    folderSelect.mockResolvedValue({ data: null });
    const res = await saveFolderLayout({
      folderId: FOLDER,
      version: 0,
      preset: "project",
      config: PRESETS.project,
    });
    expect(res).toEqual({ ok: false, error: FOLDER_GONE_ERROR });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a stale version instead of clobbering, filtering on version", async () => {
    update.mockResolvedValueOnce({ data: null, error: null }); // no row matched
    const res = await saveFolderLayout({
      folderId: FOLDER,
      version: 3,
      preset: "crm",
      config: PRESETS.crm,
    });
    expect(res).toEqual({ ok: false, error: STALE_MESSAGE });
    // The guard is only a guard if it filters on the version the client read.
    expect(updateEq).toHaveBeenCalledWith("folder_id", FOLDER);
    expect(updateEq).toHaveBeenCalledWith("version", 3);
  });

  it("reports a lost first-save race as stale, not as a missing folder", async () => {
    // Two editors on a never-customized folder both hold version 0; the loser's
    // insert trips the folder_layouts primary key.
    insert.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const res = await saveFolderLayout({
      folderId: FOLDER,
      version: 0,
      preset: "project",
      config: PRESETS.project,
    });
    expect(res).toEqual({ ok: false, error: STALE_MESSAGE });
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

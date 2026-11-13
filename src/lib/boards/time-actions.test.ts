import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addManualEntrySchema,
  startTimerSchema,
} from "@/lib/validations/board-actions";

describe("time action schemas", () => {
  it("rejects a bad uuid", () => {
    expect(
      startTimerSchema.safeParse({ itemId: "x", columnId: "y" }).success,
    ).toBe(false);
  });
  it("rejects non-positive duration", () => {
    expect(
      addManualEntrySchema.safeParse({
        itemId: "00000000-0000-0000-0000-000000000000",
        columnId: "00000000-0000-0000-0000-000000000000",
        date: "2026-06-20",
        durationSecs: 0,
      }).success,
    ).toBe(false);
  });
});

// ── Actor resolution for the manual-entry actions ────────────────────────────
// addManualEntry / editEntry need only the caller's id (timezone lookup + the
// row's user_id). It comes from the session helper — a LOCAL JWKS verify — not
// from `supabase.auth.getUser()`, a network round-trip to Supabase Auth.
const h = vi.hoisted(() => ({
  from: vi.fn(),
  authGetUser: vi.fn(),
  sessionGetUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: h.from,
    auth: { getUser: h.authGetUser },
  }),
}));
vi.mock("@/lib/auth/session", () => ({
  getUser: () => h.sessionGetUser(),
}));
vi.mock("@/lib/datetime/user-timezone", () => ({
  resolveUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: vi.fn(),
  clearCell: vi.fn(),
}));

import { addManualEntry, editEntry } from "@/lib/boards/time-actions";
import { resolveUserTimeZone } from "@/lib/datetime/user-timezone";

const ENTRY = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const COLUMN = "33333333-3333-4333-8333-333333333333";
const ME = "99999999-9999-4999-8999-999999999999";

/** `.select(…).eq(…).maybeSingle()` resolving to `{ data }`. */
const pointRead = (data: unknown) => ({
  select: () => ({
    eq: () => ({ maybeSingle: async () => ({ data, error: null }) }),
  }),
});

describe("time entry actions — actor comes from the session, not Supabase Auth", () => {
  beforeEach(() => {
    h.from.mockReset();
    h.authGetUser.mockReset();
    h.sessionGetUser.mockReset().mockResolvedValue({ id: ME });
    vi.mocked(resolveUserTimeZone).mockClear();
  });

  it("editEntry anchors the edit in the session user's timezone", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: ENTRY },
      error: null,
    }));
    const update = vi.fn((_patch: Record<string, unknown>) => ({
      eq: () => ({ not: () => ({ select: () => ({ maybeSingle }) }) }),
    }));
    h.from.mockReturnValue({ update });

    const res = await editEntry({
      entryId: ENTRY,
      date: "2026-06-20",
      durationSecs: 3600,
    });

    expect(res).toEqual({ ok: true, data: { entry: { id: ENTRY } } });
    expect(resolveUserTimeZone).toHaveBeenCalledWith(ME);
    expect(update).toHaveBeenCalledWith({
      started_at: "2026-06-20T12:00:00.000Z",
      ended_at: "2026-06-20T13:00:00.000Z",
      duration_secs: 3600,
    });
    expect(h.authGetUser).not.toHaveBeenCalled();
  });

  it("editEntry refuses without a session, before writing", async () => {
    h.sessionGetUser.mockResolvedValue(null);
    const res = await editEntry({
      entryId: ENTRY,
      date: "2026-06-20",
      durationSecs: 3600,
    });
    expect(res).toEqual({ ok: false, error: "Not authenticated." });
    expect(h.from).not.toHaveBeenCalled();
  });

  it("addManualEntry writes the entry as the session user", async () => {
    const insert = vi.fn((_row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => ({ data: { id: ENTRY }, error: null }),
      }),
    }));
    h.from.mockImplementation((table: string) => {
      if (table === "items")
        return pointRead({ org_id: "org-1", board_id: "board-1" });
      if (table === "columns")
        return pointRead({
          id: COLUMN,
          kind: "time_tracking",
          board_id: "board-1",
        });
      return { insert };
    });

    const res = await addManualEntry({
      itemId: ITEM,
      columnId: COLUMN,
      date: "2026-06-20",
      durationSecs: 1800,
    });

    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ME,
        org_id: "org-1",
        board_id: "board-1",
        item_id: ITEM,
        column_id: COLUMN,
        duration_secs: 1800,
      }),
    );
    expect(h.authGetUser).not.toHaveBeenCalled();
  });

  it("addManualEntry refuses without a session, before inserting", async () => {
    h.sessionGetUser.mockResolvedValue(null);
    const insert = vi.fn();
    h.from.mockImplementation((table: string) =>
      table === "items"
        ? pointRead({ org_id: "org-1", board_id: "board-1" })
        : { insert },
    );
    const res = await addManualEntry({
      itemId: ITEM,
      columnId: COLUMN,
      date: "2026-06-20",
      durationSecs: 1800,
    });
    expect(res).toEqual({ ok: false, error: "Not authenticated." });
    expect(insert).not.toHaveBeenCalled();
  });
});

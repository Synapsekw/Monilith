import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";
import { getFolderLayoutRow, listLatestBriefs } from "./queries";
import type { FolderBoardRef } from "./types";

function runRow(
  boardId: string,
  generatedAt: string,
  brief: string,
): Tables<"board_intelligence_runs"> {
  return {
    id: `${boardId}-${generatedAt}`,
    board_id: boardId,
    org_id: "org-1",
    user_id: "user-1",
    generated_at: generatedAt,
    input_hash: "h",
    payload: { brief, suggestions: [], signals: [] },
    dismissed: [],
    applied: [],
    model: null,
    tokens_in: 0,
    tokens_out: 0,
  };
}

/**
 * Mocks the exact chain `getLatestBoardIntelligenceRun` issues per board:
 * `.from("board_intelligence_runs").select("*").eq("board_id", X)
 *   .eq("user_id", Y).order(...).limit(1).maybeSingle()`.
 * Returns the newest row for that (board_id, user_id) pair, so a board with
 * many runs cannot crowd out another board's read — each board gets its own
 * bounded query.
 */
function makeRunsClient(
  rows: Record<string, Tables<"board_intelligence_runs">[]>,
) {
  const calls: Array<{ boardId?: string; userId?: string }> = [];
  const client = {
    from: () => {
      let boardId: string | undefined;
      let userId: string | undefined;
      const qb: Record<string, unknown> = {};
      qb.select = () => qb;
      qb.eq = (col: string, val: string) => {
        if (col === "board_id") boardId = val;
        if (col === "user_id") userId = val;
        return qb;
      };
      qb.order = () => qb;
      qb.limit = () => qb;
      qb.maybeSingle = () => {
        calls.push({ boardId, userId });
        const boardRows = (rows[boardId ?? ""] ?? []).filter(
          (r) => r.user_id === userId,
        );
        const newest = [...boardRows].sort((a, b) =>
          b.generated_at.localeCompare(a.generated_at),
        )[0];
        return Promise.resolve({ data: newest ?? null, error: null });
      };
      return qb;
    },
  };
  return { client, calls };
}

describe("listLatestBriefs", () => {
  it("caps the per-board fan-out at 25 boards", async () => {
    // One indexed LIMIT-1 read per board is cheap; 100 of them in one wave on
    // the first paint's critical path is not. The cap is on the READS, so a
    // 40-board folder must issue exactly 25.
    const boards: FolderBoardRef[] = Array.from({ length: 40 }, (_, i) => ({
      id: `b${i}`,
      name: `Board ${i}`,
      position: i,
    }));
    const runs = Object.fromEntries(
      boards.map((b) => [
        b.id,
        [runRow(b.id, "2026-09-01T00:00:00Z", "brief")],
      ]),
    );
    const { client, calls } = makeRunsClient(runs);

    const out = await listLatestBriefs(
      client as unknown as SupabaseClient<Database>,
      boards,
      "user-1",
    );

    expect(calls).toHaveLength(25);
    expect(out).toHaveLength(25);
  });

  it("returns every board's own latest brief, even when one board has many runs", async () => {
    const boards: FolderBoardRef[] = [
      { id: "b1", name: "Backend", position: 0 },
      { id: "b2", name: "Frontend", position: 1 },
      { id: "b3", name: "Ops", position: 2 },
    ];
    const { client, calls } = makeRunsClient({
      b1: [
        runRow("b1", "2026-09-01T00:00:00Z", "old"),
        runRow("b1", "2026-09-02T00:00:00Z", "older"),
        runRow("b1", "2026-09-10T00:00:00Z", "newest-b1"),
        runRow("b1", "2026-09-05T00:00:00Z", "mid"),
        runRow("b1", "2026-09-03T00:00:00Z", "mid2"),
      ],
      b2: [runRow("b2", "2026-09-04T00:00:00Z", "brief-b2")],
      b3: [],
    });

    const out = await listLatestBriefs(
      client as unknown as SupabaseClient<Database>,
      boards,
      "user-1",
    );

    expect(out).toEqual([
      {
        boardId: "b1",
        boardName: "Backend",
        brief: "newest-b1",
        generatedAt: "2026-09-10T00:00:00Z",
      },
      {
        boardId: "b2",
        boardName: "Frontend",
        brief: "brief-b2",
        generatedAt: "2026-09-04T00:00:00Z",
      },
    ]);
    // One bounded read per board — never a single wide scan across all boards.
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.boardId).sort()).toEqual(["b1", "b2", "b3"]);
  });

  it("returns an empty list without querying when the folder has no boards", async () => {
    const { client, calls } = makeRunsClient({});
    const out = await listLatestBriefs(
      client as unknown as SupabaseClient<Database>,
      [],
      "user-1",
    );
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

/**
 * Mocks the exact chain `getFolderLayoutRow` issues:
 * `.from("folder_layouts").select("preset, config, version")
 *   .eq("folder_id", X).maybeSingle()`.
 */
function makeLayoutClient(result: {
  data?: { preset: string; config: unknown; version: number } | null;
  error?: { message: string } | null;
}) {
  const calls: Array<{ folderId?: string }> = [];
  const client = {
    from: () => {
      let folderId: string | undefined;
      const qb: Record<string, unknown> = {};
      qb.select = () => qb;
      qb.eq = (col: string, val: string) => {
        if (col === "folder_id") folderId = val;
        return qb;
      };
      qb.maybeSingle = () => {
        calls.push({ folderId });
        return Promise.resolve({
          data: result.data ?? null,
          error: result.error ?? null,
        });
      };
      return qb;
    },
  };
  return { client, calls };
}

describe("getFolderLayoutRow", () => {
  it("returns the row when the folder has a saved layout", async () => {
    const { client, calls } = makeLayoutClient({
      data: { preset: "crm", config: { v: 1, tabs: [] }, version: 2 },
    });
    const row = await getFolderLayoutRow(
      client as unknown as SupabaseClient<Database>,
      "f1",
    );
    expect(row).toEqual({
      preset: "crm",
      config: { v: 1, tabs: [] },
      version: 2,
    });
    expect(calls).toEqual([{ folderId: "f1" }]);
  });

  it("returns null when the folder has never been customized", async () => {
    const { client } = makeLayoutClient({ data: null });
    const row = await getFolderLayoutRow(
      client as unknown as SupabaseClient<Database>,
      "f1",
    );
    expect(row).toBeNull();
  });

  it("treats a read error the same as absence, and logs it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeLayoutClient({
      error: { message: "connection reset" },
    });
    const row = await getFolderLayoutRow(
      client as unknown as SupabaseClient<Database>,
      "f1",
    );
    expect(row).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "folder_layouts read failed",
      "connection reset",
    );
    errorSpy.mockRestore();
  });
});

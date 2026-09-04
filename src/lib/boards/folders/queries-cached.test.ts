import { describe, expect, it, vi } from "vitest";

// `cacheTag`/`cacheLife` throw outside a compiled `use cache` scope (the Next
// transform that no-ops them is not applied under Vitest), so stub next/cache.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

function makeClient(
  tables: Record<string, { rows: unknown[] | null; error?: unknown }>,
) {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    client: {
      from: (table: string) => {
        const qb: Record<string, unknown> = {};
        qb.select = () => qb;
        qb.eq = (col: string, val: unknown) => {
          calls.push([table, "eq:" + col, val]);
          return qb;
        };
        qb.limit = () => qb;
        qb.order = () =>
          Promise.resolve({
            data: tables[table]?.rows ?? [],
            error: tables[table]?.error ?? null,
          });
        return qb;
      },
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/service";
import { listBoardFoldersCached } from "./queries-cached";

describe("listBoardFoldersCached", () => {
  it("filters both reads by the passed userId (tenant boundary) and maps rows", async () => {
    const { client, calls } = makeClient({
      board_folders: { rows: [{ id: "f1", name: "Acme", position: 2 }] },
      board_folder_boards: {
        rows: [{ board_id: "b1", folder_id: "f1", position: 0 }],
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await listBoardFoldersCached("user-1");

    // Non-null asserts the success/failure discrimination in passing: a healthy
    // read must not come back as the `null` failure sentinel.
    expect(result).not.toBeNull();
    expect(result?.folders).toEqual([{ id: "f1", name: "Acme", position: 2 }]);
    expect(result?.placements).toEqual([
      { boardId: "b1", folderId: "f1", position: 0 },
    ]);
    // The service client bypasses RLS: these filters ARE the tenant boundary.
    expect(calls).toContainEqual(["board_folders", "eq:user_id", "user-1"]);
    expect(calls).toContainEqual([
      "board_folder_boards",
      "eq:user_id",
      "user-1",
    ]);
  });

  it("reports a read error as `null`, NOT as an empty folder list", async () => {
    // The distinction is load-bearing downstream. Returning `{ folders: [],
    // placements: [] }` here made a one-off Supabase blip indistinguishable from
    // "this user has no folders", and `BoardsNav`'s prune effect read that as a
    // licence to delete every persisted `folder:*` collapse key — silently and
    // irreversibly. `null` means UNKNOWN; the shell still degrades to a flat
    // list rather than blanking, it just no longer lies about why.
    const { client } = makeClient({
      board_folders: { rows: null, error: { message: "boom" } },
      board_folder_boards: { rows: [] },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await expect(listBoardFoldersCached("user-1")).resolves.toBeNull();
  });

  it("reports a placements read error as `null` too", async () => {
    const { client } = makeClient({
      board_folders: { rows: [] },
      board_folder_boards: { rows: null, error: { message: "boom" } },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await expect(listBoardFoldersCached("user-1")).resolves.toBeNull();
  });

  it("still reports a genuinely empty account as empty lists, not `null`", async () => {
    const { client } = makeClient({
      board_folders: { rows: [] },
      board_folder_boards: { rows: [] },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await expect(listBoardFoldersCached("user-1")).resolves.toEqual({
      folders: [],
      placements: [],
    });
  });
});

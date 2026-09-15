import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/service";
import { listFoldersCached } from "./queries-cached";

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

describe("listFoldersCached", () => {
  it("filters by org AND workspace (tenant boundary on the service client) and maps rows", async () => {
    const { client, calls } = makeClient({
      folders: {
        rows: [
          {
            id: "f1",
            name: "Q4",
            workspace_id: "w1",
            org_id: "o1",
            position: 0,
          },
        ],
      },
      folder_boards: {
        rows: [
          {
            board_id: "b1",
            folder_id: "f1",
            position: 0,
            folders: { workspace_id: "w1", org_id: "o1" },
          },
        ],
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );
    const result = await listFoldersCached("o1", "w1");
    expect(result).toEqual({
      folders: [
        { id: "f1", name: "Q4", workspaceId: "w1", orgId: "o1", position: 0 },
      ],
      placements: [{ boardId: "b1", folderId: "f1", position: 0 }],
    });
    expect(calls).toContainEqual(["folders", "eq:org_id", "o1"]);
    expect(calls).toContainEqual(["folders", "eq:workspace_id", "w1"]);
    // The placements read must filter on BOTH folders.org_id and
    // folders.workspace_id — org_id alone (or workspace_id alone) is not the
    // full tenant boundary on the service client, which bypasses RLS.
    expect(calls).toContainEqual(["folder_boards", "eq:folders.org_id", "o1"]);
    expect(calls).toContainEqual([
      "folder_boards",
      "eq:folders.workspace_id",
      "w1",
    ]);
  });

  it("reports a read error as null, not an empty list", async () => {
    const { client } = makeClient({
      folders: { rows: null, error: { message: "boom" } },
      folder_boards: { rows: [] },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );
    await expect(listFoldersCached("o1", "w1")).resolves.toBeNull();
  });
});

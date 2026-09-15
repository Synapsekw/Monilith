import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("./queries", () => ({
  getFolderHead: vi.fn(async () => ({
    folder: {
      id: "f1",
      name: "Q4",
      workspaceId: "w1",
      orgId: "o1",
      position: 0,
    },
    boards: [{ id: "b1", name: "Backend", position: 0 }],
  })),
  listLatestBriefs: vi.fn(async () => [
    {
      boardId: "b1",
      boardName: "Backend",
      brief: "ok",
      generatedAt: "2026-09-15T00:00:00.000Z",
    },
  ]),
}));
const order: string[] = [];
vi.mock("./resolve", () => ({
  resolveFolderRollup: vi.fn(async () => {
    order.push("rollup");
    return { ok: true, rows: [] };
  }),
  resolveFolderBurn: vi.fn(async () => {
    order.push("burn");
    return { ok: false, error: "boom" };
  }),
  resolveFolderAttention: vi.fn(async () => {
    order.push("attention");
    return { ok: true, rows: [] };
  }),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: vi.fn(async () => [
    { userId: "u1", fullName: "Ada", email: null, avatarUrl: null },
  ]),
}));

import { getFolderHead, listLatestBriefs } from "./queries";
import { resolveFolderAttention } from "./resolve";
import { buildFolderPayload } from "./payload";

const supabase = {} as SupabaseClient<Database>;

describe("buildFolderPayload", () => {
  it("runs head + three RPCs concurrently, then briefs; a failed RPC is null, not a throw", async () => {
    const p = await buildFolderPayload(supabase, "f1", "u1");
    expect(p).not.toBeNull();
    expect(p!.rollup).toEqual([]);
    expect(p!.burn).toBeNull();
    expect(p!.attention).toEqual([]);
    expect(p!.briefs).toHaveLength(1);
    expect(p!.members).toEqual([
      { userId: "u1", fullName: "Ada", avatarUrl: null },
    ]);
    expect(resolveFolderAttention).toHaveBeenCalledWith(supabase, "f1", 20);
    expect(listLatestBriefs).toHaveBeenCalledWith(
      supabase,
      [{ id: "b1", name: "Backend", position: 0 }],
      "u1",
    );
    expect(p!.todayISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(p!.generatedAt).getTime()).not.toBeNaN();
  });

  it("returns null when the folder is hidden or absent", async () => {
    vi.mocked(getFolderHead).mockResolvedValueOnce(null);
    expect(await buildFolderPayload(supabase, "f1", "u1")).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

/**
 * Concurrency proof: each first-paint read pushes `start:<name>` synchronously
 * on call, then yields a macrotask (`tick`) before pushing `end:<name>`. If
 * `buildFolderPayload` ever regresses from `Promise.all` to sequential
 * `await`s, the four first-paint reads would each fully start-and-end before
 * the next one starts — this order log makes that regression visible instead
 * of the four resolvers merely "somehow all getting called".
 */
const order: string[] = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

vi.mock("./queries", () => ({
  getFolderHead: vi.fn(async () => {
    order.push("start:head");
    await tick();
    order.push("end:head");
    return {
      folder: {
        id: "f1",
        name: "Q4",
        workspaceId: "w1",
        orgId: "o1",
        position: 0,
      },
      boards: [{ id: "b1", name: "Backend", position: 0 }],
    };
  }),
  listLatestBriefs: vi.fn(async () => {
    order.push("start:briefs");
    return [
      {
        boardId: "b1",
        boardName: "Backend",
        brief: "ok",
        generatedAt: "2026-09-15T00:00:00.000Z",
      },
    ];
  }),
}));
vi.mock("./resolve", () => ({
  resolveFolderRollup: vi.fn(async () => {
    order.push("start:rollup");
    await tick();
    order.push("end:rollup");
    return { ok: true, rows: [] };
  }),
  resolveFolderBurn: vi.fn(async () => {
    order.push("start:burn");
    await tick();
    order.push("end:burn");
    return { ok: false, error: "boom" };
  }),
  resolveFolderAttention: vi.fn(async () => {
    order.push("start:attention");
    await tick();
    order.push("end:attention");
    return { ok: true, rows: [] };
  }),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: vi.fn(async () => {
    order.push("start:members");
    return [{ userId: "u1", fullName: "Ada", email: null, avatarUrl: null }];
  }),
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

    // Wave A ran as ONE Promise.all: every first-paint read must START before
    // ANY of them ENDS. A regression to sequential awaits would instead
    // produce start:head, end:head, start:rollup, end:rollup, ... — one
    // complete start/end pair before the next read even starts.
    const firstPaintReads = ["head", "rollup", "burn", "attention"] as const;
    const startIdx = Object.fromEntries(
      firstPaintReads.map((name) => [name, order.indexOf(`start:${name}`)]),
    );
    const endIdx = Object.fromEntries(
      firstPaintReads.map((name) => [name, order.indexOf(`end:${name}`)]),
    );
    const firstEnd = Math.min(...Object.values(endIdx));
    for (const name of firstPaintReads) {
      expect(startIdx[name]).toBeLessThan(firstEnd);
    }

    // Wave B (briefs, members) needs head's result (board ids / org id), so
    // it must only start once wave A's head read has ended.
    expect(order.indexOf("start:briefs")).toBeGreaterThan(endIdx.head);
    expect(order.indexOf("start:members")).toBeGreaterThan(endIdx.head);
  });

  it("returns null when the folder is hidden or absent", async () => {
    vi.mocked(getFolderHead).mockResolvedValueOnce(null);
    expect(await buildFolderPayload(supabase, "f1", "u1")).toBeNull();
  });
});

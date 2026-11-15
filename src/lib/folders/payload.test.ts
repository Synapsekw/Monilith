import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  getFolderLayoutRow: vi.fn(async () => {
    order.push("start:layout");
    await tick();
    order.push("end:layout");
    return null;
  }),
  getOrgTimeZone: vi.fn(async () => "Pacific/Kiritimati"),
}));
vi.mock("@/lib/profile/queries-cached", () => ({
  getUserTimeZoneCached: vi.fn(async () => null),
}));
vi.mock("./resolve", () => ({
  resolveFolderRollup: vi.fn(async () => {
    order.push("start:rollup");
    await tick();
    order.push("end:rollup");
    return { ok: true, rows: [] };
  }),
  resolveFolderLoad: vi.fn(async () => {
    order.push("start:load");
    await tick();
    order.push("end:load");
    return {
      ok: true,
      weeks: ["2026-09-14"],
      rows: [
        {
          boardId: "b1",
          stageKey: "build",
          weekStart: "2026-09-14",
          openDue: 3,
        },
      ],
    };
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
vi.mock("@/lib/org/visible-roster", () => ({
  visibleOrgMembersFor: vi.fn(async () => {
    order.push("start:members");
    return [{ userId: "u1", fullName: "Ada", email: null, avatarUrl: null }];
  }),
}));

vi.mock("./sharing-queries", () => ({
  getFolderAccessHead: vi.fn(async () => {
    order.push("start:access");
    await tick();
    order.push("end:access");
    return { count: 2, memberIds: ["m1", "m2"], canManage: true };
  }),
}));

import {
  getFolderHead,
  getFolderLayoutRow,
  getOrgTimeZone,
  listLatestBriefs,
} from "./queries";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import {
  resolveFolderAttention,
  resolveFolderBurn,
  resolveFolderLoad,
  resolveFolderRollup,
} from "./resolve";
import { ATTENTION_LIMIT, buildFolderPayload } from "./payload";

const supabase = {} as SupabaseClient<Database>;

describe("buildFolderPayload", () => {
  // Mocks are module-scoped (shared across every `it` in this file), and
  // several new cases assert exact call counts (`toHaveBeenCalledTimes`,
  // `not.toHaveBeenCalled`) on `resolveFolderBurn`/`getFolderLayoutRow` — those
  // would see calls left over from earlier tests without a reset. Clearing
  // call history (not implementations) each test keeps every case reading
  // only its own invocation.
  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
  });

  it("runs head + three RPCs concurrently, then briefs; a failed RPC is null, not a throw", async () => {
    const p = await buildFolderPayload(supabase, "f1", "u1");
    expect(p).not.toBeNull();
    expect(p!.rollup).toEqual([]);
    expect(p!.burnPacked).toBeNull();
    expect(p!.attention).toEqual([]);
    expect(p!.briefs).toHaveLength(1);
    expect(p!.members).toEqual([
      { userId: "u1", fullName: "Ada", email: null, avatarUrl: null },
    ]);
    // The Overview panel shows 20 but classifies by stage on the CLIENT, so
    // the RPC has to return a wider pool than the visible list (finding I4).
    expect(ATTENTION_LIMIT).toBe(100);
    expect(resolveFolderAttention).toHaveBeenCalledWith(
      supabase,
      "f1",
      ATTENTION_LIMIT,
    );
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
    // `burn` moved into wave B behind the layout gate (Task 3); `layout`
    // takes its place as the fourth wave-A read alongside head/rollup/attention.
    const firstPaintReads = [
      "head",
      "rollup",
      "layout",
      "attention",
      "access",
    ] as const;
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

    // Briefs and members need head's result (board ids / org id), so they
    // must only start once the head read has ended.
    expect(order.indexOf("start:briefs")).toBeGreaterThan(endIdx.head);
    expect(order.indexOf("start:members")).toBeGreaterThan(endIdx.head);
  });

  describe("todayISO: viewer zone, then organisation zone, then UTC (as the folder RPCs)", () => {
    // 2026-11-15 22:30 UTC: already the 16th in Kiritimati (+14), still the
    // 15th in Honolulu (−10) and in UTC.
    const at = new Date("2026-11-15T22:30:00Z");
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(at);
    });
    afterEach(() => vi.useRealTimers());

    it("uses the organisation's zone when the viewer has none", async () => {
      const p = await buildFolderPayload(supabase, "f1", "u1");
      expect(getOrgTimeZone).toHaveBeenCalledWith(supabase, "o1");
      expect(getUserTimeZoneCached).toHaveBeenCalledWith("u1");
      expect(p!.todayISO).toBe("2026-11-16");
    });

    it("prefers the viewer's own zone", async () => {
      vi.mocked(getUserTimeZoneCached).mockResolvedValueOnce(
        "Pacific/Honolulu",
      );
      const p = await buildFolderPayload(supabase, "f1", "u1");
      expect(p!.todayISO).toBe("2026-11-15");
    });

    it("falls back to UTC when neither zone can be read, without failing the page", async () => {
      vi.mocked(getUserTimeZoneCached).mockRejectedValueOnce(new Error("x"));
      vi.mocked(getOrgTimeZone).mockRejectedValueOnce(new Error("x"));
      const p = await buildFolderPayload(supabase, "f1", "u1");
      expect(p!.todayISO).toBe("2026-11-15");
    });
  });

  it("carries the folder's access head from wave A", async () => {
    const p = await buildFolderPayload(supabase, "f1", "u1");
    expect(p!.access).toEqual({
      count: 2,
      memberIds: ["m1", "m2"],
      canManage: true,
    });
  });

  it("returns null when the folder is hidden or absent", async () => {
    vi.mocked(getFolderHead).mockResolvedValueOnce(null);
    expect(await buildFolderPayload(supabase, "f1", "u1")).toBeNull();
  });

  it("reads the layout in wave A, alongside head/rollup/attention", async () => {
    await buildFolderPayload(supabase, "f1", "u1");
    // Every wave-A read starts before any of them ends.
    const firstEnd = order.findIndex((e) => e.startsWith("end:"));
    expect(order.slice(0, firstEnd)).toContain("start:layout");
  });

  it("skips folder_burn when the layout needs neither a burn section nor a stages tab", async () => {
    vi.mocked(getFolderLayoutRow).mockResolvedValueOnce({
      preset: "blank",
      config: {
        v: 1,
        tabs: [
          { id: "overview", label: "Overview", kind: "canvas", sections: [] },
        ],
      },
      version: 3,
    });
    const payload = await buildFolderPayload(supabase, "f1", "u1");
    expect(resolveFolderBurn).not.toHaveBeenCalled();
    expect(payload?.burnPacked).toBeNull();
  });

  it("still runs folder_burn when the layout has a stages tab but no burn section", async () => {
    vi.mocked(getFolderLayoutRow).mockResolvedValueOnce({
      preset: "crm",
      config: {
        v: 1,
        tabs: [
          { id: "overview", label: "Overview", kind: "canvas", sections: [] },
          { id: "stages", label: "Pipeline", kind: "stages" },
        ],
      },
      version: 3,
    });
    await buildFolderPayload(supabase, "f1", "u1");
    expect(resolveFolderBurn).toHaveBeenCalledTimes(1);
  });

  it("returns the project preset when the folder has no layout row", async () => {
    vi.mocked(getFolderLayoutRow).mockResolvedValueOnce(null);
    const payload = await buildFolderPayload(supabase, "f1", "u1");
    expect(payload?.layout.preset).toBe("project");
    expect(payload?.layout.version).toBe(0);
  });

  describe("folder_load", () => {
    const dated = {
      ok: true as const,
      rows: [{ minDue: "2026-09-01", maxDue: "2026-09-30" }] as never,
    };

    it("is skipped when the layout has no load section", async () => {
      vi.mocked(getFolderLayoutRow).mockResolvedValueOnce({
        preset: "blank",
        config: {
          v: 1,
          tabs: [
            { id: "overview", label: "Overview", kind: "canvas", sections: [] },
          ],
        },
        version: 3,
      });
      vi.mocked(resolveFolderRollup).mockResolvedValueOnce(dated);
      const p = await buildFolderPayload(supabase, "f1", "u1");
      expect(resolveFolderLoad).not.toHaveBeenCalled();
      expect(p!.load).toEqual({ status: "skipped" });
    });

    it("is read alongside the rollup but discarded when the folder has no dated items", async () => {
      // default layout (project) has a load section; the rollup mock is [].
      const p = await buildFolderPayload(supabase, "f1", "u1");
      expect(resolveFolderLoad).toHaveBeenCalledTimes(1);
      expect(p!.load).toEqual({ status: "skipped" });
    });

    it("is discarded when the rollup failed", async () => {
      vi.mocked(resolveFolderRollup).mockResolvedValueOnce({
        ok: false,
        error: "boom",
      });
      const p = await buildFolderPayload(supabase, "f1", "u1");
      expect(p!.load).toEqual({ status: "skipped" });
    });

    it("carries the server's weeks and rows when the layout wants it and dates exist", async () => {
      vi.mocked(resolveFolderRollup).mockResolvedValueOnce(dated);
      const p = await buildFolderPayload(supabase, "f1", "u1");
      expect(resolveFolderLoad).toHaveBeenCalledTimes(1);
      expect(resolveFolderLoad).toHaveBeenCalledWith(supabase, "f1");
      expect(p!.load).toEqual({
        status: "ready",
        weeks: ["2026-09-14"],
        rows: [
          {
            boardId: "b1",
            stageKey: "build",
            weekStart: "2026-09-14",
            openDue: 3,
          },
        ],
      });
      // Gated on the layout only: starts once the layout read has ended,
      // beside the burn read.
      expect(order.indexOf("start:load")).toBeGreaterThan(
        order.indexOf("end:layout"),
      );
      expect(order.indexOf("start:load")).toBeLessThan(
        order.indexOf("end:burn"),
      );
    });

    it("is failed, not a throw and not skipped, when the read fails", async () => {
      vi.mocked(resolveFolderRollup).mockResolvedValueOnce(dated);
      vi.mocked(resolveFolderLoad).mockResolvedValueOnce({
        ok: false,
        error: "boom",
      });
      const p = await buildFolderPayload(supabase, "f1", "u1");
      expect(p).not.toBeNull();
      expect(p!.load).toEqual({ status: "failed" });
    });
  });

  describe("read scheduling", () => {
    it("issues burn and load as soon as the layout resolves, without awaiting the rollup", async () => {
      type Rollup = Awaited<ReturnType<typeof resolveFolderRollup>>;
      type LayoutRow = Awaited<ReturnType<typeof getFolderLayoutRow>>;
      let releaseRollup: (v: Rollup) => void = () => {};
      let releaseLayout: (v: LayoutRow) => void = () => {};
      vi.mocked(resolveFolderRollup).mockReturnValueOnce(
        new Promise<Rollup>((r) => {
          releaseRollup = r;
        }),
      );
      vi.mocked(getFolderLayoutRow).mockReturnValueOnce(
        new Promise<LayoutRow>((r) => {
          releaseLayout = r;
        }),
      );
      const pending = buildFolderPayload(supabase, "f1", "u1");
      await tick();
      // The layout is unknown: nothing that depends on it is issued yet.
      expect(resolveFolderBurn).not.toHaveBeenCalled();
      expect(resolveFolderLoad).not.toHaveBeenCalled();
      releaseLayout(null);
      await tick();
      // The rollup is STILL pending, yet both layout-gated reads are out.
      expect(resolveFolderBurn).toHaveBeenCalledTimes(1);
      expect(resolveFolderLoad).toHaveBeenCalledTimes(1);
      releaseRollup({
        ok: true,
        rows: [{ minDue: "2026-09-01", maxDue: "2026-09-30" }] as never,
      });
      const p = await pending;
      expect(p!.load.status).toBe("ready");
    });
  });
});

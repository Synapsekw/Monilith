import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDashboardPayload, tableReads, folderRow } = vi.hoisted(() => ({
  getDashboardPayload: vi.fn(),
  tableReads: [] as string[],
  folderRow: { current: { id: "f1" } as { id: string } | null },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/dashboards/queries", () => ({
  getDashboardPayload: (id: string) => getDashboardPayload(id),
}));
vi.mock("@/lib/dashboards/board-options", () => ({
  buildBoardOptions: () => [],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      tableReads.push(table);
      type Chain = PromiseLike<{ data: unknown[] }> & {
        select: () => Chain;
        eq: () => Chain;
        is: () => Chain;
        order: () => Chain;
        maybeSingle: () => Promise<{ data: unknown }>;
      };
      const chain: Chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: folderRow.current }),
        then: (onFulfilled, onRejected) =>
          Promise.resolve({ data: [] }).then(onFulfilled, onRejected),
      };
      return chain;
    },
  }),
}));
vi.mock("@/components/dashboards/DashboardCanvasLazy", () => ({
  DashboardCanvasLazy: () => null,
}));
vi.mock("@/components/dashboards/ai/AiReviewBanner", () => ({
  AiReviewBanner: () => null,
}));

import DashboardPage from "./page";

const run = (sp: Record<string, string> = {}) =>
  DashboardPage({
    params: Promise.resolve({ dashboardId: "d1" }),
    searchParams: Promise.resolve(sp),
  });

const dashboard = (folderId: string | null) => ({
  dashboard: { id: "d1", folder_id: folderId, workspace_id: "w1" },
});

beforeEach(() => {
  vi.clearAllMocks();
  tableReads.length = 0;
  folderRow.current = { id: "f1" };
});

describe("DashboardPage — folder probe", () => {
  it("skips the probe under ?review=1, where its answer could not redirect anyway", async () => {
    getDashboardPayload.mockResolvedValue(dashboard("f1"));

    await run({ review: "1" });

    expect(tableReads).toEqual(["boards", "columns"]);
  });

  it("redirects a folder-attached dashboard without issuing the source-board reads", async () => {
    getDashboardPayload.mockResolvedValue(dashboard("f1"));

    await expect(run()).rejects.toThrow(
      "REDIRECT:/folders/f1?tab=overview#widgets",
    );
    expect(tableReads).toEqual(["folders"]);
  });

  it("falls back to the legacy canvas when the folder is gone or RLS-hidden", async () => {
    getDashboardPayload.mockResolvedValue(dashboard("f1"));
    folderRow.current = null;

    await run();

    expect(tableReads).toEqual(["folders", "boards", "columns"]);
  });

  it("issues no probe for a dashboard with no folder", async () => {
    getDashboardPayload.mockResolvedValue(dashboard(null));

    await run();

    expect(tableReads).toEqual(["boards", "columns"]);
  });
});

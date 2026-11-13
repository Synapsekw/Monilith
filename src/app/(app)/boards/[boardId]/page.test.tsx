import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getBoardPayload,
  listOrgMembersCached,
  resolveActiveOrg,
  redirect,
  cookieStore,
} = vi.hoisted(() => ({
  getBoardPayload: vi.fn(),
  listOrgMembersCached: vi.fn(),
  resolveActiveOrg: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  cookieStore: new Map<string, string>(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      cookieStore.has(n) ? { name: n, value: cookieStore.get(n)! } : undefined,
  }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    type Chain = PromiseLike<{ data: unknown[] }> & {
      select: () => Chain;
      eq: () => Chain;
      order: () => Chain;
    };
    const chain: Chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      then: (onFulfilled, onRejected) =>
        Promise.resolve({ data: [] }).then(onFulfilled, onRejected),
    };
    return { from: () => chain };
  },
}));
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (id: string) => getBoardPayload(id),
  deriveBoardAccess: () => "owner",
}));
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (orgId: string) => listOrgMembersCached(orgId),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/boards/views", () => ({ resolveSelectedView: () => null }));
vi.mock("@/lib/boards/view-prefs", () => ({
  getBoardViewPrefs: async () => ({ viewId: null }),
}));
vi.mock("@/lib/boards/intelligence/visits", () => ({
  getBoardLastSeenAt: async () => null,
}));
vi.mock("@/lib/ai/board-intelligence/runs", () => ({
  getLatestBoardIntelligenceRun: async () => null,
}));
vi.mock("@/components/boards/BoardViews", () => ({ BoardViews: () => null }));
vi.mock("@/components/boards/dock/BoardDock", () => ({
  BoardDock: () => null,
}));
vi.mock("@/components/boards/ai/AiBoardReviewBanner", () => ({
  AiBoardReviewBanner: () => null,
}));

import BoardPage from "./page";
import { BoardViews } from "@/components/boards/BoardViews";

const BOARD = "0b9e2a51-6f5c-4d7a-9c3e-8f1d2b4a6c0e";
const member = (userId: string) => ({ userId, fullName: userId });
const payloadIn = (orgId: string, archivedAt: string | null = null) => ({
  board: { id: BOARD, org_id: orgId, archived_at: archivedAt },
  views: [],
  columns: [],
});

const run = () =>
  BoardPage({
    params: Promise.resolve({ boardId: BOARD }),
    searchParams: Promise.resolve({}),
  });

/** The props the page handed to <BoardViews>, found by walking the tree. */
function boardViewsProps(node: ReactNode): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = boardViewsProps(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === BoardViews) return el.props as Record<string, unknown>;
  return boardViewsProps(el.props?.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  resolveActiveOrg.mockResolvedValue({ id: "o1", name: "Acme" });
  listOrgMembersCached.mockImplementation(async (orgId: string) => [
    member(`member-of-${orgId}`),
  ]);
});

describe("BoardPage — org member roster", () => {
  it("reads the active org's roster alongside the payload, and reuses it", async () => {
    let releasePayload: (v: unknown) => void = () => {};
    getBoardPayload.mockReturnValue(
      new Promise((resolve) => {
        releasePayload = resolve;
      }),
    );

    const pending = run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // In flight BEFORE the payload has answered — no second wave.
    expect(listOrgMembersCached).toHaveBeenCalledWith("o1");

    releasePayload(payloadIn("o1"));
    const props = boardViewsProps(await pending);
    expect(props?.members).toEqual([member("member-of-o1")]);
    expect(listOrgMembersCached).toHaveBeenCalledTimes(1);
  });

  it("uses the BOARD's org roster for a board outside the active org", async () => {
    getBoardPayload.mockResolvedValue(payloadIn("o2"));

    const props = boardViewsProps(await run());

    expect(props?.members).toEqual([member("member-of-o2")]);
    expect(listOrgMembersCached).toHaveBeenLastCalledWith("o2");
  });

  it("falls back to the board's org when there is no active org", async () => {
    resolveActiveOrg.mockResolvedValue(null);
    getBoardPayload.mockResolvedValue(payloadIn("o2"));

    const props = boardViewsProps(await run());

    expect(props?.members).toEqual([member("member-of-o2")]);
    expect(listOrgMembersCached).toHaveBeenCalledTimes(1);
  });

  it("falls back, rather than failing the page, when the active-org read throws", async () => {
    resolveActiveOrg.mockRejectedValue(new Error("db down"));
    getBoardPayload.mockResolvedValue(payloadIn("o1"));

    const props = boardViewsProps(await run());

    expect(props?.members).toEqual([member("member-of-o1")]);
  });

  it("404s a missing board", async () => {
    getBoardPayload.mockResolvedValue(null);

    await expect(run()).rejects.toThrow("NOT_FOUND");
  });
});

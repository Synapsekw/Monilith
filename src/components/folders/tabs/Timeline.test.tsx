import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GanttCanvasProps } from "@/components/boards/gantt/GanttCanvas";
import type { FolderTimelineData } from "@/lib/boards/timeline-context";
import type { RollupRow } from "@/lib/folders/types";

const m = vi.hoisted(() => ({
  getFolderTimeline: vi.fn(),
  upsertCell: vi.fn(),
  createDependency: vi.fn(),
  deleteDependency: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
  canvas: { current: null as GanttCanvasProps | null },
}));

vi.mock("@/lib/folders/actions", () => ({
  getFolderTimeline: m.getFolderTimeline,
}));
vi.mock("@/lib/boards/actions", () => ({ upsertCell: m.upsertCell }));
vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: m.createDependency,
  deleteDependency: m.deleteDependency,
}));
vi.mock("sonner", () => ({ toast: { error: m.toastError } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push, refresh: m.refresh }),
}));
// The real canvas is exercised in its own suite; here a probe records the
// props so the tests can assert what the tab hands it and drive its callbacks.
vi.mock("@/components/boards/gantt/GanttCanvas", () => ({
  GanttCanvas: (p: GanttCanvasProps) => {
    m.canvas.current = p;
    return (
      <div data-testid="canvas">{p.rows.map((r) => r.name).join("|")}</div>
    );
  },
}));

import { TimelineInner } from "./TimelineInner";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DA = "f0000000-0000-4000-8000-00000000000a";
const I1 = "11111111-1111-4111-8111-111111111111";
const I2 = "22222222-2222-4222-8222-222222222222";

const empty: FolderTimelineData = {
  board_order: [],
  boards: [],
  items: [],
  external_item_ids: [],
  dependencies: [],
  total_items: 0,
  truncated: false,
};

const data: FolderTimelineData = {
  board_order: [A, B],
  boards: [
    {
      id: A,
      name: "Platform",
      can_edit: true,
      date_columns: [{ id: DA, name: "Due" }],
      timeline_config: null,
      groups: [{ id: GA, name: "MVP", color: "#579bfc", position: 0 }],
    },
    {
      id: B,
      name: "Sites",
      can_edit: false,
      date_columns: [],
      timeline_config: null,
      groups: [{ id: GB, name: "Pilot", color: "#888888", position: 0 }],
    },
  ],
  items: [
    {
      id: I1,
      board_id: A,
      group_id: GA,
      parent_id: null,
      name: "QCC build",
      position: 0,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      dates: { [DA]: { date: "2026-11-10" } },
    },
    {
      id: I2,
      board_id: A,
      group_id: GA,
      parent_id: null,
      name: "Bench test",
      position: 1,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      dates: { [DA]: { date: "2026-11-12" } },
    },
  ],
  external_item_ids: [],
  dependencies: [],
  total_items: 2,
  truncated: false,
};

const renderTab = (rollup?: RollupRow[]) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TimelineInner folderId="f1" stage={null} board={null} rollup={rollup} />
    </QueryClientProvider>,
  );
  return client;
};
const canvas = () => {
  if (!m.canvas.current) throw new Error("canvas not rendered");
  return m.canvas.current;
};

/** Roll-up first: item rows exist only once a board and its group are open. */
const openGroup = (boardId: string, groupId: string) => {
  act(() => canvas().onToggleExpand?.(`board:${boardId}`));
  act(() => canvas().onToggleExpand?.(`group:${groupId}`));
};
const canvasText = () => screen.getByTestId("canvas").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  m.canvas.current = null;
});

describe("TimelineInner", () => {
  it("shows the cap notice when truncated", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({
      ok: true,
      data: { ...empty, total_items: 6200, truncated: true },
    });
    renderTab();
    expect(
      await screen.findByText("Showing the first 5,000 of 6,200 items"),
    ).toBeInTheDocument();
  });

  it("shows the load error", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({
      ok: false,
      error: "Folder not found.",
    });
    renderTab();
    expect(
      await screen.findByText(/Couldn.t load the timeline/),
    ).toBeInTheDocument();
  });

  it("opens as one row per board and drills down board → group → items", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    renderTab();
    await screen.findByTestId("canvas");
    expect(canvasText()).toBe("Platform|Sites · No dates on this board");
    expect(canvas().isExpanded?.(`board:${A}`)).toBe(false);
    act(() => canvas().onToggleExpand?.(`board:${A}`));
    expect(canvasText()).toBe("Platform|MVP|Sites · No dates on this board");
    expect(canvas().isExpanded?.(`board:${A}`)).toBe(true);
    expect(canvas().isExpanded?.(`group:${GA}`)).toBe(false);
    act(() => canvas().onToggleExpand?.(`group:${GA}`));
    expect(canvasText()).toBe(
      "Platform|MVP|QCC build|Bench test|Sites · No dates on this board",
    );
    expect(canvas().isExpanded?.(`group:${GA}`)).toBe(true);
    // Bars take their group's colour; edits only where the board allows.
    const qcc = canvas().rows.find((r) => r.name === "QCC build")!;
    expect(canvas().colorFor(qcc)).toBe("#579bfc");
    expect(canvas().canEditItem(I1)).toBe(true);
  });

  it("zoom, expand and collapse re-derive locally with no new fetch", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    renderTab();
    await screen.findByTestId("canvas");
    expect(screen.getByText(/2 boards · 2 items/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(canvas().zoom).toBe("week");
    openGroup(A, GA);
    expect(canvasText()).toBe(
      "Platform|MVP|QCC build|Bench test|Sites · No dates on this board",
    );
    act(() => canvas().onToggleExpand?.(`board:${A}`));
    expect(canvasText()).toBe("Platform|Sites · No dates on this board");
    // Reopening the board finds its group still open.
    act(() => canvas().onToggleExpand?.(`board:${A}`));
    expect(canvasText()).toBe(
      "Platform|MVP|QCC build|Bench test|Sites · No dates on this board",
    );
    // The header counts the data, not the rows left visible.
    expect(screen.getByText(/2 boards · 2 items/)).toBeInTheDocument();
    expect(m.getFolderTimeline).toHaveBeenCalledTimes(1);
  });

  it("moves a bar optimistically through upsertCell, without a refresh", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    m.upsertCell.mockResolvedValue({ ok: true, data: { cell: {} } });
    const client = renderTab();
    await screen.findByTestId("canvas");
    openGroup(A, GA);
    await act(async () => canvas().onMoveBar(I1, 2));
    expect(m.upsertCell).toHaveBeenCalledWith({
      itemId: I1,
      columnId: DA,
      value: { date: "2026-11-12", end: "2026-11-12" },
    });
    const cached = client.getQueryData<FolderTimelineData>([
      "folder-timeline",
      "f1",
    ]);
    expect(cached?.items.find((i) => i.id === I1)?.dates[DA]).toEqual({
      date: "2026-11-12",
      end: "2026-11-12",
    });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("rolls a failed write back and says why", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    m.upsertCell.mockResolvedValue({ ok: false, error: "No access." });
    const client = renderTab();
    await screen.findByTestId("canvas");
    openGroup(A, GA);
    await act(async () => canvas().onMoveBar(I1, 2));
    expect(m.toastError).toHaveBeenCalledWith("No access.", {
      id: `timeline-write:${I1}`,
    });
    const cached = client.getQueryData<FolderTimelineData>([
      "folder-timeline",
      "f1",
    ]);
    expect(cached?.items.find((i) => i.id === I1)?.dates[DA]).toEqual({
      date: "2026-11-10",
    });
  });

  it("adds and removes a link in the cached payload", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    const row = {
      id: "33333333-3333-4333-8333-333333333333",
      org_id: "o1",
      board_id: A,
      predecessor_board_id: A,
      predecessor_id: I1,
      successor_id: I2,
      type: "finish_to_start",
      created_at: "2026-11-14T00:00:00Z",
    };
    m.createDependency.mockResolvedValue({
      ok: true,
      data: { dependency: row },
    });
    m.deleteDependency.mockResolvedValue({ ok: false, error: "Nope." });
    const client = renderTab();
    // A board cache already loaded this session gets the row too.
    client.setQueryData(["board", A], { dependencies: [] });
    await screen.findByTestId("canvas");
    await act(async () =>
      canvas().onAddDependency({ predecessorId: I1, successorId: I2 }),
    );
    // Adding the same row again (e.g. a duplicate response) never doubles it.
    await act(async () =>
      canvas().onAddDependency({ predecessorId: I1, successorId: I2 }),
    );
    const key = ["folder-timeline", "f1"];
    expect(client.getQueryData<FolderTimelineData>(key)?.dependencies).toEqual([
      {
        id: "33333333-3333-4333-8333-333333333333",
        predecessor_id: I1,
        successor_id: I2,
      },
    ]);
    expect(
      client.getQueryData<{ dependencies: unknown[] }>(["board", A])
        ?.dependencies,
    ).toEqual([row]);
    // A failed removal restores the link.
    await act(async () =>
      canvas().onRemoveDependency({
        dependencyId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(m.toastError).toHaveBeenCalledWith("Nope.");
    expect(
      client.getQueryData<FolderTimelineData>(key)?.dependencies,
    ).toHaveLength(1);
  });

  it("offers in-view items as link candidates and opens items on their board", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    renderTab();
    await screen.findByTestId("canvas");
    openGroup(A, GA);
    const row = canvas().rows.find((r) => r.itemId === I1)!;
    expect(canvas().linkCandidates(row)).toEqual([
      { itemId: I2, name: "Bench test · Platform" },
    ]);
    canvas().onItemTap(I1, new DOMRect());
    expect(m.push).toHaveBeenCalledWith(`/boards/${A}?item=${I1}`);
  });

  it("offers no links and no edits on a board the viewer can only read", async () => {
    const DB = "f0000000-0000-4000-8000-00000000000b";
    const I3 = "44444444-4444-4444-8444-444444444444";
    m.getFolderTimeline.mockResolvedValueOnce({
      ok: true,
      data: {
        ...data,
        boards: data.boards.map((b) =>
          b.id === B ? { ...b, date_columns: [{ id: DB, name: "Due" }] } : b,
        ),
        items: [
          ...data.items,
          {
            ...data.items[0]!,
            id: I3,
            board_id: B,
            group_id: GB,
            name: "Site survey",
            dates: { [DB]: { date: "2026-11-05" } },
          },
        ],
      },
    });
    renderTab();
    await screen.findByTestId("canvas");
    openGroup(A, GA);
    openGroup(B, GB);
    expect(screen.getByTestId("canvas")).toHaveTextContent("Site survey");
    const row = canvas().rows.find((r) => r.itemId === I3)!;
    expect(canvas().canEditItem(I3)).toBe(false);
    expect(canvas().linkCandidates(row)).toEqual([]);
    // A link is removable with edit on EITHER end's board — never with neither.
    const dep = (pred: string, succ: string) => ({
      id: "d",
      predecessor_id: pred,
      successor_id: succ,
    });
    expect(canvas().canRemoveDependency(dep(I3, I3))).toBe(false);
    expect(canvas().canRemoveDependency(dep(I1, I3))).toBe(true);
    expect(canvas().canRemoveDependency(dep(I3, I1))).toBe(true);
    // The editable board still offers the read-only board's items as predecessors.
    const editable = canvas().rows.find((r) => r.itemId === I1)!;
    expect(
      canvas()
        .linkCandidates(editable)
        .map((c) => c.itemId),
    ).toContain(I3);
  });

  it("leaves existing predecessors out of the link picker", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({
      ok: true,
      data: {
        ...data,
        dependencies: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            predecessor_id: I2,
            successor_id: I1,
          },
        ],
      },
    });
    renderTab();
    await screen.findByTestId("canvas");
    openGroup(A, GA);
    const row = canvas().rows.find((r) => r.itemId === I1)!;
    expect(canvas().linkCandidates(row)).toEqual([]);
  });

  it("resizes a bar through its board's date cell", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    m.upsertCell.mockResolvedValue({ ok: true, data: { cell: {} } });
    renderTab();
    await screen.findByTestId("canvas");
    openGroup(A, GA);
    await act(async () => canvas().onResizeBar(I1, "2026-11-14"));
    expect(m.upsertCell).toHaveBeenCalledWith({
      itemId: I1,
      columnId: DA,
      value: { date: "2026-11-10", end: "2026-11-14" },
    });
  });

  it("a failed write does not undo a newer drag of the same bar", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    let failFirst: (v: unknown) => void = () => {};
    m.upsertCell
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            failFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, data: { cell: {} } });
    const client = renderTab();
    await screen.findByTestId("canvas");
    openGroup(A, GA);
    await act(async () => canvas().onMoveBar(I1, 1));
    // TanStack notifies observers on a later tick — let the patch render.
    await waitFor(() =>
      expect(canvas().rows.find((r) => r.itemId === I1)?.startISO).toBe(
        "2026-11-11",
      ),
    );
    await act(async () => canvas().onMoveBar(I1, 1));
    await act(async () => failFirst({ ok: false, error: "No access." }));
    const cached = client.getQueryData<FolderTimelineData>([
      "folder-timeline",
      "f1",
    ]);
    expect(cached?.items.find((i) => i.id === I1)?.dates[DA]).toEqual({
      date: "2026-11-12",
      end: "2026-11-12",
    });
    expect(m.toastError).toHaveBeenCalledWith("No access.", {
      id: `timeline-write:${I1}`,
    });
  });

  it("puts the rollup's progress on board and group bands", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
    renderTab([
      { boardId: A, groupId: GA, total: 20, done: 7, overdue: 8 } as RollupRow,
    ]);
    await screen.findByTestId("canvas");
    const band = (id: string) =>
      canvas().rows.find((r) => r.itemId === id)?.summary;
    expect(band(`board:${A}`)).toMatchObject({ donePct: 35, lateCount: 8 });
    act(() => canvas().onToggleExpand?.(`board:${A}`));
    expect(band(`group:${GA}`)).toMatchObject({ donePct: 35, lateCount: 8 });
    // A board with nothing dated draws no summary bar at all.
    expect(band(`board:${B}`)).toBeUndefined();
  });

  it("counts late links while every board is still closed", async () => {
    m.getFolderTimeline.mockResolvedValueOnce({
      ok: true,
      data: {
        ...data,
        // I1 (11-10) is meant to start after I2 ends (11-12): late.
        dependencies: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            predecessor_id: I2,
            successor_id: I1,
          },
        ],
      },
    });
    renderTab();
    await screen.findByTestId("canvas");
    expect(canvasText()).toBe("Platform|Sites · No dates on this board");
    expect(screen.getByText("1 late link")).toBeInTheDocument();
  });
});

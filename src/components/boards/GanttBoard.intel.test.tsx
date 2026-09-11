import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GanttBoard } from "@/components/boards/GanttBoard";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
} from "@/lib/boards/intelligence/context";
import { localTodayISO } from "@/lib/boards/overdue";
import type { BoardPayload } from "@/lib/boards/queries";

vi.mock("@/lib/dnd/sensors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dnd/sensors")>();
  return { useTouchAwareSensors: vi.fn(actual.useTouchAwareSensors) };
});
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 1200;
    },
  });
});
vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({
    setCell: vi.fn(),
    addItem: vi.fn(),
    clearCellValue: vi.fn(),
    renameItem: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
  }),
}));
vi.mock("@/lib/boards/use-board-realtime", () => ({
  useBoardRealtime: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

const DATE_COL_ID = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const VIEW_ID = "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv";
const yesterday = localTodayISO(new Date(Date.now() - 86_400_000));
const nextWeek = localTodayISO(new Date(Date.now() + 7 * 86_400_000));

function payload() {
  return {
    board: { id: "b1", org_id: "o1", name: "My Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [
      {
        id: DATE_COL_ID,
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due Date",
        position: 0,
        settings: {},
      },
    ],
    items: [
      {
        id: "i1",
        name: "Item Alpha",
        group_id: "g1",
        parent_id: null,
        position: 0,
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "i2",
        name: "Item Beta",
        group_id: "g1",
        parent_id: null,
        position: 1,
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: DATE_COL_ID,
        value: { date: yesterday, end: yesterday },
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        item_id: "i2",
        column_id: DATE_COL_ID,
        value: { date: nextWeek, end: nextWeek },
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    views: [
      {
        id: VIEW_ID,
        kind: "timeline",
        name: "Timeline",
        config: { date_column_id: DATE_COL_ID, zoom: "month" },
        board_id: "b1",
        org_id: "o1",
        position: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    dependencies: [],
  } as unknown as BoardPayload;
}

function renderGantt() {
  const qc = new QueryClient();
  const p = payload();
  return render(
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={p}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        <IntelToneFrame>
          <GanttBoard payload={p} members={[]} selectedViewId={VIEW_ID} />
        </IntelToneFrame>
      </BoardIntelligenceProvider>
    </QueryClientProvider>,
  );
}

describe("GanttBoard with an active intelligence chip", () => {
  it("intel=overdue keeps only the overdue row and marks it", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=overdue");
    renderGantt();
    expect(screen.getAllByText("Item Alpha").length).toBeGreaterThan(0);
    expect(screen.queryByText("Item Beta")).not.toBeInTheDocument();
    const rows = screen.getAllByTestId("gantt-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveClass("intel-match");
  });
});

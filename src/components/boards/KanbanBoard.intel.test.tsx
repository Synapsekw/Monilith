import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KanbanBoard } from "@/components/boards/KanbanBoard";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
} from "@/lib/boards/intelligence/context";
import { localTodayISO } from "@/lib/boards/overdue";
import type { BoardPayload } from "@/lib/boards/queries";

vi.mock("@/lib/boards/view-actions", () => ({ updateBoardView: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({
    setCell: vi.fn(),
    addItem: vi.fn(),
    clearCellValue: vi.fn(),
    renameItem: vi.fn(),
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

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
});

const yesterday = localTodayISO(new Date(Date.now() - 86_400_000));

function payload() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [
      {
        id: "status",
        board_id: "b1",
        org_id: "o1",
        kind: "status",
        name: "Status",
        position: 0,
        settings: {
          options: [{ id: "o1", label: "Working", color: "#fdab3d" }],
        },
      },
      {
        id: "due",
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due",
        position: 1,
        settings: {},
      },
    ],
    items: [
      {
        id: "i1",
        name: "Card A",
        group_id: "g1",
        parent_id: null,
        position: 0,
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "i2",
        name: "Card B",
        group_id: "g1",
        parent_id: null,
        position: 1,
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: "status",
        value: { optionId: "o1" },
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        item_id: "i1",
        column_id: "due",
        value: { date: yesterday },
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        item_id: "i2",
        column_id: "status",
        value: { optionId: "o1" },
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    dependencies: [],
    views: [
      {
        id: "v2",
        kind: "kanban",
        name: "Kanban",
        config: { group_column_id: "status" },
      },
    ],
  } as unknown as BoardPayload;
}

function renderKanban() {
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
          <KanbanBoard payload={p} selectedViewId="v2" members={[]} />
        </IntelToneFrame>
      </BoardIntelligenceProvider>
    </QueryClientProvider>,
  );
}

describe("KanbanBoard with an active intelligence chip", () => {
  it("intel=overdue keeps only the overdue card and marks it", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=overdue");
    renderKanban();
    expect(screen.getByText("Card A")).toBeInTheDocument();
    expect(screen.queryByText("Card B")).not.toBeInTheDocument();
    expect(screen.getByText("Card A").closest("article")).toHaveClass(
      "intel-match",
    );
  });

  it("no chip → both cards, no marks", () => {
    window.history.replaceState(null, "", "/boards/b1");
    renderKanban();
    expect(screen.getByText("Card B")).toBeInTheDocument();
    expect(screen.getByText("Card A").closest("article")).not.toHaveClass(
      "intel-match",
    );
  });
});

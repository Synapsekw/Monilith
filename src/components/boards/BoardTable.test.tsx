import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";

const createGroup = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createGroup: (...a: unknown[]) => createGroup(...a),
}));

// dependency-actions is a server module pulled in transitively by
// useBoardMutations; stub it so it doesn't load server-only code in jsdom.
vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: vi.fn(),
  deleteDependency: vi.fn(),
}));

// BoardHeader pulls in ViewSwitcher + AutomationsDialog (router + Server
// Actions) that are out of scope here; stub it to a placeholder.
vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

function payloadFixture() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      {
        id: "g1",
        board_id: "b1",
        org_id: "o1",
        name: "Group 1",
        color: "#0073ea",
        position: 0,
      },
    ],
    columns: [],
    items: [],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderBoard() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={payloadFixture()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createGroup.mockReset();
});

describe("BoardTable add group", () => {
  it("creates a group with the next auto-incremented name and drops it into rename mode", async () => {
    createGroup.mockResolvedValue({
      ok: true,
      data: {
        group: {
          id: "g2",
          board_id: "b1",
          org_id: "o1",
          name: "Group 2",
          color: "#0073ea",
          position: 1,
        },
      },
    });

    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));

    await waitFor(() =>
      expect(createGroup).toHaveBeenCalledWith({
        boardId: "b1",
        name: "Group 2",
      }),
    );
    // The new group lands in inline rename mode, pre-filled with its default name.
    expect(await screen.findByDisplayValue("Group 2")).toBeInTheDocument();
  });
});

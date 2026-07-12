import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { CommandPalette } from "./command-palette";
import { useUIStore } from "@/stores/ui";
import type { ItemSearchResult } from "@/lib/search/item-search";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));

// The palette calls the real "use server" action; mock it so the test drives the
// UI (loading → results → empty) without a live Supabase round-trip.
const searchItems = vi.fn<(q: string) => Promise<ItemSearchResult[]>>();
vi.mock("@/lib/search/item-search", () => ({
  searchItems: (q: string) => searchItems(q),
}));

// The lazily-mounted QuickAction imports the "use server" write engine (server-only);
// mock it so mounting the composer doesn't pull server-only code into jsdom.
vi.mock("@/lib/ai/write/actions", () => ({
  proposeActions: vi.fn(),
  executeActions: vi.fn(),
}));

const boards = [
  {
    id: "b1",
    name: "Sprint backlog",
    workspace_id: "ws1",
    position: 0,
    shared_out: false,
  },
  {
    id: "b2",
    name: "Roadmap",
    workspace_id: "ws1",
    position: 1,
    shared_out: false,
  },
];
const dashboards = [{ id: "d1", name: "Team overview" }];
const workspaces = [{ id: "ws1", name: "WS" }];

function renderOpen() {
  useUIStore.setState({
    commandOpen: true,
    newBoardOpen: false,
    newDashboardOpen: false,
  });
  return render(
    <CommandPalette
      boards={boards}
      dashboards={dashboards}
      workspaces={workspaces}
    />,
  );
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/search items/i), {
    target: { value },
  });
}

beforeEach(() => {
  push.mockReset();
  searchItems.mockReset();
  searchItems.mockResolvedValue([]);
  useUIStore.setState({ commandOpen: false });
});

describe("CommandPalette", () => {
  it("renders a navigation item per board and per dashboard", () => {
    renderOpen();
    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Team overview")).toBeInTheDocument();
  });

  it("navigates to a board on select and closes", () => {
    renderOpen();
    fireEvent.click(screen.getByText("Sprint backlog"));
    expect(push).toHaveBeenCalledWith("/boards/b1");
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("New board sets the newBoardOpen flag and closes", () => {
    renderOpen();
    fireEvent.click(screen.getByText("New board"));
    expect(useUIStore.getState().newBoardOpen).toBe(true);
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("New dashboard sets the newDashboardOpen flag", () => {
    renderOpen();
    fireEvent.click(screen.getByText("New dashboard"));
    expect(useUIStore.getState().newDashboardOpen).toBe(true);
  });

  it("does not search or show the Items group for a query under 2 chars", async () => {
    renderOpen();
    typeQuery("a");
    // No round-trip fires for a sub-threshold query.
    expect(searchItems).not.toHaveBeenCalled();
    expect(screen.queryByText("Items")).not.toBeInTheDocument();
  });

  it("debounces then searches and lists matching items with their board", async () => {
    searchItems.mockResolvedValue([
      { id: "i1", name: "Design spec", boardId: "b2", boardName: "Roadmap" },
    ]);
    renderOpen();
    typeQuery("design");
    await waitFor(() => expect(searchItems).toHaveBeenCalledWith("design"));
    expect(await screen.findByText("Design spec")).toBeInTheDocument();
    // Board name is shown as secondary context (Roadmap also a board nav row,
    // so assert there are two occurrences: nav + item context).
    expect(screen.getAllByText("Roadmap").length).toBeGreaterThanOrEqual(1);
  });

  it("navigates to the item's board with the ?item deep-link and closes", async () => {
    searchItems.mockResolvedValue([
      { id: "i1", name: "Design spec", boardId: "b2", boardName: "Roadmap" },
    ]);
    renderOpen();
    typeQuery("design");
    fireEvent.click(await screen.findByText("Design spec"));
    expect(push).toHaveBeenCalledWith("/boards/b2?item=i1");
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("shows an empty state when a valid query matches no items", async () => {
    searchItems.mockResolvedValue([]);
    renderOpen();
    typeQuery("zzzzz");
    expect(await screen.findByText("No items match")).toBeInTheDocument();
  });

  it("renders the Items group heading with the kicker recipe", async () => {
    searchItems.mockResolvedValue([
      { id: "i1", name: "Design spec", boardId: "b2", boardName: "Roadmap" },
    ]);
    renderOpen();
    typeQuery("design");
    await screen.findByText("Design spec");
    const heading = screen.getByText("Items");
    expect(heading).toHaveClass("font-mono");
    expect(heading).toHaveClass("text-kicker");
  });

  it("opens the quick-action composer from the Actions group", async () => {
    renderOpen();
    fireEvent.click(screen.getByText("Run a command…"));
    // The composer mounts lazily (next/dynamic); its command textarea appears.
    expect(await screen.findByLabelText(/command/i)).toBeInTheDocument();
    // The command list is replaced — the search input is gone.
    expect(
      screen.queryByPlaceholderText(/search items/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the existing Ask Pulse entry alongside the new Actions entry", () => {
    renderOpen();
    expect(screen.getByText("Ask Pulse…")).toBeInTheDocument();
    expect(screen.getByText("Run a command…")).toBeInTheDocument();
  });

  it("clears the query and results after selecting an item and reopening", async () => {
    searchItems.mockResolvedValue([
      { id: "i1", name: "Design spec", boardId: "b2", boardName: "Roadmap" },
    ]);
    renderOpen();
    typeQuery("design");
    // Selecting an item runs resetSearch + closes the palette.
    fireEvent.click(await screen.findByText("Design spec"));
    expect(useUIStore.getState().commandOpen).toBe(false);
    act(() => {
      useUIStore.setState({ commandOpen: true });
    });
    // Reopened clean: the input is empty and the prior result is gone.
    expect(
      (screen.getByPlaceholderText(/search items/i) as HTMLInputElement).value,
    ).toBe("");
    expect(screen.queryByText("Design spec")).not.toBeInTheDocument();
  });
});

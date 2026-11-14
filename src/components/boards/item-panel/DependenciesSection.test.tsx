import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BoardCache } from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";
import {
  createDependency,
  deleteDependency,
} from "@/lib/boards/dependency-actions";
import { searchItems } from "@/lib/search/item-search";
import { toast } from "sonner";
import { DependenciesSection } from "./DependenciesSection";

vi.mock("@/lib/boards/use-dependency-context", () => ({
  dependencyContextKey: (boardId: string) => ["board-dep-context", boardId],
  useDependencyContext: () => ({
    data: { boards: [], items: [] },
    isPending: false,
  }),
}));

vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: vi.fn(async () => ({
    ok: true,
    data: { dependencyId: "new" },
  })),
  deleteDependency: vi.fn(async () => ({ ok: true, data: undefined })),
}));

vi.mock("@/lib/search/item-search", () => ({
  searchItems: vi.fn(async () => [
    { id: "x9", name: "Permit", boardId: "b9", boardName: "Regulatory" },
  ]),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const COL = "c-when";

function makeCache(): BoardCache {
  return {
    board: { id: "b0", name: "Platform" },
    groups: [],
    columns: [{ id: COL, name: "When", kind: "date" }],
    items: [
      { id: "me", name: "Me" },
      { id: "design", name: "Design" },
    ],
    cellValues: [
      {
        item_id: "me",
        column_id: COL,
        value: { date: "2026-11-03", end: "2026-11-12" },
        updated_at: "",
      },
      {
        item_id: "design",
        column_id: COL,
        value: { date: "2026-11-01", end: "2026-11-05" },
        updated_at: "",
      },
    ],
    dependencies: [
      {
        id: "dep-1",
        predecessor_id: "design",
        successor_id: "me",
        board_id: "b0",
        predecessor_board_id: "b0",
      },
    ],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  } as unknown as BoardCache;
}

function renderSection(canEdit = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(boardKey("b0"), makeCache());
  const utils = render(
    <QueryClientProvider client={qc}>
      <DependenciesSection
        itemId="me"
        boardId="b0"
        boardName="Platform"
        schedule={null}
        canEdit={canEdit}
      />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

beforeEach(() => vi.clearAllMocks());

describe("DependenciesSection", () => {
  it("lists what the item waits on, with board and a late marker", () => {
    renderSection();
    const waiting = screen.getByRole("region", { name: "Waiting on" });
    expect(within(waiting).getByText("Design")).toBeInTheDocument();
    expect(within(waiting).getByText("Platform")).toBeInTheDocument();
    // Design ends Nov 5, Me starts Nov 3 → late.
    expect(within(waiting).getByText("Late")).toBeInTheDocument();
    const blocking = screen.getByRole("region", { name: "Blocking" });
    expect(
      within(blocking).getByText("Nothing waits on this item."),
    ).toBeInTheDocument();
  });

  it("adds a waiting-on link from org-wide search", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Add dependency" }));
    await user.click(screen.getByRole("radio", { name: "Waiting on" }));
    await user.type(screen.getByRole("searchbox"), "per");
    const hit = await screen.findByRole("button", {
      name: "Permit · Regulatory",
    });
    expect(searchItems).toHaveBeenCalledWith("per");
    await user.click(hit);
    expect(createDependency).toHaveBeenCalledWith({
      predecessorId: "x9",
      successorId: "me",
    });
  });

  it("adds a blocking link with this item as the predecessor", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Add dependency" }));
    await user.click(screen.getByRole("radio", { name: "Blocking" }));
    await user.type(screen.getByRole("searchbox"), "per");
    await user.click(
      await screen.findByRole("button", { name: "Permit · Regulatory" }),
    );
    expect(createDependency).toHaveBeenCalledWith({
      predecessorId: "me",
      successorId: "x9",
    });
  });

  it("toasts the server message when adding fails", async () => {
    vi.mocked(createDependency).mockResolvedValueOnce({
      ok: false,
      error: "This link would create a cycle.",
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Add dependency" }));
    await user.type(screen.getByRole("searchbox"), "per");
    await user.click(
      await screen.findByRole("button", { name: "Permit · Regulatory" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This link would create a cycle.",
      ),
    );
  });

  it("does not offer the item itself or already-linked items", async () => {
    vi.mocked(searchItems).mockResolvedValueOnce([
      { id: "me", name: "Me", boardId: "b0", boardName: "Platform" },
      { id: "design", name: "Design", boardId: "b0", boardName: "Platform" },
      { id: "x9", name: "Permit", boardId: "b9", boardName: "Regulatory" },
    ]);
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Add dependency" }));
    await user.type(screen.getByRole("searchbox"), "per");
    await screen.findByRole("button", { name: "Permit · Regulatory" });
    expect(
      screen.queryByRole("button", { name: "Me · Platform" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Design · Platform" }),
    ).not.toBeInTheDocument();
  });

  it("removes a link optimistically", async () => {
    const user = userEvent.setup();
    const { qc } = renderSection();
    await user.click(
      screen.getByRole("button", { name: "Remove link to Design" }),
    );
    expect(deleteDependency).toHaveBeenCalledWith({ dependencyId: "dep-1" });
    expect(qc.getQueryData<BoardCache>(boardKey("b0"))?.dependencies).toEqual(
      [],
    );
    expect(
      await screen.findByText("Not waiting on anything."),
    ).toBeInTheDocument();
  });

  it("restores the link and toasts when removing fails", async () => {
    vi.mocked(deleteDependency).mockResolvedValueOnce({
      ok: false,
      error: "You can't edit this board.",
    });
    const user = userEvent.setup();
    const { qc } = renderSection();
    await user.click(
      screen.getByRole("button", { name: "Remove link to Design" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("You can't edit this board."),
    );
    expect(
      qc
        .getQueryData<BoardCache>(boardKey("b0"))
        ?.dependencies.map((d) => d.id),
    ).toEqual(["dep-1"]);
  });

  it("hides editing controls for read-only viewers", () => {
    renderSection(false);
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add dependency" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove link to Design" }),
    ).not.toBeInTheDocument();
  });
});

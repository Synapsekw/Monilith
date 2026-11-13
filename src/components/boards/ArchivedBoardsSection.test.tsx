import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchivedBoardsSection } from "./ArchivedBoardsSection";

const restoreBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const purgeBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const showMutationError = vi.fn();

vi.mock("@/lib/boards/actions", () => ({
  restoreBoard: (...a: unknown[]) => restoreBoard(...a),
  purgeBoard: (...a: unknown[]) => purgeBoard(...a),
}));
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: (...a: unknown[]) => showMutationError(...a),
}));
// restoreBoard / purgeBoard expire the boards tag, so the action response
// already carries the re-rendered route; the section must not call
// router.refresh() on top. Shared spy so a stray call is observable.
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: routerRefresh }),
}));

const boards = [
  {
    id: "b1",
    name: "Old roadmap",
    workspace_id: "w1",
    archived_at: "2026-07-06T00:00:00Z",
    archived_by: "u1",
    archived_by_name: "Ada Lovelace",
  },
  {
    id: "b2",
    name: "Q1 plan",
    workspace_id: "w1",
    archived_at: "2026-07-05T00:00:00Z",
    archived_by: null,
    archived_by_name: null,
  },
];

beforeEach(() => vi.clearAllMocks());

describe("ArchivedBoardsSection", () => {
  it("renders nothing when there are no archived boards", () => {
    const { container } = render(<ArchivedBoardsSection boards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("expands to list archived boards and restores one", async () => {
    render(<ArchivedBoardsSection boards={boards} />);
    // Collapsed by default — expand the section.
    await userEvent.click(
      screen.getByRole("button", { name: /archived boards/i }),
    );
    expect(screen.getByText("Old roadmap")).toBeInTheDocument();
    expect(screen.getByText("Q1 plan")).toBeInTheDocument();

    await userEvent.click(
      screen.getAllByRole("button", { name: /restore/i })[0],
    );
    expect(restoreBoard).toHaveBeenCalledWith({ boardId: "b1" });
    // The row is dropped locally once the action resolves…
    await waitFor(() =>
      expect(screen.queryByText("Old roadmap")).not.toBeInTheDocument(),
    );
    // …and the sidebar re-render rides the action response, not a refresh.
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("permanently deletes only after confirming", async () => {
    render(<ArchivedBoardsSection boards={boards} />);
    await userEvent.click(
      screen.getByRole("button", { name: /archived boards/i }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: /delete permanently/i })[0],
    );
    // Confirm dialog appears; purge not called until confirmed.
    expect(purgeBoard).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /^delete permanently$/i }),
    );
    expect(purgeBoard).toHaveBeenCalledWith({ boardId: "b1" });
    await waitFor(() =>
      expect(screen.queryByText("Old roadmap")).not.toBeInTheDocument(),
    );
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("captions each row with archiver + relative time, falling back when unknown", async () => {
    const user = userEvent.setup();
    render(<ArchivedBoardsSection boards={boards} />);
    await user.click(screen.getByRole("button", { name: /archived boards/i }));

    expect(screen.getByText(/archived by Ada Lovelace,/i)).toBeInTheDocument();
    // b2 has no archiver name -> "archived {timeAgo}" with no "by"
    const q1 = screen.getByText("Q1 plan").closest("li")!;
    expect(within(q1).getByText(/^archived /i)).toBeInTheDocument();
    expect(within(q1).queryByText(/archived by/i)).not.toBeInTheDocument();
  });

  it("exposes an #archived hash target on the section", () => {
    const { container } = render(<ArchivedBoardsSection boards={boards} />);
    expect(container.querySelector("section#archived")).not.toBeNull();
  });

  it("surfaces a failed restore via a toast", async () => {
    restoreBoard.mockResolvedValueOnce({
      ok: false,
      error: "Only the board owner can restore this board.",
    } as never);
    render(<ArchivedBoardsSection boards={boards} />);
    await userEvent.click(
      screen.getByRole("button", { name: /archived boards/i }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: /restore/i })[0],
    );
    expect(showMutationError).toHaveBeenCalled();
  });
});

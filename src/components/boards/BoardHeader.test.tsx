import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardHeader } from "./BoardHeader";
import type { ReactElement } from "react";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import type { BoardPresence } from "@/lib/boards/use-board-presence";

const renameBoard = vi.fn();

vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({ renameBoard }),
}));

vi.mock("./ViewSwitcher", () => ({
  ViewSwitcher: () => <div data-testid="view-switcher" />,
}));

// BoardHeader now renders the real ImportWizard (Task 15's entry point). It
// calls useRouter() and the spreadsheet Server Actions — mock both so the
// dialog can open in this render tree without a Next router/server context.
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/boards/spreadsheet-actions", () => ({
  previewImport: vi.fn(),
  commitImport: vi.fn(),
}));

// The Automations dialog pulls in Server Actions (and TanStack Query) that are
// out of scope for the header rename test; stub it to its trigger only.
// The stub reports `open` and closes on click, so tests can assert the header's
// mount-on-first-open / stay-mounted-after-close contract.
vi.mock("@/components/boards/automations/AutomationsDialog", () => ({
  AutomationsDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="automations-dialog"
      data-open={String(open)}
      onClick={() => onOpenChange(false)}
    />
  ),
}));

// The trash dialog fires a Server Action on open; stub it the same way.
vi.mock("@/components/boards/trash/BoardTrashDialog", () => ({
  BoardTrashDialog: ({ open }: { open: boolean }) => (
    <div data-testid="trash-dialog" data-open={String(open)} />
  ),
}));

// ShareBoardDialog transitively imports the sharing Server Actions module; stub
// the dialog (we assert on the header's Share trigger, not the dialog body).
vi.mock("@/components/boards/ShareBoardDialog", () => ({
  ShareBoardDialog: ({ open }: { open: boolean }) => (
    <div data-testid="share-dialog" data-open={String(open)} />
  ),
}));

vi.mock("@/lib/boards/sharing-actions", () => ({
  shareBoard: vi.fn(),
  unshareBoard: vi.fn(),
}));

const views = [
  { id: "v1", board_id: "b1", kind: "table", name: "Main Table" } as never,
];

// BoardHeader renders <BoardPresenceBar />, which reads presence from context and
// throws without a provider. Wrap every render in a provider; an empty roster
// makes the bar self-hide, keeping the rename/access assertions unaffected.
function makePresence(
  roster: BoardPresence["roster"] = [],
): BoardPresenceContextValue {
  return {
    roster,
    focusMap: new Map(),
    setFocus: vi.fn(),
    selfUserId: "self",
    selfFocusTargetId: null,
    channelStatus: "SUBSCRIBED",
    flashTargetId: null,
  };
}

function renderHeader(
  ui: ReactElement,
  presence: BoardPresenceContextValue = makePresence(),
) {
  return render(
    <BoardPresenceProvider value={presence}>{ui}</BoardPresenceProvider>,
  );
}

beforeEach(() => {
  renameBoard.mockReset();
});

describe("BoardHeader", () => {
  it("renames the board when the title is edited", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Sprint backlog" }),
    );
    const input = screen.getByRole("textbox", { name: /board name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Q2 roadmap");
    await userEvent.keyboard("{Enter}");

    // The rename reconciles the shared BoardCache optimistically, so no
    // post-mutation router.refresh() callback is passed (B4).
    expect(renameBoard).toHaveBeenCalledWith("Q2 roadmap");
  });

  // The Input base carries `md:text-sm`; a bare `text-xl` does not displace
  // it, so the rename field used to drop to 14px on desktop while the title it
  // replaces is 20px.
  it("rename input keeps the 20px bold title scale on desktop", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Sprint backlog" }),
    );
    const input = screen.getByRole("textbox", { name: /board name/i });
    expect(input).toHaveClass("text-xl", "md:text-xl", "font-bold", "h-7");
    expect(input).not.toHaveClass("md:text-sm");
    expect(input).not.toHaveClass("text-base");
  });

  it("owner: shows the Share affordance, no View only badge, and a rename control", () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="owner"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Share board" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("View only")).not.toBeInTheDocument();
    // The board name is an editable control (button), not a static heading.
    expect(
      screen.getByRole("button", { name: "Sprint backlog" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Sprint backlog" }),
    ).not.toBeInTheDocument();
  });

  it("editor: hides Share, shows no View only badge, but keeps the rename control", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="editor"
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Share board" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("View only")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sprint backlog" }),
    ).toBeInTheDocument();
    // Editors can append rows, so the Import affordance stays (in the ⋯ menu).
    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Import" }),
    ).toBeInTheDocument();
  });

  it("viewer: shows the View only badge, hides Share, and renders the name as a static heading", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="viewer"
      />,
    );

    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Share board" }),
    ).not.toBeInTheDocument();
    // Rename affordance is absent: the name is a static heading, not a control.
    expect(
      screen.getByRole("heading", { name: "Sprint backlog" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sprint backlog" }),
    ).not.toBeInTheDocument();
    // Import appends rows — a write — so viewers never see it in the ⋯ menu.
    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Import" }),
    ).not.toBeInTheDocument();
  });

  it("board title occupies a stable h-7 line box in display mode", () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="owner"
      />,
    );

    const title = screen.getByRole("button", { name: "Sprint backlog" });
    expect(title.className).toContain("h-7");
    expect(title.className).toContain("items-center");
    // Page-title scale (20px bold) — and it must still truncate a long name.
    expect(title).toHaveClass(
      "text-xl",
      "font-bold",
      "tracking-[-0.02em]",
      "truncate",
    );
    expect(title).not.toHaveClass("text-lg");
  });

  it("viewer heading occupies the same stable h-7 line box", () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="viewer"
      />,
    );

    const heading = screen.getByRole("heading", { name: "Sprint backlog" });
    expect(heading.className).toContain("h-7");
    expect(heading.className).toContain("items-center");
    expect(heading).toHaveClass(
      "text-xl",
      "font-bold",
      "tracking-[-0.02em]",
      "truncate",
    );
  });

  it("opens the import wizard dialog from the overflow menu", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        columns={[
          {
            id: "col-1",
            board_id: "b1",
            org_id: "org1",
            name: "Status",
            kind: "status",
            position: 0,
            settings: { options: [{ id: "o1", label: "Done", color: "#000" }] },
          } as never,
        ]}
        groups={[{ id: "g1", name: "Group 1" }]}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Import" }),
    );

    // The wizard is a next/dynamic chunk fetched on first open — await it.
    expect(
      await screen.findByRole("dialog", { name: "Import from file" }),
    ).toBeInTheDocument();
  });

  // The four on-demand dialogs are code-split (next/dynamic) and gated on
  // their open state: nothing is mounted — so no chunk is requested — until the
  // user opens one.
  it("mounts no dialog module until one is opened", () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="owner"
      />,
    );

    expect(screen.queryByTestId("automations-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trash-dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("mounts the share dialog after the Share trigger is clicked", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="owner"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Share board" }));
    const dialog = await screen.findByTestId("share-dialog");
    expect(dialog).toHaveAttribute("data-open", "true");
    // Only the dialog that was asked for is mounted.
    expect(screen.queryByTestId("automations-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trash-dialog")).not.toBeInTheDocument();
  });

  it("mounts automations and trash from the overflow menu, and keeps a closed dialog mounted", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="owner"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Automations" }),
    );
    const automations = await screen.findByTestId("automations-dialog");
    expect(automations).toHaveAttribute("data-open", "true");

    // Closing flips `open` but does NOT unmount: the dialog must stay in the
    // tree so Radix can play its exit animation and keep its internal state.
    await userEvent.click(automations);
    expect(screen.getByTestId("automations-dialog")).toHaveAttribute(
      "data-open",
      "false",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Trash" }),
    );
    expect(await screen.findByTestId("trash-dialog")).toHaveAttribute(
      "data-open",
      "true",
    );
  });

  it("renders the presence avatar bar with a face per occupant in the roster", () => {
    const presence = makePresence([
      {
        userId: "self",
        name: "Ada Lovelace",
        avatarUrl: null,
        color: "#2d9cdb",
        isSelf: true,
      },
    ]);

    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
      />,
      presence,
    );

    // The bar self-hides on an empty roster; with one occupant it shows the
    // labelled stack and that person's initials.
    expect(screen.getByLabelText("People on this board")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});

describe("BoardHeader — Fit all columns", () => {
  it("offers it to editors when the Table view provides the handler, and calls it once", async () => {
    const onFit = vi.fn();
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="editor"
        onFitAllColumns={onFit}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Fit all columns" }),
    );
    expect(onFit).toHaveBeenCalledTimes(1);
  });

  it("is absent in views that pass no handler (Kanban, Calendar, Gantt)", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="editor"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Automations" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Fit all columns" }),
    ).not.toBeInTheDocument();
  });

  it("is hidden from viewers even if a handler is passed", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="viewer"
        onFitAllColumns={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Automations" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Fit all columns" }),
    ).not.toBeInTheDocument();
  });
});

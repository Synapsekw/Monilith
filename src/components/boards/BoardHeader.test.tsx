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

// The Automations dialog pulls in Server Actions (and TanStack Query) that are
// out of scope for the header rename test; stub it to its trigger only.
vi.mock("@/components/boards/automations/AutomationsDialog", () => ({
  AutomationsDialog: () => <div data-testid="automations-dialog" />,
}));

// ShareBoardDialog transitively imports the sharing Server Actions module; stub
// the dialog (we assert on the header's Share trigger, not the dialog body).
vi.mock("@/components/boards/ShareBoardDialog", () => ({
  ShareBoardDialog: () => <div data-testid="share-dialog" />,
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

  it("editor: hides Share, shows no View only badge, but keeps the rename control", () => {
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
  });

  it("viewer: shows the View only badge, hides Share, and renders the name as a static heading", () => {
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
  });

  it("board title occupies a stable h-8 line box in display mode", () => {
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
    expect(title.className).toContain("h-8");
    expect(title.className).toContain("items-center");
  });

  it("viewer heading occupies the same stable h-8 line box", () => {
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
    expect(heading.className).toContain("h-8");
    expect(heading.className).toContain("items-center");
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

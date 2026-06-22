import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemPanel } from "./ItemPanel";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import { presenceTarget } from "@/lib/boards/presence-target";

function ctx(
  setFocus: BoardPresenceContextValue["setFocus"],
): BoardPresenceContextValue {
  return {
    roster: [],
    focusMap: new Map(),
    setFocus,
    selfUserId: "self",
    selfFocusTargetId: null,
    channelStatus: "SUBSCRIBED",
    flashTargetId: null,
  };
}

const baseProps = {
  itemName: "Widget",
  orgId: "org1",
  boardId: "board1",
  currentUserId: "self",
  columns: [],
  members: [],
  onClose: () => {},
} as const;

function renderPanel(
  setFocus: BoardPresenceContextValue["setFocus"],
  itemId: string | null,
) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardPresenceProvider value={ctx(setFocus)}>
        <ItemPanel {...baseProps} itemId={itemId} />
      </BoardPresenceProvider>
    </QueryClientProvider>,
  );
}

describe("ItemPanel presence", () => {
  it("registers a panel focus target while the panel is open", () => {
    const setFocus = vi.fn();
    renderPanel(setFocus, "i1");
    expect(setFocus).toHaveBeenCalledWith({
      viewKind: "panel",
      targetId: presenceTarget.item("i1"),
    });
  });

  it("does not register a focus when there is no open item", () => {
    const setFocus = vi.fn();
    renderPanel(setFocus, null);
    expect(setFocus).not.toHaveBeenCalledWith(
      expect.objectContaining({ viewKind: "panel" }),
    );
  });
});

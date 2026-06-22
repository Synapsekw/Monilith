import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ItemViewersBar } from "./ItemViewersBar";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import { presenceTarget } from "@/lib/boards/presence-target";
import type { RosterOccupant } from "@/lib/boards/presence-types";

function occ(id: string, name: string): RosterOccupant {
  return { userId: id, name, avatarUrl: null, color: "#888", isSelf: false };
}

function ctx(
  focusMap: Map<string, RosterOccupant[]>,
): BoardPresenceContextValue {
  return {
    roster: [],
    focusMap,
    setFocus: () => {},
    selfUserId: "self",
    selfFocusTargetId: null,
    channelStatus: "SUBSCRIBED",
    flashTargetId: null,
  };
}

function renderInProvider(
  node: React.ReactNode,
  focusMap: Map<string, RosterOccupant[]>,
) {
  return render(
    <BoardPresenceProvider value={ctx(focusMap)}>{node}</BoardPresenceProvider>,
  );
}

describe("ItemViewersBar", () => {
  it("renders nothing when there is no itemId", () => {
    const { container } = renderInProvider(
      <ItemViewersBar itemId={null} />,
      new Map(),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing outside a provider", () => {
    const { container } = render(<ItemViewersBar itemId="i1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders other viewers of the same item", () => {
    const map = new Map([[presenceTarget.item("i1"), [occ("u2", "Bob")]]]);
    renderInProvider(<ItemViewersBar itemId="i1" />, map);
    expect(screen.getByLabelText("Also viewing this item")).toBeInTheDocument();
  });

  it("excludes the current user from the viewers", () => {
    const map = new Map([
      [presenceTarget.item("i1"), [{ ...occ("self", "Me") }]],
    ]);
    const { container } = renderInProvider(<ItemViewersBar itemId="i1" />, map);
    expect(container.firstChild).toBeNull();
  });
});

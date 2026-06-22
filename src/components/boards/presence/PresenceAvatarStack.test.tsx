import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresenceAvatarStack } from "./PresenceAvatarStack";
import type { RosterOccupant } from "@/lib/boards/presence-types";

function occ(id: string, name: string): RosterOccupant {
  return { userId: id, name, avatarUrl: null, color: "#888", isSelf: false };
}

describe("PresenceAvatarStack", () => {
  it("renders nothing when there are no occupants", () => {
    const { container } = render(
      <PresenceAvatarStack occupants={[]} ariaLabel="People" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a face per occupant up to maxFaces and a +k overflow chip", () => {
    const occupants = [
      occ("1", "Ann"),
      occ("2", "Bob"),
      occ("3", "Cy"),
      occ("4", "Dee"),
    ];
    render(
      <PresenceAvatarStack
        occupants={occupants}
        ariaLabel="People"
        maxFaces={2}
      />,
    );
    expect(screen.getByLabelText("People")).toBeInTheDocument();
    // 2 faces shown, remaining 2 collapse to "+2"
    expect(screen.getByLabelText("2 more people")).toHaveTextContent("+2");
  });
});

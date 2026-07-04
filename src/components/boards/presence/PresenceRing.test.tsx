import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PresenceRing } from "./PresenceRing";
import { usePresenceFocusStore } from "@/lib/boards/presence-focus-store";

// PresenceRing now subscribes to the presence focus store (per-target selector)
// instead of the presence context — seed the store directly.
function seed() {
  usePresenceFocusStore.getState().syncPresence({
    selfUserId: "self",
    flashTargetId: null,
    setFocus: () => {},
    focusMap: new Map([
      [
        "cell:i1:c1",
        [
          {
            userId: "u2",
            name: "Sam",
            avatarUrl: null,
            color: "#2d9cdb",
            isSelf: false,
          },
        ],
      ],
    ]),
  });
}

afterEach(() => usePresenceFocusStore.getState().reset());

describe("PresenceRing", () => {
  it("renders an indicator when another user is focused on the target", () => {
    seed();
    render(<PresenceRing target="cell:i1:c1" />);
    expect(screen.getByLabelText(/Sam is editing/i)).toBeInTheDocument();
  });
  it("renders nothing when nobody else is focused there", () => {
    seed();
    const { container } = render(<PresenceRing target="cell:i9:c9" />);
    expect(container).toBeEmptyDOMElement();
  });
});

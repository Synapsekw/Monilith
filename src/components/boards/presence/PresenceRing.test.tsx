import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PresenceRing } from "./PresenceRing";

vi.mock("@/lib/boards/presence-context", () => ({
  useBoardPresenceContext: () => ({
    selfUserId: "self",
    focusMap: new Map([
      ["cell:i1:c1", [{ userId: "u2", name: "Sam", avatarUrl: null, color: "#2d9cdb", isSelf: false }]],
    ]),
  }),
}));

describe("PresenceRing", () => {
  it("renders an indicator when another user is focused on the target", () => {
    render(<PresenceRing target="cell:i1:c1" />);
    expect(screen.getByLabelText(/Sam is editing/i)).toBeInTheDocument();
  });
  it("renders nothing when nobody else is focused there", () => {
    const { container } = render(<PresenceRing target="cell:i9:c9" />);
    expect(container).toBeEmptyDOMElement();
  });
});

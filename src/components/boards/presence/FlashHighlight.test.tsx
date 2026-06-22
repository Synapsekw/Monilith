import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FlashHighlight } from "./FlashHighlight";

vi.mock("@/lib/boards/presence-context", () => ({
  useBoardPresenceContextOptional: () => ({
    selfUserId: "self",
    focusMap: new Map(),
    flashTargetId: "cell:i1:c1",
  }),
}));

describe("FlashHighlight", () => {
  it("renders the highlight when flashTargetId matches the target", () => {
    const { container } = render(<FlashHighlight target="cell:i1:c1" />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
  });

  it("renders nothing for a different target", () => {
    const { container } = render(<FlashHighlight target="cell:i9:c9" />);
    expect(container).toBeEmptyDOMElement();
  });
});

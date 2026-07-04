import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlashHighlight } from "./FlashHighlight";
import { usePresenceFocusStore } from "@/lib/boards/presence-focus-store";

// FlashHighlight now subscribes to the presence focus store (`flashTargetId`)
// instead of the presence context — seed the store directly.
function seedFlash(targetId: string | null) {
  usePresenceFocusStore.getState().syncPresence({
    selfUserId: "self",
    flashTargetId: targetId,
    setFocus: () => {},
    focusMap: new Map(),
  });
}

afterEach(() => usePresenceFocusStore.getState().reset());

describe("FlashHighlight", () => {
  it("renders the highlight when flashTargetId matches the target", () => {
    seedFlash("cell:i1:c1");
    const { container } = render(<FlashHighlight target="cell:i1:c1" />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
  });

  it("renders nothing for a different target", () => {
    seedFlash("cell:i1:c1");
    const { container } = render(<FlashHighlight target="cell:i9:c9" />);
    expect(container).toBeEmptyDOMElement();
  });
});

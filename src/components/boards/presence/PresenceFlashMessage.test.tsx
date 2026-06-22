import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PresenceFlashMessage } from "./PresenceFlashMessage";

describe("PresenceFlashMessage", () => {
  it("renders the message text when given a message", () => {
    render(<PresenceFlashMessage message={{ id: 1, text: "Sam changed this just now" }} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Sam changed this just now");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("renders nothing for a null message", () => {
    const { container } = render(<PresenceFlashMessage message={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

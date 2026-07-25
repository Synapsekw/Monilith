import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CopyField } from "./copy-field";

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => vi.clearAllMocks());

/**
 * userEvent.setup() installs its own navigator.clipboard stub, so our spy has
 * to be attached *after* it or the component talks to userEvent's stub and the
 * spy never sees a call.
 */
function setupWithClipboard() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return user;
}

describe("CopyField", () => {
  it("shows the value", () => {
    render(<CopyField label="Server URL" value="https://x.test/api/mcp" />);
    expect(screen.getByText("https://x.test/api/mcp")).toBeInTheDocument();
  });

  it("copies the value and confirms", async () => {
    const user = setupWithClipboard();
    render(<CopyField label="Server URL" value="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("button", { name: /copy server url/i }));
    expect(writeText).toHaveBeenCalledWith("https://x.test/api/mcp");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("reports a clipboard failure instead of claiming success", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const user = setupWithClipboard();
    render(<CopyField label="Server URL" value="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("button", { name: /copy server url/i }));
    expect(await screen.findByText(/to copy/i)).toBeInTheDocument();
    expect(screen.queryByText("Copied")).toBeNull();
  });
});

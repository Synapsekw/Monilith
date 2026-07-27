import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClientGuide } from "./mcp-client-guide";

const pushState = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window.history, "pushState").mockImplementation(pushState);
});

describe("McpClientGuide", () => {
  it("shows Claude Desktop steps by default", () => {
    render(<McpClientGuide serverUrl="https://x.test/api/mcp" />);
    expect(
      screen.getByRole("tab", { name: /claude desktop/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Connectors/i)).toBeInTheDocument();
  });

  it("switches client without a router navigation", async () => {
    const user = userEvent.setup();
    render(<McpClientGuide serverUrl="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("tab", { name: /claude code/i }));
    expect(
      screen.getByText(/claude mcp add --transport http monolith/i),
    ).toBeInTheDocument();
    // History API only — an RSC navigation here would refetch the whole page.
    expect(pushState).toHaveBeenCalled();
  });

  it("embeds the real server URL in the CLI command", async () => {
    const user = userEvent.setup();
    render(<McpClientGuide serverUrl="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("tab", { name: /claude code/i }));
    expect(screen.getByText(/https:\/\/x\.test\/api\/mcp/)).toBeInTheDocument();
  });

  it("explains discovery for an unlisted client", async () => {
    const user = userEvent.setup();
    render(<McpClientGuide serverUrl="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("tab", { name: /other client/i }));
    expect(screen.getByText(/oauth-protected-resource/i)).toBeInTheDocument();
  });

  // The product is Monolith; "Pulse" in setup copy told users to name the
  // connector after a product that no longer exists.
  it("names the product Monolith in every client's steps", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <McpClientGuide serverUrl="https://x.test/api/mcp" />,
    );
    for (const tab of [
      /claude desktop/i,
      /claude\.ai/i,
      /claude code/i,
      /other client/i,
    ]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      expect(container.textContent).not.toMatch(/pulse/i);
      expect(container.textContent).toMatch(/monolith/i);
    }
  });
});

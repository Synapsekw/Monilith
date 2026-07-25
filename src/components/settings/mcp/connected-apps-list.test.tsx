import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectedAppsList } from "./connected-apps-list";

const { revoke, toastError, toastSuccess } = vi.hoisted(() => ({
  revoke: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/mcp/oauth/connections-actions", () => ({
  revokeConnectionAction: (id: string) => revoke(id),
}));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

const CONNECTIONS = [
  {
    id: "tok-1",
    clientName: "Claude Desktop",
    createdAt: "2026-07-01T10:00:00.000Z",
  },
];

beforeEach(() => vi.clearAllMocks());

describe("ConnectedAppsList", () => {
  it("shows an empty state when nothing is connected", () => {
    render(<ConnectedAppsList connections={[]} />);
    expect(screen.getByText(/no apps connected/i)).toBeInTheDocument();
  });

  it("shows the client name and when it connected", () => {
    render(<ConnectedAppsList connections={CONNECTIONS} />);
    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("confirms before revoking", async () => {
    const user = userEvent.setup();
    render(<ConnectedAppsList connections={CONNECTIONS} />);
    await user.click(screen.getByRole("button", { name: /^revoke$/i }));
    expect(revoke).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/lose access to your Pulse/i),
    ).toBeInTheDocument();
  });

  // The regression this component exists to fix: the old ConnectedAppsSection
  // submitted an inline `form action` and discarded the ActionResult, so a
  // failed revoke looked exactly like a successful one.
  it("surfaces a revoke failure instead of swallowing it", async () => {
    revoke.mockResolvedValue({ ok: false, error: "Token already gone." });
    const user = userEvent.setup();
    render(<ConnectedAppsList connections={CONNECTIONS} />);
    await user.click(screen.getByRole("button", { name: /^revoke$/i }));
    await user.click(screen.getByRole("button", { name: /^revoke access$/i }));
    expect(revoke).toHaveBeenCalledWith("tok-1");
    expect(toastError).toHaveBeenCalledWith("Token already gone.");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("confirms success", async () => {
    revoke.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<ConnectedAppsList connections={CONNECTIONS} />);
    await user.click(screen.getByRole("button", { name: /^revoke$/i }));
    await user.click(screen.getByRole("button", { name: /^revoke access$/i }));
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

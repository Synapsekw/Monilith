import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DangerZone } from "./danger-zone";

// vi.mock factories are hoisted above these declarations, so the spies have to
// come from vi.hoisted — a plain `const` is still in its TDZ when the sonner
// factory reads `toast.error` eagerly.
const { leaveOrg, push, toastError } = vi.hoisted(() => ({
  leaveOrg: vi.fn(),
  push: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/org/actions", () => ({
  leaveOrg: (input: unknown) => leaveOrg(input),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("DangerZone", () => {
  it("asks for confirmation before leaving", async () => {
    const user = userEvent.setup();
    render(<DangerZone orgId={ORG} orgName="Acme" />);
    await user.click(
      screen.getByRole("button", { name: /leave organization/i }),
    );
    expect(leaveOrg).not.toHaveBeenCalled();
    expect(await screen.findByText(/lose access to Acme/i)).toBeInTheDocument();
  });

  it("leaves and redirects home on success", async () => {
    leaveOrg.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<DangerZone orgId={ORG} orgName="Acme" />);
    await user.click(
      screen.getByRole("button", { name: /leave organization/i }),
    );
    await user.click(screen.getByRole("button", { name: /^leave$/i }));
    expect(leaveOrg).toHaveBeenCalledWith({ orgId: ORG });
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("surfaces the sole-owner refusal instead of failing silently", async () => {
    leaveOrg.mockResolvedValue({
      ok: false,
      error: "You are the only owner. Promote another member to owner first.",
    });
    const user = userEvent.setup();
    render(<DangerZone orgId={ORG} orgName="Acme" />);
    await user.click(
      screen.getByRole("button", { name: /leave organization/i }),
    );
    await user.click(screen.getByRole("button", { name: /^leave$/i }));
    expect(toastError).toHaveBeenCalledWith(
      "You are the only owner. Promote another member to owner first.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});

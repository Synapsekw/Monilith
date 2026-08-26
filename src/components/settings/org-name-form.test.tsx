import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrgNameForm } from "./org-name-form";

const { updateOrgName } = vi.hoisted(() => ({ updateOrgName: vi.fn() }));
vi.mock("@/lib/org/actions", () => ({
  updateOrgName: (input: unknown) => updateOrgName(input),
}));

const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("OrgNameForm", () => {
  it("disables save until the name changes", () => {
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("saves a changed name", async () => {
    updateOrgName.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    const input = screen.getByLabelText(/organization name/i);
    await user.clear(input);
    await user.type(input, "Acme Inc");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(updateOrgName).toHaveBeenCalledWith({
      orgId: ORG,
      name: "Acme Inc",
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows the server error on failure", async () => {
    updateOrgName.mockResolvedValue({ ok: false, error: "Not allowed." });
    const user = userEvent.setup();
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    const input = screen.getByLabelText(/organization name/i);
    await user.clear(input);
    await user.type(input, "Nope");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
  });

  it("keeps save disabled for a whitespace-only name", async () => {
    const user = userEvent.setup();
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    const input = screen.getByLabelText(/organization name/i);
    await user.clear(input);
    await user.type(input, "   ");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  // a11y contract (useFieldStatus): the save message is the input's accessible
  // DESCRIPTION, not orphaned text beside it — a screen-reader user tabbing to
  // the field after a failed save hears why it failed. Error vs. "Saved." also
  // has to differ in live-region politeness, hence both cases here.
  it("makes a failed save the input's accessible description and marks it invalid", async () => {
    updateOrgName.mockResolvedValue({ ok: false, error: "Not allowed." });
    const user = userEvent.setup();
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    const input = screen.getByLabelText(/organization name/i);
    await user.clear(input);
    await user.type(input, "Nope");
    await user.click(screen.getByRole("button", { name: /save/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not allowed.");
    expect(input).toHaveAccessibleDescription("Not allowed.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("announces a successful save politely and leaves the field valid", async () => {
    updateOrgName.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    const input = screen.getByLabelText(/organization name/i);
    await user.clear(input);
    await user.type(input, "Acme Inc");
    await user.click(screen.getByRole("button", { name: /save/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Saved.");
    expect(input).toHaveAccessibleDescription("Saved.");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders read-only for a non-admin", () => {
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit={false} />);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});

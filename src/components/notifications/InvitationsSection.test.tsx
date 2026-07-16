import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { InvitationsSection } from "./InvitationsSection";
import type { PendingInvitation } from "@/lib/collaboration/invitations";

const invite: PendingInvitation = {
  id: "inv-1",
  org_id: "org-1",
  org_name: "Acme Inc",
  role: "member",
  created_at: new Date().toISOString(),
};

describe("InvitationsSection", () => {
  it("renders nothing when there are no invites", () => {
    const { container } = render(
      <InvitationsSection
        invites={[]}
        onAccept={() => {}}
        onDecline={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the org name and role and fires Accept/Decline with the invite id", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(
      <InvitationsSection
        invites={[invite]}
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    );
    expect(screen.getByText(/Acme Inc/)).toBeInTheDocument();
    expect(screen.getByText(/member/i)).toBeInTheDocument();

    const row = screen.getByText(/Acme Inc/).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledWith("inv-1");
    fireEvent.click(within(row).getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledWith("inv-1");
  });

  it("renders the Invitations label as a Keystone kicker", () => {
    render(
      <InvitationsSection
        invites={[invite]}
        onAccept={() => {}}
        onDecline={() => {}}
      />,
    );
    const label = screen.getByText("Invitations");
    expect(label.className).toContain("font-mono");
    expect(label.className).toContain("text-kicker");
    expect(label.className).toContain("uppercase");
  });

  it("shows the reciprocity notice on a pending invite", () => {
    render(
      <InvitationsSection
        invites={[invite]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        /collaborate on boards you share from your own workspace/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders an error message when provided", () => {
    render(
      <InvitationsSection
        invites={[invite]}
        onAccept={() => {}}
        onDecline={() => {}}
        error="Could not accept"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not accept");
  });
});

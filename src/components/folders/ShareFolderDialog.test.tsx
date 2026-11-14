import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareFolderDialog } from "./ShareFolderDialog";

const toast = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const loadFolderAccess = vi.fn();
const shareFolder = vi.fn();
const unshareFolder = vi.fn();
const inviteToFolder = vi.fn();
const revokeFolderInvitation = vi.fn();
const leaveFolder = vi.fn();
vi.mock("@/lib/folders/sharing-actions", () => ({
  loadFolderAccess: (...a: unknown[]) => loadFolderAccess(...a),
  shareFolder: (...a: unknown[]) => shareFolder(...a),
  unshareFolder: (...a: unknown[]) => unshareFolder(...a),
  inviteToFolder: (...a: unknown[]) => inviteToFolder(...a),
  revokeFolderInvitation: (...a: unknown[]) => revokeFolderInvitation(...a),
  leaveFolder: (...a: unknown[]) => leaveFolder(...a),
}));

const managerData = {
  canManage: true,
  myUserId: "me",
  membersTruncated: false,
  members: [
    { userId: "u1", fullName: "Dana Lee", avatarUrl: null, level: "viewer" },
  ],
  invitations: [
    { id: "i1", email: "new@x.com", level: "editor", state: "invited" },
    {
      id: "i2",
      email: "wait@x.com",
      level: "viewer",
      state: "awaiting_approval",
    },
  ],
  candidates: [{ userId: "u2", fullName: "Sam Roe" }],
};

function open() {
  return render(
    <ShareFolderDialog
      folderId="f1"
      folderName="DAAS"
      open
      onOpenChange={() => {}}
    />,
  );
}

beforeEach(() => {
  for (const m of [
    loadFolderAccess,
    shareFolder,
    unshareFolder,
    inviteToFolder,
    revokeFolderInvitation,
    leaveFolder,
  ])
    m.mockReset();
  loadFolderAccess.mockResolvedValue({ ok: true, data: managerData });
});

describe("ShareFolderDialog", () => {
  it("loads the folder's people when it opens and lists them", async () => {
    open();
    expect(await screen.findByText("Dana Lee")).toBeInTheDocument();
    expect(loadFolderAccess).toHaveBeenCalledWith({ folderId: "f1" });
  });

  it("labels the two pending states differently", async () => {
    open();
    expect(await screen.findByText("Invited")).toBeInTheDocument();
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
  });

  it("adds an org member picked from the suggestions", async () => {
    shareFolder.mockResolvedValue({ ok: true, data: undefined });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "sam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Sam Roe" }));
    await waitFor(() =>
      expect(shareFolder).toHaveBeenCalledWith({
        folderId: "f1",
        userId: "u2",
        level: "viewer",
      }),
    );
    await waitFor(() => expect(loadFolderAccess).toHaveBeenCalledTimes(2));
  });

  it("invites an email address at the chosen level", async () => {
    inviteToFolder.mockResolvedValue({
      ok: true,
      data: { kind: "invited", emailSent: true },
    });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "pat@x.com" },
    });
    fireEvent.change(screen.getByLabelText("Access for new people"), {
      target: { value: "editor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(inviteToFolder).toHaveBeenCalledWith({
        folderId: "f1",
        email: "pat@x.com",
        level: "editor",
      }),
    );
    expect(
      await screen.findByText(
        "Invitation sent. They get access after they sign up and are approved.",
      ),
    ).toBeInTheDocument();
  });

  it("says so when no email went out because the person already has an account", async () => {
    inviteToFolder.mockResolvedValue({
      ok: true,
      data: { kind: "invited", emailSent: false },
    });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "old@x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(
      await screen.findByText(
        "The invitation is saved, but the email couldn't be sent. Copy the link below and send it to them.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/already have an account/),
    ).not.toBeInTheDocument();
  });

  it("confirms a direct add when the email belonged to an org member", async () => {
    inviteToFolder.mockResolvedValue({ ok: true, data: { kind: "shared" } });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "sam@x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(
      await screen.findByText(
        "Added. They can open every board in this folder now.",
      ),
    ).toBeInTheDocument();
  });

  it("flags an invalid email on the field and announces it", async () => {
    open();
    await screen.findByText("Dana Lee");
    const input = screen.getByLabelText("Name or email");
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid email address",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(inviteToFolder).not.toHaveBeenCalled();
  });

  it("says when the list is cut short", async () => {
    loadFolderAccess.mockResolvedValue({
      ok: true,
      data: { ...managerData, membersTruncated: true },
    });
    open();
    expect(
      await screen.findByText(/The list is cut short/),
    ).toBeInTheDocument();
  });

  it("changes a member's level and removes a member", async () => {
    shareFolder.mockResolvedValue({ ok: true, data: undefined });
    unshareFolder.mockResolvedValue({ ok: true, data: undefined });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    await waitFor(() =>
      expect(shareFolder).toHaveBeenCalledWith({
        folderId: "f1",
        userId: "u1",
        level: "editor",
      }),
    );
    // Controls stay disabled until the reload after the level change lands.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove Dana Lee" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Dana Lee" }));
    await waitFor(() =>
      expect(unshareFolder).toHaveBeenCalledWith({
        folderId: "f1",
        userId: "u1",
      }),
    );
  });

  it("shows the action's error and keeps the previous level", async () => {
    shareFolder.mockResolvedValue({
      ok: false,
      error: "Only the folder's creator or an admin can invite people",
    });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    expect(
      await screen.findByText(
        "Only the folder's creator or an admin can invite people",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Access for Dana Lee")).toHaveValue("viewer");
  });

  it("is read-only for someone who cannot manage, with a way to leave", async () => {
    loadFolderAccess.mockResolvedValue({
      ok: true,
      data: {
        canManage: false,
        myUserId: "u1",
        membersTruncated: false,
        members: managerData.members,
        invitations: [],
        candidates: [],
      },
    });
    leaveFolder.mockResolvedValue({ ok: true, data: undefined });
    open();
    await screen.findByText("Dana Lee");
    expect(screen.queryByLabelText("Name or email")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Access for Dana Lee"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave folder" }));
    await waitFor(() =>
      expect(leaveFolder).toHaveBeenCalledWith({ folderId: "f1" }),
    );
  });

  it("revokes a pending invitation", async () => {
    revokeFolderInvitation.mockResolvedValue({ ok: true, data: undefined });
    open();
    await screen.findByText("Invited");
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke invitation for new@x.com" }),
    );
    await waitFor(() =>
      expect(revokeFolderInvitation).toHaveBeenCalledWith({
        folderId: "f1",
        invitationId: "i1",
      }),
    );
  });

  it("copies the folder link (the header's old Share behaviour)", async () => {
    toast.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Link copied"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.href,
    );
  });
});

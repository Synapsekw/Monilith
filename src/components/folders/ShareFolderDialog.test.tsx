import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef, useState } from "react";
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

/**
 * The rows render as soon as the load resolves, but the load runs inside a
 * transition, so every control stays disabled until that transition ends. Under
 * load a click in between is a silent no-op. Wait until nothing is disabled
 * (the Invite submit button is excluded: it is also disabled by an empty field).
 */
async function settled() {
  await waitFor(() =>
    expect(
      document.querySelectorAll(
        "input:disabled, select:disabled, button[type=button]:disabled",
      ),
    ).toHaveLength(0),
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
    await settled();
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
      data: { kind: "invited", delivery: "invite_email" },
    });
    open();
    await screen.findByText("Dana Lee");
    await settled();
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
        "Invitation emailed. They get access after they set a password and an administrator approves their account.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    [
      "notice_email",
      "They already have a Monolith account, so we emailed them and added the invitation to their notifications. They get access when they accept it.",
    ],
    [
      "in_app",
      "They already have a Monolith account. No email was sent: the invitation is waiting in their notifications, and they get access when they accept it.",
    ],
  ])(
    "never says 'sent' for an existing account (%s)",
    async (delivery, copy) => {
      inviteToFolder.mockResolvedValue({
        ok: true,
        data: { kind: "invited", delivery },
      });
      open();
      await screen.findByText("Dana Lee");
      await settled();
      fireEvent.change(screen.getByLabelText("Name or email"), {
        target: { value: "old@x.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Invite" }));
      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(screen.queryByText(/invitation sent/i)).not.toBeInTheDocument();
    },
  );

  it("says what is true when the invitation email could not be delivered", async () => {
    inviteToFolder.mockResolvedValue({
      ok: true,
      data: { kind: "invited", delivery: "failed" },
    });
    open();
    await screen.findByText("Dana Lee");
    await settled();
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "old@x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(
      await screen.findByText(
        "The invitation is saved, but we couldn't send the email. They'll get access when they sign up with this address and are approved. You can revoke it below.",
      ),
    ).toBeInTheDocument();
    // The folder link is useless to someone without an account, and the UI
    // never claims to know whether the address has one.
    expect(screen.queryByText(/copy the link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/account/i)).not.toBeInTheDocument();
  });

  it("confirms a direct add when the email belonged to an org member", async () => {
    inviteToFolder.mockResolvedValue({ ok: true, data: { kind: "shared" } });
    open();
    await screen.findByText("Dana Lee");
    await settled();
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
    await settled();
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
    loadFolderAccess
      .mockResolvedValueOnce({ ok: true, data: managerData })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ...managerData,
          members: [{ ...managerData.members[0], level: "editor" }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { ...managerData, members: [] },
      });
    open();
    await screen.findByText("Dana Lee");
    await settled();
    expect(screen.getByLabelText("Access for Dana Lee")).toHaveValue("viewer");
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
    // The list shows what the reload returned, not just what was sent.
    await waitFor(() =>
      expect(screen.getByLabelText("Access for Dana Lee")).toHaveValue(
        "editor",
      ),
    );
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
    await waitFor(() =>
      expect(screen.queryByText("Dana Lee")).not.toBeInTheDocument(),
    );
  });

  it("shows the action's error and keeps the previous level", async () => {
    shareFolder.mockResolvedValue({
      ok: false,
      error: "Only the folder's creator or an admin can invite people",
    });
    open();
    await screen.findByText("Dana Lee");
    await settled();
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
    await settled();
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
    await settled();
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
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Link copied"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.href,
    );
  });

  it("gives the icon-only buttons a coarse-pointer size and a name with the person", async () => {
    open();
    await screen.findByText("Dana Lee");
    await settled();
    for (const name of [
      "Remove Dana Lee",
      "Revoke invitation for new@x.com",
      "Revoke invitation for wait@x.com",
    ])
      expect(screen.getByRole("button", { name }).className).toContain(
        "pointer-coarse:size-11",
      );
  });
});

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Harness({
  onChanged,
  initiallyOpen = true,
}: {
  onChanged?: () => void;
  initiallyOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        reopen
      </button>
      <ShareFolderDialog
        folderId="f1"
        folderName="DAAS"
        open={isOpen}
        onOpenChange={setIsOpen}
        onChanged={onChanged}
      />
    </>
  );
}

describe("ShareFolderDialog concurrency", () => {
  function typeEmail(value: string) {
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value },
    });
  }
  const form = () => screen.getByLabelText("Name or email").closest("form")!;

  it("submits an invitation once when Invite is triggered twice", async () => {
    const d = deferred<unknown>();
    inviteToFolder.mockReturnValue(d.promise);
    render(<Harness />);
    await screen.findByText("Dana Lee");
    await settled();
    typeEmail("pat@x.com");
    fireEvent.submit(form());
    fireEvent.submit(form());
    expect(inviteToFolder).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve({
        ok: true,
        data: { kind: "invited", delivery: "invite_email" },
      });
    });
  });

  it("runs one action at a time across different controls", async () => {
    const d = deferred<unknown>();
    shareFolder.mockReturnValue(d.promise);
    unshareFolder.mockResolvedValue({ ok: true, data: undefined });
    render(<Harness />);
    await screen.findByText("Dana Lee");
    await settled();
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    // Remove is clicked through the DOM while the level change is in flight.
    screen.getByRole("button", { name: "Remove Dana Lee" }).click();
    expect(unshareFolder).not.toHaveBeenCalled();
    await act(async () => {
      d.resolve({ ok: true, data: undefined });
    });
  });

  it("ignores a second Revoke while one is in flight", async () => {
    const rev = deferred<unknown>();
    revokeFolderInvitation.mockReturnValue(rev.promise);
    render(<Harness />);
    await screen.findByText("Invited");
    await settled();
    const revoke = screen.getByRole("button", {
      name: "Revoke invitation for new@x.com",
    });
    act(() => {
      revoke.click();
      revoke.click();
    });
    await waitFor(() =>
      expect(revokeFolderInvitation).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      rev.resolve({ ok: true, data: undefined });
    });
    await settled();
    expect(revokeFolderInvitation).toHaveBeenCalledTimes(1);
  });

  it("ignores a second Leave while the first is in flight", async () => {
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
    const d = deferred<unknown>();
    leaveFolder.mockReturnValue(d.promise);
    render(<Harness />);
    await screen.findByText("Dana Lee");
    await settled();
    const leave = screen.getByRole("button", { name: "Leave folder" });
    act(() => {
      leave.click();
      leave.click();
    });
    await waitFor(() => expect(leaveFolder).toHaveBeenCalledTimes(1));
    await act(async () => {
      d.resolve({ ok: true, data: undefined });
    });
    expect(leaveFolder).toHaveBeenCalledTimes(1);
  });

  it("does not write state or count a change when the response lands after close", async () => {
    const onChanged = vi.fn();
    const d = deferred<unknown>();
    inviteToFolder.mockReturnValue(d.promise);
    render(<Harness onChanged={onChanged} />);
    await screen.findByText("Dana Lee");
    await settled();
    typeEmail("pat@x.com");
    fireEvent.submit(form());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    loadFolderAccess.mockClear();
    await act(async () => {
      d.resolve({
        ok: true,
        data: { kind: "invited", delivery: "invite_email" },
      });
    });
    // No reload for a dialog that is gone, and nothing counted as a change.
    expect(loadFolderAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("reopen"));
    await screen.findByText("Dana Lee");
    await settled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("never lets an older load overwrite a newer one", async () => {
    const slow = deferred<unknown>();
    loadFolderAccess.mockReturnValueOnce(slow.promise);
    render(<Harness />);
    // First open: the read is still pending. Close, then reopen: a second read.
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    loadFolderAccess.mockResolvedValueOnce({
      ok: true,
      data: {
        ...managerData,
        members: [
          {
            userId: "u9",
            fullName: "Newer Person",
            avatarUrl: null,
            level: "viewer",
          },
        ],
      },
    });
    fireEvent.click(screen.getByText("reopen"));
    await screen.findByText("Newer Person");

    await act(async () => {
      slow.resolve({ ok: true, data: managerData });
    });
    expect(screen.getByText("Newer Person")).toBeInTheDocument();
    expect(screen.queryByText("Dana Lee")).not.toBeInTheDocument();
  });

  it("shows a failed Leave without marking any field invalid", async () => {
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
    leaveFolder.mockResolvedValue({ ok: false, error: "Couldn't leave." });
    const onOpenChange = vi.fn();
    render(
      <ShareFolderDialog
        folderId="f1"
        folderName="DAAS"
        open
        onOpenChange={onOpenChange}
      />,
    );
    await screen.findByText("Dana Lee");
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Leave folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't leave.",
    );
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("ShareFolderDialog onChanged", () => {
  const close = async () => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  };

  it("does not fire when the dialog is opened and closed with no change", async () => {
    const onChanged = vi.fn();
    render(<Harness onChanged={onChanged} />);
    await screen.findByText("Dana Lee");
    await settled();
    await close();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not fire after a failed action", async () => {
    const onChanged = vi.fn();
    shareFolder.mockResolvedValue({ ok: false, error: "Nope." });
    render(<Harness onChanged={onChanged} />);
    await screen.findByText("Dana Lee");
    await settled();
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    await screen.findByText("Nope.");
    await close();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("fires once after a successful action", async () => {
    const onChanged = vi.fn();
    shareFolder.mockResolvedValue({ ok: true, data: undefined });
    render(<Harness onChanged={onChanged} />);
    await screen.findByText("Dana Lee");
    await settled();
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    await waitFor(() => expect(loadFolderAccess).toHaveBeenCalledTimes(2));
    await close();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("ShareFolderDialog focus return", () => {
  it("returns focus to the control that opened it", async () => {
    const ref = createRef<HTMLButtonElement>();
    function WithOpener() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button ref={ref} type="button" onClick={() => setIsOpen(true)}>
            opener
          </button>
          <ShareFolderDialog
            folderId="f1"
            folderName="DAAS"
            open={isOpen}
            onOpenChange={setIsOpen}
            returnFocusRef={ref}
          />
        </>
      );
    }
    render(<WithOpener />);
    fireEvent.click(screen.getByText("opener"));
    await screen.findByText("Dana Lee");
    await settled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(ref.current));
  });
});

describe("ShareFolderDialog focus after a row goes away", () => {
  it("moves focus to the name or email field after Remove", async () => {
    unshareFolder.mockResolvedValue({ ok: true, data: undefined });
    loadFolderAccess
      .mockResolvedValueOnce({ ok: true, data: managerData })
      .mockResolvedValue({ ok: true, data: { ...managerData, members: [] } });
    open();
    await screen.findByText("Dana Lee");
    await settled();
    const remove = screen.getByRole("button", { name: "Remove Dana Lee" });
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() =>
      expect(screen.queryByText("Dana Lee")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Name or email"),
      ),
    );
  });

  it("moves focus to the dialog when the viewer cannot manage", async () => {
    revokeFolderInvitation.mockResolvedValue({ ok: true, data: undefined });
    const viewerData = {
      ...managerData,
      canManage: false,
      invitations: [managerData.invitations[0]],
    };
    loadFolderAccess
      .mockResolvedValueOnce({ ok: true, data: viewerData })
      .mockResolvedValue({
        ok: true,
        data: { ...viewerData, invitations: [] },
      });
    open();
    const revoke = await screen.findByRole("button", {
      name: "Revoke invitation for new@x.com",
    });
    await settled();
    revoke.focus();
    fireEvent.click(revoke);
    await waitFor(() =>
      expect(screen.queryByText("new@x.com")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("dialog")),
    );
  });
});

describe("ShareFolderDialog member labels", () => {
  it("shows email for nameless members and candidates, name only for named ones", async () => {
    loadFolderAccess.mockResolvedValue({
      ok: true,
      data: {
        ...managerData,
        members: [
          {
            userId: "u1",
            fullName: "Dana Lee",
            email: null,
            avatarUrl: null,
            level: "viewer",
          },
          {
            userId: "u3",
            fullName: null,
            email: "pat.kim@x.com",
            avatarUrl: null,
            level: "editor",
          },
          {
            userId: "u4",
            fullName: null,
            email: null,
            avatarUrl: null,
            level: "viewer",
          },
        ],
        invitations: [],
        candidates: [{ userId: "u2", fullName: null, email: "sam@x.com" }],
      },
    });
    open();
    const row = await screen.findByText("pat.kim@x.com");
    expect(row).toHaveAttribute("title", "pat.kim@x.com");
    expect(screen.getByText("Dana Lee")).toBeInTheDocument();
    expect(screen.getByText("Unknown member")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Access for pat.kim@x.com"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove pat.kim@x.com" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Access for Dana Lee")).toBeInTheDocument();
    await settled();
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "sam" },
    });
    expect(
      screen.getByRole("button", { name: "Add sam@x.com" }),
    ).toBeInTheDocument();
  });
});

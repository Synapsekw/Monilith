import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
vi.mock("./ShareFolderDialog", () => ({
  ShareFolderDialog: ({
    open,
    onChanged,
    returnFocusRef,
  }: {
    open: boolean;
    onChanged?: () => void;
    returnFocusRef?: { current: HTMLElement | null };
  }) =>
    open ? (
      <div>
        share-dialog
        <button type="button" onClick={() => returnFocusRef?.current?.focus()}>
          return focus
        </button>
        <button type="button" onClick={onChanged}>
          changed
        </button>
      </div>
    ) : null,
}));
import { HeaderActions } from "./HeaderActions";

const base = {
  folderId: "f1",
  folderName: "DAAS",
  access: { count: 0, memberIds: [] as string[], canManage: true },
  members: [] as {
    userId: string;
    fullName: string | null;
    avatarUrl: string | null;
  }[],
};

describe("HeaderActions", () => {
  beforeEach(() => {
    window.print = vi.fn();
  });

  it("opens the share dialog from Invite", async () => {
    render(<HeaderActions {...base} canExport />);
    expect(screen.queryByText("share-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    // The dialog is a dynamic import, so it arrives a tick later.
    expect(await screen.findByText("share-dialog")).toBeInTheDocument();
  });

  it("refreshes the page's own data when the dialog reports a change", async () => {
    refresh.mockClear();
    render(<HeaderActions {...base} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    fireEvent.click(await screen.findByRole("button", { name: "changed" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("hands the dialog the Invite button to return focus to", async () => {
    render(<HeaderActions {...base} canExport />);
    const invite = screen.getByRole("button", { name: "Invite" });
    fireEvent.click(invite);
    fireEvent.click(
      await screen.findByRole("button", { name: "return focus" }),
    );
    expect(document.activeElement).toBe(invite);
  });

  it("shows who the folder is shared with and how many more", () => {
    render(
      <HeaderActions
        {...base}
        canExport
        access={{ count: 6, memberIds: ["a", "b", "c", "d"], canManage: false }}
        members={[
          { userId: "a", fullName: "Dana Lee", avatarUrl: null },
          { userId: "b", fullName: "Sam Roe", avatarUrl: null },
        ]}
      />,
    );
    expect(screen.getByLabelText("Shared with 6 people")).toBeInTheDocument();
    expect(screen.getByText("DL")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("shows no stack when the folder is shared with nobody", () => {
    render(<HeaderActions {...base} canExport />);
    expect(screen.queryByLabelText(/Shared with/)).not.toBeInTheDocument();
  });

  it("labels the button People for someone who cannot manage the folder", () => {
    render(
      <HeaderActions
        {...base}
        canExport
        access={{ count: 1, memberIds: ["a"], canManage: false }}
        members={[{ userId: "a", fullName: "Dana Lee", avatarUrl: null }]}
      />,
    );
    expect(screen.getByRole("button", { name: "People" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invite" }),
    ).not.toBeInTheDocument();
  });

  it("Export PDF prints on a canvas tab and is disabled elsewhere", () => {
    const { rerender } = render(<HeaderActions {...base} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(window.print).toHaveBeenCalledTimes(1);
    rerender(<HeaderActions {...base} canExport={false} />);
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
  });

  it("Ask about this folder links to /ask?folder=", () => {
    render(<HeaderActions {...base} canExport />);
    expect(
      screen.getByRole("link", { name: "Ask about this folder" }),
    ).toHaveAttribute("href", "/ask?folder=f1");
  });
});

describe("HeaderActions avatar initials", () => {
  it("uses the email's local part for a nameless member and the name otherwise", () => {
    render(
      <HeaderActions
        {...base}
        canExport
        access={{ count: 3, memberIds: ["a", "b", "c"], canManage: false }}
        members={[
          {
            userId: "a",
            fullName: null,
            email: "pat.kim@x.com",
            avatarUrl: null,
          },
          { userId: "b", fullName: "Dana Lee", email: null, avatarUrl: null },
          { userId: "c", fullName: null, email: null, avatarUrl: null },
        ]}
      />,
    );
    expect(screen.getByText("PK")).toBeInTheDocument();
    expect(screen.getByText("DL")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});

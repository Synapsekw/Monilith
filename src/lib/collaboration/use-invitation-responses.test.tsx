import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { PendingInvitation } from "./invitations";

const { acceptMutate, declineMutate, setActiveOrg } = vi.hoisted(() => ({
  acceptMutate: vi.fn(),
  declineMutate: vi.fn(),
  setActiveOrg: vi.fn(),
}));
vi.mock("./use-invitation-mutations", () => ({
  useInvitationMutations: () => ({
    accept: {
      mutate: acceptMutate,
      isPending: false,
      variables: undefined,
      error: null,
    },
    decline: {
      mutate: declineMutate,
      isPending: false,
      variables: undefined,
      error: null,
    },
  }),
}));
vi.mock("@/lib/org/active-actions", () => ({
  setActiveOrg: (id: string) => setActiveOrg(id),
}));

import {
  INVITE_FLASH_KEY,
  takeInviteFlash,
  useInvitationResponses,
} from "./use-invitation-responses";

const folderInvite: PendingInvitation = {
  id: "inv-1",
  org_id: "org-1",
  org_name: "Acme",
  role: "guest",
  created_at: "2026-11-15T00:00:00Z",
  inviter_name: "Ann",
  folder_id: "f-1",
  folder_name: "Launch",
  folder_count: 1,
};
const orgInvite: PendingInvitation = {
  id: "inv-2",
  org_id: "org-2",
  org_name: "Beta",
  role: "member",
  created_at: "2026-11-15T00:00:00Z",
};

const assign = vi.fn();

beforeEach(() => {
  acceptMutate.mockReset();
  declineMutate.mockReset();
  setActiveOrg.mockReset().mockResolvedValue(undefined);
  assign.mockReset();
  window.sessionStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });
});

/** Run the success callback the hook handed to accept.mutate. */
async function succeed(orgId: string) {
  const options = acceptMutate.mock.calls[0][1] as {
    onSuccess: (orgId: string) => Promise<void>;
  };
  await options.onSuccess(orgId);
}

describe("useInvitationResponses", () => {
  it("accepts by id and does nothing visible until the accept succeeds", () => {
    const { result } = renderHook(() =>
      useInvitationResponses("u1", [folderInvite]),
    );
    result.current.onAccept("inv-1");
    expect(acceptMutate.mock.calls[0][0]).toBe("inv-1");
    expect(setActiveOrg).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("switches to the invited org, then opens the folder with a message waiting", async () => {
    const { result } = renderHook(() =>
      useInvitationResponses("u1", [folderInvite, orgInvite]),
    );
    result.current.onAccept("inv-1");
    await succeed("org-1");
    expect(setActiveOrg).toHaveBeenCalledWith("org-1");
    expect(assign).toHaveBeenCalledWith("/folders/f-1");
    // The org switch is done before the navigation starts.
    expect(setActiveOrg.mock.invocationCallOrder[0]).toBeLessThan(
      assign.mock.invocationCallOrder[0],
    );
    expect(window.sessionStorage.getItem(INVITE_FLASH_KEY)).toBe(
      "You now have access to the folder Launch in Acme",
    );
  });

  it("goes to the app entry for an org invitation with no folder", async () => {
    const { result } = renderHook(() =>
      useInvitationResponses("u1", [folderInvite, orgInvite]),
    );
    result.current.onAccept("inv-2");
    await succeed("org-2");
    expect(setActiveOrg).toHaveBeenCalledWith("org-2");
    expect(assign).toHaveBeenCalledWith("/");
    expect(window.sessionStorage.getItem(INVITE_FLASH_KEY)).toBe(
      "You joined Beta",
    );
  });

  it("still navigates when the org switch fails", async () => {
    setActiveOrg.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useInvitationResponses("u1", [folderInvite]),
    );
    result.current.onAccept("inv-1");
    await succeed("org-1");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/folders/f-1"));
  });

  it("declines by id without navigating", () => {
    const { result } = renderHook(() =>
      useInvitationResponses("u1", [folderInvite]),
    );
    result.current.onDecline("inv-1");
    expect(declineMutate).toHaveBeenCalledWith("inv-1");
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("takeInviteFlash", () => {
  it("returns the message once and clears it", () => {
    window.sessionStorage.setItem(INVITE_FLASH_KEY, "You joined Beta");
    expect(takeInviteFlash()).toBe("You joined Beta");
    expect(takeInviteFlash()).toBeNull();
  });
});

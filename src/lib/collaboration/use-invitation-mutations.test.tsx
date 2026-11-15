import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { acceptInvitation, refreshAccessAfterInvitation } = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  refreshAccessAfterInvitation: vi.fn(),
}));
vi.mock("@/lib/offline/online-status", () => ({ assertOnline: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("./invitations-data", () => ({
  acceptInvitation,
  declineInvitation: vi.fn(),
}));
vi.mock("./invitation-actions", () => ({ refreshAccessAfterInvitation }));

import { useInvitationMutations } from "./use-invitation-mutations";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  acceptInvitation.mockReset();
  refreshAccessAfterInvitation.mockReset().mockResolvedValue(undefined);
});

describe("useInvitationMutations accept", () => {
  it("expires the server access caches for the accepted org", async () => {
    acceptInvitation.mockResolvedValue("org-7");
    const { result } = renderHook(() => useInvitationMutations("u1"), {
      wrapper,
    });
    result.current.accept.mutate("inv-1");
    await waitFor(() =>
      expect(refreshAccessAfterInvitation).toHaveBeenCalledWith("org-7"),
    );
  });

  it("does not refresh when the accept failed", async () => {
    acceptInvitation.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useInvitationMutations("u1"), {
      wrapper,
    });
    result.current.accept.mutate("inv-1");
    await waitFor(() => expect(result.current.accept.isError).toBe(true));
    expect(refreshAccessAfterInvitation).not.toHaveBeenCalled();
  });

  it("an error refreshing the cache does not fail the accept", async () => {
    acceptInvitation.mockResolvedValue("org-7");
    refreshAccessAfterInvitation.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useInvitationMutations("u1"), {
      wrapper,
    });
    result.current.accept.mutate("inv-1");
    await waitFor(() => expect(result.current.accept.isSuccess).toBe(true));
  });
});

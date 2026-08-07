import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the browser Supabase client: the RPC read plus the realtime channel the
// hook subscribes to. `handlers` captures each .on() callback by event name so
// a test can fire the event the server would have sent.
const rpc = vi.fn();
const handlers = new Map<string, () => void>();
const channel: Record<string, unknown> = {};
channel.on = vi.fn((_type: string, cfg: { event: string }, cb: () => void) => {
  handlers.set(cfg.event, cb);
  return channel;
});
channel.subscribe = vi.fn(() => channel);
const client = {
  rpc,
  channel: vi.fn(() => channel),
  removeChannel: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));

import { useInvitations } from "./use-invitations";

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const INVITE = {
  id: "i1",
  org_id: "o1",
  org_name: "Acme",
  role: "member",
  created_at: "2026-08-07T00:00:00Z",
};

beforeEach(() => {
  rpc.mockReset();
  handlers.clear();
  // Both must be cleared: `channel` and `removeChannel` are module-level
  // vi.fn()s, so call counts would otherwise leak across tests and the
  // "does not subscribe without a user id" assertion would see earlier calls.
  client.channel.mockClear();
  client.removeChannel.mockClear();
  rpc.mockResolvedValue({ data: [], error: null });
});

describe("useInvitations", () => {
  it("subscribes to INSERT and UPDATE on org_invitations", async () => {
    const { result } = renderHook(() => useInvitations("u1"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(client.channel).toHaveBeenCalledWith("invitations:u1");
    expect(handlers.has("INSERT")).toBe(true);
    expect(handlers.has("UPDATE")).toBe(true);
  });

  it("refetches when an invite arrives, so a new invite needs no reload", async () => {
    const { result } = renderHook(() => useInvitations("u1"), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.count).toBe(0));

    rpc.mockResolvedValue({ data: [INVITE], error: null });
    handlers.get("INSERT")!();

    await waitFor(() => expect(result.current.count).toBe(1));
    expect(result.current.invites[0].org_name).toBe("Acme");
  });

  it("refetches when an invite is revoked, so it leaves an open bell", async () => {
    rpc.mockResolvedValue({ data: [INVITE], error: null });
    const { result } = renderHook(() => useInvitations("u1"), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.count).toBe(1));

    // revokeInvite sets status='revoked', so the RPC now returns nothing.
    rpc.mockResolvedValue({ data: [], error: null });
    handlers.get("UPDATE")!();

    await waitFor(() => expect(result.current.count).toBe(0));
  });

  it("removes the channel on unmount", async () => {
    const { result, unmount } = renderHook(() => useInvitations("u1"), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));

    unmount();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("does not subscribe without a user id", () => {
    renderHook(() => useInvitations(""), { wrapper: wrapperFor(newClient()) });
    expect(client.channel).not.toHaveBeenCalled();
  });
});

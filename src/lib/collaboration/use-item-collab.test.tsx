import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the browser Supabase client: two table reads + the realtime channel
// the hook subscribes to in its effect.
const from = vi.fn();
const channel: Record<string, unknown> = {};
channel.on = vi.fn(() => channel);
channel.subscribe = vi.fn(() => channel);
const client = {
  from,
  channel: vi.fn(() => channel),
  removeChannel: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));

import { useItemCollab } from "./use-item-collab";

type Result = { data: unknown[] | null; error: { message: string } | null };

function makeChain(result: Result) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: async () => result,
  };
  return chain;
}

function mockReads(updates: Result, activities: Result) {
  from.mockImplementation((table: string) =>
    makeChain(table === "item_updates" ? updates : activities),
  );
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  from.mockReset();
});

describe("useItemCollab", () => {
  it("resolves updates and activity from the two reads", async () => {
    mockReads(
      { data: [{ id: "u1", item_id: "i1" }], error: null },
      { data: [{ id: "a1", item_id: "i1" }], error: null },
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useItemCollab("i1"), {
      wrapper: wrapperFor(qc),
    });

    await waitFor(() => expect(result.current.updates.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.activity.isSuccess).toBe(true));
    expect(result.current.updates.data?.updates).toHaveLength(1);
    expect(result.current.activity.data?.activities).toHaveLength(1);
  });

  it("marks the updates query as errored when the read fails (no silent empty panel)", async () => {
    mockReads(
      { data: null, error: { message: "updates read failed" } },
      { data: [], error: null },
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useItemCollab("i1"), {
      wrapper: wrapperFor(qc),
    });

    await waitFor(() => expect(result.current.updates.isError).toBe(true));
    // The failed fetch must NOT be cached as a successful empty list.
    expect(result.current.updates.data).toBeUndefined();
  });

  it("marks the activity query as errored when the read fails", async () => {
    mockReads(
      { data: [], error: null },
      { data: null, error: { message: "activity read failed" } },
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useItemCollab("i1"), {
      wrapper: wrapperFor(qc),
    });

    await waitFor(() => expect(result.current.activity.isError).toBe(true));
    expect(result.current.activity.data).toBeUndefined();
  });
});

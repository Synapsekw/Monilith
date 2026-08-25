import { describe, it, expect, vi } from "vitest";

// These mocks matter only for the PRE-fix code path (which routed through
// queries-cached.ts's `"use cache"` functions on the service client) — see
// the regression test below. Post-fix, widget-slot-core.ts no longer imports
// either module, so the mocks are simply unused; keeping them here lets this
// file prove the fix by being run against the pre-fix source unmodified
// (`git stash` widget-slot-core.ts/queries-cached.ts, rerun, restore).
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Mirrors createServiceClient(): a real service-role client with no user
// session. `dashboard_aggregate`/`dashboard_completion`/`dashboard_health_summary`
// are SECURITY DEFINER and gate on `is_org_member(org_id)` — which reads
// `auth.uid()`. With no session, `auth.uid()` is NULL, so the guard raises
// `42501` UNCONDITIONALLY: it fails this way for every caller, authorized or
// not (20260704110000_dashboard_rpc_board_read_guards.sql). This fake
// reproduces that failure mode precisely (same errcode + message shape).
const RLS_GUARD_ERROR = {
  code: "42501",
  message: "not a member of this organization",
};

function brokenServiceClient() {
  return {
    rpc: vi.fn(async () => ({ data: null, error: RLS_GUARD_ERROR })),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          is: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }),
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const broken = brokenServiceClient();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => broken,
}));

// A client with a real session — mirrors what `createClient()` (the
// per-request RLS client) returns once cookies carry a live auth session. Its
// `.rpc()` succeeds because a real `auth.uid()` lets `is_org_member` /
// `can_read_board` evaluate correctly, exactly as
// `dashboard-board-read-guards.rls.integration.test.ts`'s
// "the owner CAN read its own private board's dashboard aggregate" test
// proves against the live DB with a genuinely authenticated client.
function authenticatedClient(rpcResults: Record<string, unknown>) {
  return {
    rpc: vi.fn(async (name: string) => ({
      data: rpcResults[name] ?? null,
      error: null,
    })),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          is: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }),
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

import { resolveWidgetSlot } from "./widget-slot-core";

const WIDGET_ID = "33333333-3333-4333-8333-333333333333";
const BOARD_ID = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "org-1";

// Regression for the confirmed live bug: number/battery/completion/health
// widgets 42501'd unconditionally because resolveWidgetAggregate resolved
// them on the service client (no session) instead of the request's own
// RLS-respecting client. This test passes an authenticated client double that
// WOULD succeed and asserts resolveWidgetSlot actually uses it — not the
// always-broken service client `broken` mocked above.
//
// Pre-fix, this is RED: resolveWidgetAggregate ignored the client it was
// handed for these widget kinds and called the cached, service-client-only
// functions in queries-cached.ts regardless, so `res.ok` was `false` with
// `RLS_GUARD_ERROR`'s message, and `broken.rpc` (not `authed.rpc`) was the one
// actually called — even though `authed` was a fully-authorized, working
// client the whole time.
describe("resolveWidgetSlot — aggregate family uses the caller's own client", () => {
  it("number: resolves via the passed client, never the service client", async () => {
    const authed = authenticatedClient({
      dashboard_aggregate: [{ group_key: null, metric: 3 }],
    });
    const widget = {
      kind: "number" as const,
      config: { agg: "count" },
      source_board_id: BOARD_ID,
      org_id: ORG_ID,
    };

    const result = await resolveWidgetSlot(authed, WIDGET_ID, widget);

    expect(result.ok).toBe(true);
    if (result.ok && "buckets" in result)
      expect(result.buckets).toEqual([{ group_key: null, metric: 3 }]);
    expect(authed.rpc).toHaveBeenCalledWith(
      "dashboard_aggregate",
      expect.objectContaining({ p_board_id: BOARD_ID }),
    );
    expect(broken.rpc).not.toHaveBeenCalled();
  });

  it("completion: resolves via the passed client, never the service client", async () => {
    const authed = authenticatedClient({
      dashboard_completion: [
        { group_key: "g1", item_count: 2, completion: 50 },
      ],
    });
    const widget = {
      kind: "completion" as const,
      config: { mode: "status", statusColumnId: "col-1", doneOptionIds: [] },
      source_board_id: BOARD_ID,
      org_id: ORG_ID,
    };

    const result = await resolveWidgetSlot(authed, WIDGET_ID, widget);

    expect(result.ok).toBe(true);
    if (result.ok && "completion" in result)
      expect(result.completion?.rows[0]).toMatchObject({
        groupKey: "g1",
        completion: 50,
      });
    expect(authed.rpc).toHaveBeenCalledWith(
      "dashboard_completion",
      expect.objectContaining({ p_board_id: BOARD_ID }),
    );
    expect(broken.rpc).not.toHaveBeenCalled();
  });

  it("health: resolves via the passed client, never the service client", async () => {
    const authed = authenticatedClient({
      dashboard_health_summary: [
        {
          total_items: 8,
          done_items: 2,
          overdue_items: 3,
          incomplete_items: 4,
          new_items: 1,
        },
      ],
    });
    const widget = {
      kind: "health" as const,
      config: {},
      source_board_id: BOARD_ID,
      org_id: ORG_ID,
    };

    const result = await resolveWidgetSlot(authed, WIDGET_ID, widget);

    expect(result.ok).toBe(true);
    if (result.ok && "health" in result)
      expect(result.health).toMatchObject({ overdueItems: 3 });
    expect(authed.rpc).toHaveBeenCalledWith(
      "dashboard_health_summary",
      expect.objectContaining({ p_board_id: BOARD_ID }),
    );
    expect(broken.rpc).not.toHaveBeenCalled();
  });
});

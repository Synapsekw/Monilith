import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unsubscribeSignature } from "@/lib/digest/token";

// ── module mocks ─────────────────────────────────────────────────────────────
let currentClient: unknown;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => currentClient,
}));

const envState: Record<string, string | undefined> = {};
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    DIGEST_SECRET: envState.DIGEST_SECRET,
    RESEND_API_KEY: envState.RESEND_API_KEY,
    APP_BASE_URL: envState.APP_BASE_URL,
    DIGEST_FROM_EMAIL: envState.DIGEST_FROM_EMAIL,
  }),
}));

import { runWeeklyDigest } from "@/lib/digest/run";

// ── chainable supabase fake ──────────────────────────────────────────────────
type Call = {
  table: string;
  op: "select" | "insert" | "update" | "rpc";
  values?: unknown;
  filters: [string, unknown][];
};
type Responder = (call: Call) => { data?: unknown; error?: unknown };

function makeClient(respond: Responder) {
  const calls: Call[] = [];
  function from(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const b: any = {
      select: () => b,
      insert: (v: unknown) => {
        call.op = "insert";
        call.values = v;
        return b;
      },
      update: (v: unknown) => {
        call.op = "update";
        call.values = v;
        return b;
      },
      eq: (k: string, v: unknown) => {
        call.filters.push([k, v]);
        return b;
      },
      in: (k: string, v: unknown) => {
        call.filters.push([k, v]);
        return b;
      },
      order: () => b,
      limit: () => b,
      single: () =>
        Promise.resolve({ data: null, error: null, ...respond(call) }),
      then: (res: any, rej: any) =>
        Promise.resolve({ data: null, error: null, ...respond(call) }).then(
          res,
          rej,
        ),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return b;
  }
  const rpc = async (name: string, args: unknown) => {
    const call: Call = {
      table: `rpc:${name}`,
      op: "rpc",
      values: args,
      filters: [],
    };
    calls.push(call);
    return { data: null, error: null, ...respond(call) };
  };
  return { client: { from, rpc }, calls };
}

const ORG = { id: "org-1", name: "Acme" };
const NONZERO_ROW = {
  board_id: "11111111-1111-4111-8111-111111111111",
  board_name: "Launch",
  total_items: 5,
  done_items: 1,
  overdue_items: 2,
  incomplete_items: 3,
  new_items: 1,
  new_sample: ["Kickoff"],
  incomplete_sample: ["Design"],
};

/** Baseline responder: one org, claim succeeds, digest rows configurable. */
function baseResponder(over: {
  orgs?: unknown[];
  claim?: Responder;
  digestRows?: unknown[];
  members?: unknown[];
  profiles?: unknown[];
  existing?: unknown;
  reclaim?: Responder;
  notifications?: Responder;
}): Responder {
  return (call) => {
    if (call.table === "organizations")
      return { data: over.orgs ?? [ORG], error: null };
    if (call.table === "digest_runs" && call.op === "insert")
      return over.claim
        ? over.claim(call)
        : { data: { id: "run-1" }, error: null };
    if (call.table === "digest_runs" && call.op === "select")
      return { data: over.existing ?? null, error: null };
    if (call.table === "digest_runs" && call.op === "update") {
      // reclaim update carries a status filter; finalize update does not need data
      const isReclaim = call.filters.some(([k]) => k === "status");
      if (isReclaim && over.reclaim) return over.reclaim(call);
      return { data: { id: "run-1" }, error: null };
    }
    if (call.table === "rpc:_org_health_digest")
      return { data: over.digestRows ?? [], error: null };
    if (call.table === "org_members")
      return { data: over.members ?? [], error: null };
    if (call.table === "profiles")
      return { data: over.profiles ?? [], error: null };
    if (call.table === "notifications" && call.op === "insert")
      return over.notifications ? over.notifications(call) : { error: null };
    return { data: null, error: null };
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  delete envState.DIGEST_SECRET;
  delete envState.RESEND_API_KEY;
  delete envState.APP_BASE_URL;
  delete envState.DIGEST_FROM_EMAIL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWeeklyDigest", () => {
  it("claims the week per org and skips already-claimed orgs", async () => {
    const { client, calls } = makeClient(
      baseResponder({
        orgs: [ORG, { id: "org-2", name: "Beta" }],
        claim: (call) =>
          (call.values as { org_id: string }).org_id === "org-2"
            ? { data: null, error: { code: "23505", message: "dup" } }
            : { data: { id: "run-1" }, error: null },
        existing: { id: "run-2", status: "sent", created_at: null },
        digestRows: [],
      }),
    );
    currentClient = client;

    const summary = await runWeeklyDigest(new Date("2026-07-01T12:00:00Z"));
    expect(summary.processed).toBe(1);
    // org-1's all-zero week + org-2's already-claimed week both count skipped.
    expect(summary.skipped).toBe(2);
    expect(summary.failed).toBe(0);
    // No notifications were inserted for either org.
    expect(
      calls.filter((c) => c.table === "notifications" && c.op === "insert"),
    ).toHaveLength(0);
    // The claim used the Monday of the containing week.
    const claim = calls.find(
      (c) => c.table === "digest_runs" && c.op === "insert",
    );
    expect(claim?.values).toMatchObject({ period_start: "2026-06-29" });
  });

  it("writes skipped and sends nothing when totals are all zero", async () => {
    const { client, calls } = makeClient(baseResponder({ digestRows: [] }));
    currentClient = client;

    const summary = await runWeeklyDigest();
    expect(summary).toMatchObject({ processed: 1, skipped: 1, sent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const finalize = calls.find(
      (c) => c.table === "digest_runs" && c.op === "update",
    );
    expect(finalize?.values).toMatchObject({ status: "skipped" });
    expect(
      calls.filter((c) => c.table === "notifications" && c.op === "insert"),
    ).toHaveLength(0);
  });

  it("email-disabled mode inserts notifications and finalizes sent", async () => {
    const { client, calls } = makeClient(
      baseResponder({
        digestRows: [NONZERO_ROW],
        members: [
          { user_id: "u1", role: "owner" },
          { user_id: "u2", role: "member" },
        ],
        profiles: [
          { id: "u1", email: "a@x.com", email_digest_opt_out: false },
          { id: "u2", email: "b@x.com", email_digest_opt_out: false },
        ],
      }),
    );
    currentClient = client;

    const summary = await runWeeklyDigest(new Date("2026-07-01T12:00:00Z"));
    expect(summary).toMatchObject({ processed: 1, sent: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    // Guests are excluded at the query boundary.
    const membersRead = calls.find((c) => c.table === "org_members");
    expect(membersRead?.filters).toContainEqual([
      "role",
      ["owner", "admin", "member"],
    ]);

    const notif = calls.find(
      (c) => c.table === "notifications" && c.op === "insert",
    );
    expect(notif?.values).toEqual([
      expect.objectContaining({
        org_id: "org-1",
        recipient_id: "u1",
        actor_id: null,
        kind: "health_digest",
        payload: {
          newCount: 1,
          incompleteCount: 3,
          overdueCount: 2,
          periodStart: "2026-06-29",
        },
      }),
      expect.objectContaining({ recipient_id: "u2" }),
    ]);

    const finalize = calls.find(
      (c) => c.table === "digest_runs" && c.op === "update",
    );
    expect(finalize?.values).toMatchObject({
      status: "sent",
      email_sent_count: 0,
    });
  });

  it("email mode sends per-recipient batch and honors opt-out", async () => {
    envState.DIGEST_SECRET = "s".repeat(32);
    envState.RESEND_API_KEY = "re_test";
    envState.APP_BASE_URL = "https://pulse.example.com";
    fetchMock.mockResolvedValue({ ok: true });

    const { client, calls } = makeClient(
      baseResponder({
        digestRows: [NONZERO_ROW],
        members: [
          { user_id: "u1", role: "owner" },
          { user_id: "u2", role: "member" },
          { user_id: "u3", role: "member" },
        ],
        profiles: [
          { id: "u1", email: "a@x.com", email_digest_opt_out: false },
          { id: "u2", email: "b@x.com", email_digest_opt_out: true },
          { id: "u3", email: null, email_digest_opt_out: false },
        ],
      }),
    );
    currentClient = client;

    const summary = await runWeeklyDigest(new Date("2026-07-01T12:00:00Z"));
    expect(summary).toMatchObject({ processed: 1, sent: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails/batch");
    const body = JSON.parse(init.body as string) as {
      to: string[];
      html: string;
      headers: Record<string, string>;
    }[];
    expect(body).toHaveLength(1);
    expect(body[0].to).toEqual(["a@x.com"]);
    const sig = unsubscribeSignature(envState.DIGEST_SECRET, "u1");
    expect(body[0].html).toContain(sig);
    expect(body[0].headers["List-Unsubscribe"]).toContain(sig);

    // Notifications still go to ALL members (opt-out is email-only).
    const notif = calls.find(
      (c) => c.table === "notifications" && c.op === "insert",
    );
    expect(notif?.values).toHaveLength(3);

    const finalize = calls.find(
      (c) => c.table === "digest_runs" && c.op === "update",
    );
    expect(finalize?.values).toMatchObject({
      status: "sent",
      email_sent_count: 1,
    });
  });

  it("resend failure finalizes failed and does NOT insert notifications", async () => {
    envState.DIGEST_SECRET = "s".repeat(32);
    envState.RESEND_API_KEY = "re_test";
    envState.APP_BASE_URL = "https://pulse.example.com";
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "provider down",
    });

    const { client, calls } = makeClient(
      baseResponder({
        digestRows: [NONZERO_ROW],
        members: [{ user_id: "u1", role: "owner" }],
        profiles: [{ id: "u1", email: "a@x.com", email_digest_opt_out: false }],
      }),
    );
    currentClient = client;

    const summary = await runWeeklyDigest();
    expect(summary).toMatchObject({ processed: 1, failed: 1, sent: 0 });
    expect(
      calls.filter((c) => c.table === "notifications" && c.op === "insert"),
    ).toHaveLength(0);
    const finalize = calls.find(
      (c) => c.table === "digest_runs" && c.op === "update",
    );
    expect(finalize?.values).toMatchObject({ status: "failed" });
    expect((finalize?.values as { error: string }).error).toMatch(
      /resend batch failed/,
    );
  });

  it("reclaims a stale pending run older than an hour", async () => {
    const now = new Date("2026-07-01T12:00:00Z");
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
    const { client, calls } = makeClient(
      baseResponder({
        claim: () => ({ data: null, error: { code: "23505", message: "dup" } }),
        existing: { id: "run-1", status: "pending", created_at: twoHoursAgo },
        reclaim: () => ({ data: { id: "run-1" }, error: null }),
        digestRows: [],
      }),
    );
    currentClient = client;

    const summary = await runWeeklyDigest(now);
    // Reclaimed and processed (all-zero week → skipped outcome).
    expect(summary).toMatchObject({ processed: 1, skipped: 1, failed: 0 });
    const reclaim = calls.find(
      (c) =>
        c.table === "digest_runs" &&
        c.op === "update" &&
        c.filters.some(([k, v]) => k === "status" && v === "pending"),
    );
    expect(reclaim).toBeTruthy();
    expect(reclaim?.filters).toContainEqual(["id", "run-1"]);
  });

  it("bounds the FIRST EVER run to the current period, not to everything since the feature shipped", async () => {
    // Regression guard for the prod incident: digest_runs was empty for three
    // weeks because digest_secret was never provisioned. When it is finally
    // provisioned, the first pass must ask for ONE period of activity — never a
    // window that widens with the age of the feature or of the org.
    const now = new Date("2026-07-27T07:00:00Z");
    const { client, calls } = makeClient(
      baseResponder({ existing: null, digestRows: [] }),
    );
    currentClient = client;

    await runWeeklyDigest(now);

    const rpc = calls.find((c) => c.table === "rpc:_org_health_digest");
    expect(rpc?.values).toEqual({
      p_org_id: "org-1",
      p_since: "2026-07-20T07:00:00.000Z",
    });
  });
});

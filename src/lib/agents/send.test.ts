import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserAgentRow } from "./agents-db";
import type { Briefing } from "./briefing";

const ORG = "00000000-0000-4000-8000-0000000000f1";
const OWNER = "00000000-0000-4000-8000-0000000000f2";
const AGENT_ID = "00000000-0000-4000-8000-0000000000aa";

// ── env: mutable per-test so "no RESEND_API_KEY" (production today) is
// covered alongside the fully-configured case. ─────────────────────────────
let env = {
  RESEND_API_KEY: "re_test" as string | null,
  DIGEST_SECRET: "a-secret-that-is-long-enough-1234",
  APP_BASE_URL: "https://app.example.com",
  DIGEST_FROM_EMAIL: null as string | null,
};
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => env,
}));

vi.mock("@/lib/digest/token", () => ({
  unsubscribeSignature: (_secret: string, uid: string) => `sig-${uid}`,
}));

const { renderHtmlMock, renderTextMock } = vi.hoisted(() => ({
  renderHtmlMock: vi.fn((_input: Record<string, unknown>) => "<p>html</p>"),
  renderTextMock: vi.fn((_input: Record<string, unknown>) => "text"),
}));
vi.mock("./briefing-render", () => ({
  renderBriefingHtml: renderHtmlMock,
  renderBriefingText: renderTextMock,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ── fake supabase client ────────────────────────────────────────────────
type InsertedRow = Record<string, unknown>;
let profileRow: {
  email: string | null;
  email_briefing_opt_out: boolean | null;
} | null;
let notifyError: { message: string } | null;
const notificationInserts: InsertedRow[] = [];

function fakeClient() {
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profileRow, error: null }),
            }),
          }),
        };
      }
      if (table === "notifications") {
        return {
          insert: async (row: InsertedRow) => {
            notificationInserts.push(row);
            return { error: notifyError };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const { sendBriefingEmail } = await import("./send");

const agent: UserAgentRow = {
  id: AGENT_ID,
  org_id: ORG,
  owner_id: OWNER,
  name: "Morning Brief",
  template_id: "morning-brief",
  instructions: "Be concise.",
  board_scope: { mode: "all" },
  cadence: "daily",
  run_at_local_hour: 7,
  run_on_weekday: null,
  run_on_day_of_month: null,
  enabled: true,
  capabilities: [],
  bridge_secret_id: null,
  provider: null,
  model_id: null,
};

const briefing: Briefing = {
  today: "2026-08-01",
  totals: { overdue: 1, today: 2, week: 3 },
  groups: [],
};

beforeEach(() => {
  env = {
    RESEND_API_KEY: "re_test",
    DIGEST_SECRET: "a-secret-that-is-long-enough-1234",
    APP_BASE_URL: "https://app.example.com",
    DIGEST_FROM_EMAIL: null,
  };
  profileRow = { email: "owner@example.com", email_briefing_opt_out: false };
  notifyError = null;
  notificationInserts.length = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
  renderHtmlMock.mockClear();
  renderTextMock.mockClear();
});

describe("sendBriefingEmail", () => {
  it("emails, then writes the notification AFTER the email succeeds", async () => {
    const calls: string[] = [];
    fetchMock.mockImplementation(async () => {
      calls.push("email");
      return { ok: true, text: async () => "" };
    });
    // A dedicated client (not fakeClient()) so the notification insert can
    // record ordering relative to the fetch call above.
    const svc = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: profileRow, error: null }),
              }),
            }),
          };
        }
        if (table === "notifications") {
          return {
            insert: async (row: InsertedRow) => {
              calls.push("notification");
              notificationInserts.push(row);
              return { error: notifyError };
            },
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await sendBriefingEmail(svc, {
      agent,
      briefing,
      summary: "You have 1 overdue item.",
    });

    expect(result).toEqual({ emailed: true });
    expect(calls).toEqual(["email", "notification"]);
  });

  it("writes the notification to `recipient_id` (not `user_id`) with kind 'agent_briefing'", async () => {
    const svc = fakeClient();
    await sendBriefingEmail(svc, { agent, briefing, summary: "sum" });

    expect(notificationInserts).toHaveLength(1);
    expect(notificationInserts[0]).toMatchObject({
      recipient_id: OWNER,
      org_id: ORG,
      actor_id: null,
      kind: "agent_briefing",
      payload: {
        agentName: agent.name,
        overdue: briefing.totals.overdue,
        today: briefing.totals.today,
        week: briefing.totals.week,
      },
    });
    expect(notificationInserts[0]).not.toHaveProperty("user_id");
  });

  it("still writes the notification when email is disabled (no RESEND_API_KEY) — production's only channel", async () => {
    env = { ...env, RESEND_API_KEY: null };
    const svc = fakeClient();

    const result = await sendBriefingEmail(svc, {
      agent,
      briefing,
      summary: "sum",
    });

    expect(result).toEqual({ emailed: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notificationInserts).toHaveLength(1);
  });

  it("still writes the notification when the owner opted out of the email (opt-out only gates the email)", async () => {
    profileRow = { email: "owner@example.com", email_briefing_opt_out: true };
    const svc = fakeClient();

    const result = await sendBriefingEmail(svc, {
      agent,
      briefing,
      summary: "sum",
    });

    expect(result).toEqual({ emailed: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notificationInserts).toHaveLength(1);
  });

  it("throws before writing a notification when the email send itself fails (no duplicate on retry)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    const svc = fakeClient();

    await expect(
      sendBriefingEmail(svc, { agent, briefing, summary: "sum" }),
    ).rejects.toThrow("resend failed");
    expect(notificationInserts).toHaveLength(0);
  });

  it("propagates a notification insert error", async () => {
    notifyError = { message: "insert boom" };
    const svc = fakeClient();

    await expect(
      sendBriefingEmail(svc, { agent, briefing, summary: "sum" }),
    ).rejects.toThrow("insert boom");
  });

  it("builds the thread deep link from APP_BASE_URL + the thread id only, when a thread id is given", async () => {
    const svc = fakeClient();

    const result = await sendBriefingEmail(svc, {
      agent,
      briefing,
      summary: "sum",
      threadId: "conv-123",
    });

    expect(result).toEqual({ emailed: true });
    expect(renderHtmlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadUrl: "https://app.example.com/ask/conv-123",
      }),
    );
    expect(renderTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadUrl: "https://app.example.com/ask/conv-123",
      }),
    );
  });

  it("sends the identical email minus the thread link when there is no thread id", async () => {
    const svc = fakeClient();

    const result = await sendBriefingEmail(svc, {
      agent,
      briefing,
      summary: "sum",
      threadId: null,
    });

    expect(result).toEqual({ emailed: true });
    const htmlArgs = renderHtmlMock.mock.calls[0][0] as Record<string, unknown>;
    const textArgs = renderTextMock.mock.calls[0][0] as Record<string, unknown>;
    expect(htmlArgs.threadUrl).toBeUndefined();
    expect(textArgs.threadUrl).toBeUndefined();
    // Everything else about the call is unchanged.
    expect(htmlArgs).toMatchObject({
      agentName: agent.name,
      briefing,
      appBaseUrl: "https://app.example.com",
      summary: "sum",
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";
import { signBody } from "@/lib/ai/agentic/hmac";
import {
  AiDisabledError,
  AiNotConfiguredError,
  PersonalAiKeyMissingError,
  ByoKeyMissingError,
} from "@/lib/ai/errors";

const SECRET = "test-secret";
const ORG = "00000000-0000-4000-8000-0000000000f1";
const OWNER = "00000000-0000-4000-8000-0000000000f2";

const getUserAgentById = vi.fn();
const findUserAgentRun = vi.fn();

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    AI_PGNET_HMAC_SECRET: SECRET,
    RESEND_API_KEY: null,
    DIGEST_SECRET: "d",
    APP_BASE_URL: "https://app.example.com",
    DIGEST_FROM_EMAIL: null,
  }),
}));

vi.mock("@/lib/agents/agents-db", () => ({
  getUserAgentById: (...a: unknown[]) => getUserAgentById(...a),
  findUserAgentRun: (...a: unknown[]) => findUserAgentRun(...a),
}));

// ── user_agent_runs mock ────────────────────────────────────────────────
// `claimRun`/`finalizeRun` in route.ts talk to `user_agent_runs` directly
// (insert for the claim, update for the finalize) rather than through
// agents-db.ts, so they need real insert/update semantics here — including a
// simulated 23505 unique-violation on the claim insert (Finding 1) and a
// simulated ordinary write failure on the finalize update (Finding 2).
type RunPatch = Record<string, unknown>;
const runInserts: RunPatch[] = [];
const runUpdates: { patch: RunPatch; key: RunPatch }[] = [];
let forceClaimConflict = false;
let forceFinalizeError = false;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table !== "user_agent_runs") return {};
      return {
        // claimRun (route.ts) chains `.insert(row).select("id").single()` to
        // get the claimed row's id back — mirror that shape here rather than
        // the old bare `await insert(row)`. On a simulated 23505 the insert
        // is never actually written, so runInserts stays untouched, matching
        // the "no-op via the claim backstop" test's `toHaveLength(0)`.
        insert: (row: RunPatch) => {
          if (!forceClaimConflict) runInserts.push(row);
          return {
            select: () => ({
              single: async () =>
                forceClaimConflict
                  ? {
                      data: null,
                      error: {
                        code: "23505",
                        message:
                          'duplicate key value violates unique constraint "user_agent_runs_slot_uniq"',
                      },
                    }
                  : { data: { id: "run-1" }, error: null },
            }),
          };
        },
        update(patch: RunPatch) {
          const key: RunPatch = {};
          // Thenable chain: each .eq() records a key column and returns the
          // same builder; awaiting the builder at any point (mirrors real
          // supabase-js query builders) resolves and records the update.
          const builder = {
            eq(col: string, val: unknown) {
              key[col] = val;
              return builder;
            },
            then(onFulfilled: (v: { error: unknown }) => unknown) {
              runUpdates.push({ patch, key: { ...key } });
              const result = forceFinalizeError
                ? { error: { message: "db blip" } }
                : { error: null };
              return Promise.resolve(result).then(onFulfilled);
            },
          };
          return builder;
        },
      };
    },
  }),
}));

const requireAiEntitlement = vi.fn(async () => {});
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...a: unknown[]) => requireAiEntitlement(...(a as [])),
}));

// Real AgentCapExceededError export is preserved (route.ts does `instanceof`
// on it); only the DB-hitting function is replaced.
const assertRunAllowedToday = vi.fn(async () => {});
vi.mock("@/lib/agents/caps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/caps")>();
  return {
    ...actual,
    assertRunAllowedToday: (...a: unknown[]) =>
      assertRunAllowedToday(...(a as [])),
  };
});

// ── owner-client mock ───────────────────────────────────────────────────
// `writeBriefingThread` writes through the OWNER client, so this double has to
// be chainable: `.insert(row).select("id").single()` for the conversation and a
// bare awaited `.insert(row)` for the message. Returning `{}` here — as this
// file used to — made every route test hit `owner.from is not a function`,
// which writeBriefingThread's own outer catch swallowed into a null threadId.
// The thread-write seam was therefore never exercised by the route, and nothing
// could assert that `sendBriefingEmail` receives the id.
type OwnerRow = Record<string, unknown>;
const ownerConversationInsert = vi.fn();
const ownerMessageInsert = vi.fn();
let forceThreadInsertError: { code?: string; message: string } | null = null;

function ownerClientDouble() {
  return {
    from(table: string) {
      if (table === "ai_conversations") {
        return {
          insert: (row: OwnerRow) => {
            ownerConversationInsert(row);
            return {
              select: () => ({
                single: async () =>
                  forceThreadInsertError
                    ? { data: null, error: forceThreadInsertError }
                    : { data: { id: "conv-1" }, error: null },
              }),
            };
          },
        };
      }
      return {
        insert: async (row: OwnerRow) => {
          ownerMessageInsert(row);
          return { error: null };
        },
      };
    },
  };
}

const getAgentOwnerClient = vi.fn(async () => ownerClientDouble() as never);
vi.mock("@/lib/agents/owner-client", () => ({
  getAgentOwnerClient: (...a: unknown[]) => getAgentOwnerClient(...(a as [])),
}));

const fakeBriefing = {
  today: "2026-08-01",
  totals: { overdue: 1, today: 0, week: 0 },
  groups: [],
};
const buildBriefing = vi.fn(async () => fakeBriefing);
vi.mock("@/lib/agents/briefing", () => ({
  buildBriefing: (...a: unknown[]) => buildBriefing(...(a as [])),
}));

const summariseBriefing = vi.fn(async () => ({
  summary: "You have 1 overdue item.",
  usage: { inputTokens: 5, outputTokens: 2 },
}));
vi.mock("@/lib/agents/summarise", () => ({
  summariseBriefing: (...a: unknown[]) => summariseBriefing(...(a as [])),
}));

const sendBriefingEmail = vi.fn(async () => ({ emailed: true }));
vi.mock("@/lib/agents/send", () => ({
  sendBriefingEmail: (...a: unknown[]) => sendBriefingEmail(...(a as [])),
}));

// runAi just runs the callback by default with an Anthropic PROVIDER (metering
// exercised in the gateway's own test). A vi.fn so individual tests can
// override it — e.g. to simulate the per_user "no key on file" path throwing
// AiNotConfiguredError, or a non-Anthropic provider to exercise the
// wrong-provider skip. The gate reads `provider`, not the adapter: the loop
// builds `new Anthropic()` itself, so the honest question is which provider's
// key was resolved.
type FakeResolved = {
  provider: string;
  apiKey: string;
  model: ReturnType<typeof fakeResolvedModel>;
};
const runAi = vi.fn(
  async (
    _args: unknown,
    fn: (r: FakeResolved) => Promise<{ result: unknown }>,
  ) =>
    (
      await fn({
        provider: "anthropic",
        apiKey: "k",
        model: fakeResolvedModel(),
      })
    ).result,
);
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...a: Parameters<typeof runAi>) => runAi(...a),
}));

const { POST } = await import("./route");

function post(body: object, sig?: string) {
  const raw = JSON.stringify(body);
  return new Request("https://x/api/ai/personal-agent", {
    method: "POST",
    body: raw,
    headers: { "x-pulse-signature": sig ?? signBody(raw, SECRET) },
  });
}

const AGENT_ID = "00000000-0000-4000-8000-0000000000aa";
const slot = {
  agent_id: AGENT_ID,
  fire_date: "2026-08-01",
  fire_hour: 7,
};

const enabledAgent = () => ({
  id: AGENT_ID,
  org_id: ORG,
  owner_id: OWNER,
  name: "Morning Brief",
  template_id: "morning-brief",
  instructions: "Be concise.",
  board_scope: { mode: "all" as const },
  cadence: "daily" as const,
  run_at_local_hour: 7,
  enabled: true,
  bridge_secret_id: null,
  // The per-agent model pin. Null on both = "use the org default", which is
  // every backfilled agent — the pinned case is exercised explicitly below.
  provider: null,
  model_id: null,
});

beforeEach(() => {
  getUserAgentById.mockReset();
  findUserAgentRun.mockReset();
  findUserAgentRun.mockResolvedValue(null);
  runInserts.length = 0;
  runUpdates.length = 0;
  forceClaimConflict = false;
  forceFinalizeError = false;
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
  assertRunAllowedToday.mockReset();
  assertRunAllowedToday.mockResolvedValue(undefined);
  getAgentOwnerClient.mockClear();
  ownerConversationInsert.mockReset();
  ownerMessageInsert.mockReset();
  forceThreadInsertError = null;
  buildBriefing.mockReset();
  buildBriefing.mockResolvedValue(fakeBriefing);
  summariseBriefing.mockReset();
  summariseBriefing.mockResolvedValue({
    summary: "You have 1 overdue item.",
    usage: { inputTokens: 5, outputTokens: 2 },
  });
  sendBriefingEmail.mockReset();
  sendBriefingEmail.mockResolvedValue({ emailed: true });
  runAi.mockReset();
  runAi.mockImplementation(
    async (
      _args: unknown,
      fn: (r: FakeResolved) => Promise<{ result: unknown }>,
    ) =>
      (
        await fn({
          provider: "anthropic",
          apiKey: "k",
          model: fakeResolvedModel(),
        })
      ).result,
  );
});

describe("POST /api/ai/personal-agent", () => {
  it("rejects an unsigned request", async () => {
    const res = await POST(post(slot, "deadbeef"));
    expect(res.status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const raw = JSON.stringify(slot);
    const req = new Request("https://x/api/ai/personal-agent", {
      method: "POST",
      body: JSON.stringify({ ...slot, fire_hour: 9 }),
      headers: { "x-pulse-signature": signBody(raw, SECRET) },
    });
    expect((await POST(req)).status).toBe(401);
  });

  it("400s on a malformed body", async () => {
    const res = await POST(post({ nope: true }));
    expect(res.status).toBe(400);
  });

  it("404s for an unknown agent", async () => {
    getUserAgentById.mockResolvedValue(null);
    expect((await POST(post(slot))).status).toBe(404);
  });

  it("skips a disabled agent without writing a run", async () => {
    getUserAgentById.mockResolvedValue({ id: slot.agent_id, enabled: false });
    const res = await POST(post(slot));
    expect(await res.json()).toMatchObject({ status: "skipped" });
    expect(runInserts).toHaveLength(0);
    expect(runUpdates).toHaveLength(0);
  });

  it("is a no-op when the fire slot already ran (sequential redelivery, fast path)", async () => {
    getUserAgentById.mockResolvedValue({ id: slot.agent_id, enabled: true });
    findUserAgentRun.mockResolvedValue({ id: "existing" });
    const res = await POST(post(slot));
    expect(await res.json()).toMatchObject({ status: "noop" });
    expect(runInserts).toHaveLength(0);
    expect(runUpdates).toHaveLength(0);
  });

  // ── Finding 1: claim-before-send is the real backstop ──────────────────
  it("claims the slot with an insert BEFORE any token spend or email, then finalizes as ran", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });

    // Exactly one insert (the claim) and one update (the finalize) — never
    // a second insert for the final status.
    expect(runInserts).toHaveLength(1);
    expect(runInserts[0]).toMatchObject({
      user_agent_id: AGENT_ID,
      fire_date: slot.fire_date,
      fire_hour: slot.fire_hour,
      status: "error", // conservative claim placeholder — see CLAIM_PLACEHOLDER
    });
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "ran",
      input_tokens: 5,
      output_tokens: 2,
    });
    expect(sendBriefingEmail).toHaveBeenCalledOnce();
  });

  // ── The per-agent model pin (user_agents.provider / .model_id) ─────────
  it("spends the PINNED provider's key and asks for the pinned model", async () => {
    // An agent pinned to Kimi must resolve the Kimi key. Resolving whichever
    // key the owner happens to have would POST an Anthropic key to Moonshot.
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      provider: "moonshotai",
      model_id: "kimi-k2",
    });
    await POST(post(slot));

    expect(runAi).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        userId: OWNER,
        feature: "personal_agent_run",
        provider: "moonshotai",
        requestedModel: "kimi-k2",
      }),
      expect.any(Function),
    );
  });

  it("leaves the pin OFF the gateway args when the agent has none", async () => {
    // Omitted, not null-with-a-value: an unpinned agent takes the org default,
    // and passing a provider of `null` would be a request for a provider named
    // null rather than "no preference".
    getUserAgentById.mockResolvedValue(enabledAgent());
    await POST(post(slot));

    expect(runAi.mock.calls[0]![0]).toMatchObject({ provider: undefined });
    expect(runAi.mock.calls[0]![0]).toMatchObject({ requestedModel: null });
  });

  it("records model_substituted when the pinned model was gone", async () => {
    // A substituted run still SUCCEEDED. It is recorded on its own column, not
    // overloaded onto `error`, so the owner is not told a working agent broke.
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      provider: "anthropic",
      model_id: "claude-retired-9",
    });
    runAi.mockImplementation(
      async (
        _args: unknown,
        fn: (r: FakeResolved) => Promise<{ result: unknown }>,
      ) =>
        (
          await fn({
            provider: "anthropic",
            apiKey: "k",
            model: fakeResolvedModel({ substituted: true }),
          })
        ).result,
    );
    const res = await POST(post(slot));

    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "ran",
      error: null,
      model_substituted: true,
    });
  });

  it("records model_substituted: false on an ordinary run", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    await POST(post(slot));
    expect(runUpdates[0]!.patch).toMatchObject({ model_substituted: false });
  });

  it("is a no-op via the claim backstop when a concurrent delivery races the fast probe", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    // Simulate the race: findUserAgentRun's fast probe still sees null (the
    // other delivery hasn't committed yet), but by the time THIS delivery
    // tries to claim, the other delivery has already won the unique index.
    forceClaimConflict = true;

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "noop" });
    // No token spend, no email — the loser does NOTHING beyond the failed claim.
    expect(summariseBriefing).not.toHaveBeenCalled();
    expect(sendBriefingEmail).not.toHaveBeenCalled();
    expect(runInserts).toHaveLength(0);
    expect(runUpdates).toHaveLength(0);
  });

  // ── the gated path also goes through claim + finalize ───────────────────
  it("claims the slot, then finalizes as skipped when entitlement is off (no spend)", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "skipped" });
    expect(runInserts).toHaveLength(1);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({ status: "skipped" });
    expect(summariseBriefing).not.toHaveBeenCalled();
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── Gap 1 / I1: a missing PER-USER AI key is a config state, not a fault ─
  it("finalizes as skipped (not error) when the owner has no AI key on file (per_user mode)", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    runAi.mockRejectedValue(new PersonalAiKeyMissingError());

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "skipped",
      reason: "no_key",
    });
    expect(runInserts).toHaveLength(1);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({ status: "skipped" });
    // Never emails/records a "ran" outcome off an unconfigured key.
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── M2: an org_byo org with no vault secret is the same kind of config
  //       state as a missing personal key — also skipped, not a 500. ──────
  it("finalizes as skipped (not error) when the org's org_byo key is missing", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    runAi.mockRejectedValue(new ByoKeyMissingError());

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "skipped",
      reason: "no_key",
    });
    expect(runUpdates[0]!.patch).toMatchObject({ status: "skipped" });
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── wrong-provider guard: the anthropic provider proceeds normally ─────
  it("proceeds through summarise + send when the resolved provider is anthropic", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    // Default mock already resolves { provider: "anthropic", apiKey }.

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(summariseBriefing).toHaveBeenCalledOnce();
    expect(sendBriefingEmail).toHaveBeenCalledOnce();
    expect(runUpdates[0]!.patch).toMatchObject({ status: "ran" });
  });

  // ── wrong-provider guard: a non-Anthropic per_user key must never be sent
  //    to api.anthropic.com. This is a CONFIGURATION state (skipped), not a
  //    fault — it must spend nothing and never call summarise or send. ──────
  it("finalizes as skipped (not error) when the resolved provider is not anthropic, and never calls the model or the send", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    // Drive the REAL callback route.ts passes to runAi (not a re-implemented
    // stand-in) with a non-anthropic provider — this exercises route.ts's own
    // assertToolLoopCapable() call, not just its catch block.
    runAi.mockImplementation(
      async (
        _args: unknown,
        fn: (r: FakeResolved) => Promise<{ result: unknown }>,
      ) =>
        (
          await fn({
            provider: "openai",
            apiKey: "k",
            model: fakeResolvedModel(),
          })
        ).result,
    );

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "skipped",
      reason: "wrong_provider",
    });
    expect(runInserts).toHaveLength(1);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({ status: "skipped" });
    expect(runUpdates[0]!.patch.error).toMatch(/Anthropic/);
    // Never spends: no model call, no email.
    expect(summariseBriefing).not.toHaveBeenCalled();
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── I1: a PLATFORM-wide AiNotConfiguredError (e.g. managed mode's
  //       ANTHROPIC_API_KEY missing) must NOT be silently skipped — nobody
  //       but ops can fix it, and a "skipped" row never pages anyone. ──────
  it("finalizes as ERROR (not skipped) on a platform-wide AiNotConfiguredError, distinct from the per-user/org_byo config states above", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    // Deliberately the base class, NOT PersonalAiKeyMissingError — this is
    // what gateway.ts's `managed` branch throws when ANTHROPIC_API_KEY is
    // absent, which is a distinct failure mode from a per-user missing key.
    runAi.mockRejectedValue(new AiNotConfiguredError());

    const res = await POST(post(slot));

    expect(res.status).toBe(500);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({ status: "error" });
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── I2: the seam between the thread write and the email ────────────────
  // briefing-thread.test.ts and send.test.ts each cover their own half; this is
  // the only place that proves the id crosses between them.
  it("writes the briefing thread through the owner client and hands its id to the email", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    expect(ownerConversationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG,
        user_id: OWNER,
        agent_id: AGENT_ID,
        // The run's id from the claim — the idempotency key that stops a
        // redelivered fire slot minting a second thread.
        run_id: "run-1",
        // A briefing spans every board its owner can see, so it belongs to none.
        board_id: null,
      }),
    );
    // The summary is the thread's first (assistant) turn.
    expect(ownerMessageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conv-1",
        role: "assistant",
        content: "You have 1 overdue item.",
      }),
    );
    expect(sendBriefingEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: "conv-1" }),
    );
    // Order matters: the email carries a link to the thread, so the thread has
    // to exist before it is sent.
    expect(ownerConversationInsert.mock.invocationCallOrder[0]).toBeLessThan(
      sendBriefingEmail.mock.invocationCallOrder[0]!,
    );
  });

  it("still emails — with no thread link — when the thread write fails", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    forceThreadInsertError = { message: "insert refused" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post(slot));

    // A nice-to-have write must never cost the owner their briefing.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(sendBriefingEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: null }),
    );
    expect(runUpdates[0]!.patch).toMatchObject({ status: "ran" });
    errSpy.mockRestore();
  });

  // ── error path still finalizes, and reports the real HTTP outcome ──────
  it("finalizes as error and 500s when the run throws after being claimed", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    buildBriefing.mockRejectedValue(new Error("rpc boom"));

    const res = await POST(post(slot));

    expect(res.status).toBe(500);
    expect(runInserts).toHaveLength(1);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "error",
      error: "rpc boom",
    });
  });

  // ── Finding 2: a finalize write failure must not crash the response ────
  it("still reports the real outcome when the finalize write itself fails after a successful send", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    forceFinalizeError = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post(slot));

    // The email genuinely sent — the response must say "ran", not crash
    // into an unhandled rejection or a 500, even though the bookkeeping
    // write that would have recorded it failed.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(sendBriefingEmail).toHaveBeenCalledOnce();
    // The failure was logged, not swallowed silently.
    expect(errSpy).toHaveBeenCalledWith(
      "[personal-agent] finalizeRun failed:",
      expect.objectContaining({ patchStatus: "ran" }),
    );
    errSpy.mockRestore();
  });

  it("still reports 'skipped' when both the gate AND its finalize write fail", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());
    forceFinalizeError = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "skipped" });
    errSpy.mockRestore();
  });
});

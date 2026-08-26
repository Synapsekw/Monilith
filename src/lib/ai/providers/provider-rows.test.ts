import { describe, expect, it } from "vitest";
import {
  listProviderVerification,
  recordProviderVerification,
  toProviderRow,
} from "@/lib/ai/providers/provider-rows";

describe("toProviderRow", () => {
  it("maps a native provider row and leaves baseUrl null", () => {
    expect(
      toProviderRow({
        id: "anthropic",
        label: "Anthropic (Claude)",
        adapter_kind: "anthropic",
        base_url: null,
        key_placeholder: "sk-ant-…",
        key_format: "^sk-ant-",
        enabled: true,
      }),
    ).toEqual({
      id: "anthropic",
      label: "Anthropic (Claude)",
      adapterKind: "anthropic",
      baseUrl: null,
      keyPlaceholder: "sk-ant-…",
      keyFormat: "^sk-ant-",
      enabled: true,
    });
  });

  it("carries base_url through for an openai-compatible provider", () => {
    const row = toProviderRow({
      id: "moonshotai",
      label: "Kimi (Moonshot AI)",
      adapter_kind: "openai-compatible",
      base_url: "https://api.moonshot.ai/v1",
      key_placeholder: "sk-…",
      key_format: "^sk-",
      enabled: true,
    });
    expect(row.adapterKind).toBe("openai-compatible");
    expect(row.baseUrl).toBe("https://api.moonshot.ai/v1");
  });

  it("rejects an unknown adapter_kind rather than widening it", () => {
    expect(() =>
      toProviderRow({
        id: "rogue",
        label: "Rogue",
        adapter_kind: "telepathy",
        base_url: null,
        key_placeholder: "x",
        key_format: "^x",
        enabled: true,
      }),
    ).toThrow(/adapter_kind/);
  });
});

// ---------------------------------------------------------------------------
// Sweep health: the record of whether the daily model-id probe is working.
// ---------------------------------------------------------------------------

/**
 * `ai_providers` as a tiny in-memory table, ARGUMENT-AWARE for the same reason
 * `src/test/ai-models-fake-client.ts` is: the whole value of these writes is
 * WHICH row and WHICH columns they touch. A fake that swallowed `.eq("id", …)`
 * would pass a write that stamped every provider's health onto every row.
 */
function fakeProvidersClient(
  rows: Record<string, unknown>[],
  opts: { failWrites?: string } = {},
) {
  const table = rows.map((r) => ({ ...r }));
  const updates: { patch: Record<string, unknown>; id: string | null }[] = [];

  const client = {
    from(name: string) {
      if (name !== "ai_providers")
        throw new Error(`unexpected table "${name}"`);
      return {
        select: (_cols: string) =>
          Promise.resolve({ data: table, error: null }),
        update(patch: Record<string, unknown>) {
          let id: string | null = null;
          return {
            eq(_col: string, val: string) {
              id = val;
              updates.push({ patch: { ...patch }, id });
              if (opts.failWrites)
                return Promise.resolve({
                  error: { message: opts.failWrites },
                });
              const row = table.find((r) => r.id === val);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as never, table, updates };
}

const NOW = "2026-08-26T10:00:00.000Z";

describe("recordProviderVerification", () => {
  it("moves last_verified_at only on a successful probe", async () => {
    const { client, table, updates } = fakeProvidersClient([
      { id: "mistral", last_verified_at: null },
    ]);
    await recordProviderVerification(
      client,
      "mistral",
      { status: "ok", error: null },
      NOW,
    );
    expect(updates).toEqual([
      {
        id: "mistral",
        patch: {
          last_verified_at: NOW,
          last_verify_attempt_at: NOW,
          last_verify_status: "ok",
          last_verify_error: null,
        },
      },
    ]);
    expect(table[0].last_verified_at).toBe(NOW);
  });

  /**
   * The load-bearing asymmetry, and the reason this is four columns rather
   * than two. A failed run must advance the ATTEMPT stamp and leave the
   * SUCCESS stamp alone — that difference is the entire "last verified 7 days
   * ago, failing since" sentence the badge renders. Stamp both and every
   * failing provider reads as freshly verified.
   */
  it("leaves last_verified_at untouched on a failure, but advances the attempt stamp", async () => {
    const { client, table, updates } = fakeProvidersClient([
      { id: "mistral", last_verified_at: "2026-08-19T10:00:00.000Z" },
    ]);
    await recordProviderVerification(
      client,
      "mistral",
      { status: "failed", error: "mistral model list returned HTTP 401" },
      NOW,
    );
    expect(updates[0].patch).not.toHaveProperty("last_verified_at");
    expect(updates[0].patch).toEqual({
      last_verify_attempt_at: NOW,
      last_verify_status: "failed",
      last_verify_error: "mistral model list returned HTTP 401",
    });
    expect(table[0].last_verified_at).toBe("2026-08-19T10:00:00.000Z");
  });

  it("records a skipped run the same way — attempted, never verified", async () => {
    const { client, updates } = fakeProvidersClient([
      { id: "mistral", last_verified_at: null },
    ]);
    await recordProviderVerification(
      client,
      "mistral",
      { status: "skipped", error: "no key available" },
      NOW,
    );
    expect(updates[0].patch).not.toHaveProperty("last_verified_at");
    expect(updates[0].patch.last_verify_status).toBe("skipped");
  });

  it("truncates a pathological reason rather than storing it whole", async () => {
    const { client, updates } = fakeProvidersClient([{ id: "mistral" }]);
    await recordProviderVerification(
      client,
      "mistral",
      { status: "failed", error: "x".repeat(5000) },
      NOW,
    );
    expect(
      (updates[0].patch.last_verify_error as string).length,
    ).toBeLessThanOrEqual(300);
  });

  /**
   * Health telemetry may never become a new way for the sweep to die. The
   * sweep's own contract is that one provider's failure is stepped over —
   * a write that rejected inside the catch block would turn a recorded
   * failure into an unhandled rejection, which is strictly worse than the
   * silence this feature set out to fix.
   */
  it("swallows a write failure instead of throwing into the sweep", async () => {
    const { client } = fakeProvidersClient([{ id: "mistral" }], {
      failWrites: "permission denied",
    });
    await expect(
      recordProviderVerification(
        client,
        "mistral",
        { status: "ok", error: null },
        NOW,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("listProviderVerification", () => {
  it("keys the health of every provider by id", async () => {
    const { client } = fakeProvidersClient([
      {
        id: "anthropic",
        last_verified_at: NOW,
        last_verify_attempt_at: NOW,
        last_verify_status: "ok",
        last_verify_error: null,
      },
      {
        id: "mistral",
        last_verified_at: null,
        last_verify_attempt_at: NOW,
        last_verify_status: "failed",
        last_verify_error: "HTTP 401",
      },
    ]);
    await expect(listProviderVerification(client)).resolves.toEqual({
      anthropic: {
        lastVerifiedAt: NOW,
        lastAttemptAt: NOW,
        status: "ok",
        error: null,
      },
      mistral: {
        lastVerifiedAt: null,
        lastAttemptAt: NOW,
        status: "failed",
        error: "HTTP 401",
      },
    });
  });

  /**
   * The five seeded rows predate this column set, so `null` is the normal
   * state right after the migration — "never checked", not "broken".
   */
  it("reports a provider the sweep has never touched as an all-null record", async () => {
    const { client } = fakeProvidersClient([
      {
        id: "moonshotai",
        last_verified_at: null,
        last_verify_attempt_at: null,
        last_verify_status: null,
        last_verify_error: null,
      },
    ]);
    await expect(listProviderVerification(client)).resolves.toEqual({
      moonshotai: {
        lastVerifiedAt: null,
        lastAttemptAt: null,
        status: null,
        error: null,
      },
    });
  });

  /** A status the code does not know must not be smuggled through as if it
   *  were one of the three — the badge switches on it. */
  it("narrows an unrecognised status to null rather than trusting it", async () => {
    const { client } = fakeProvidersClient([
      {
        id: "rogue",
        last_verified_at: null,
        last_verify_attempt_at: NOW,
        last_verify_status: "exploded",
        last_verify_error: null,
      },
    ]);
    const map = await listProviderVerification(client);
    expect(map.rogue.status).toBeNull();
  });
});

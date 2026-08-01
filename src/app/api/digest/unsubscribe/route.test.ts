import { beforeEach, describe, expect, it, vi } from "vitest";
import { unsubscribeSignature } from "@/lib/digest/token";

const SECRET = "d".repeat(32);
const UID = "00000000-0000-4000-8000-0000000000f2";

// `connection()` throws outside a real Next request scope (Cache Components) —
// a direct GET() call in a unit test can never satisfy that, so it's stubbed
// to a no-op, mirroring src/app/api/ask/route.test.ts's `after` stub.
vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual, connection: async () => {} };
});

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ DIGEST_SECRET: SECRET }),
}));

const update = vi.fn(async () => ({
  error: null as { message: string } | null,
}));
const eq = vi.fn((_col: string, _val: string) => update());
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          updatePatch = patch;
          return eq(col, val);
        },
      }),
    }),
  }),
}));

let updatePatch: Record<string, unknown> | undefined;

const { GET } = await import("./route");

function req(params: Record<string, string>) {
  const url = new URL("https://x/api/digest/unsubscribe");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

beforeEach(() => {
  update.mockReset();
  update.mockResolvedValue({ error: null });
  eq.mockClear();
  updatePatch = undefined;
});

describe("GET /api/digest/unsubscribe", () => {
  it("kind=briefing sets email_briefing_opt_out and leaves email_digest_opt_out untouched", async () => {
    const sig = unsubscribeSignature(SECRET, UID);
    const res = await GET(req({ uid: UID, sig, kind: "briefing" }));

    expect(res.status).toBe(200);
    expect(updatePatch).toEqual({ email_briefing_opt_out: true });
    expect(updatePatch).not.toHaveProperty("email_digest_opt_out");
  });

  it("no kind (existing digest links) sets email_digest_opt_out and leaves email_briefing_opt_out untouched", async () => {
    const sig = unsubscribeSignature(SECRET, UID);
    const res = await GET(req({ uid: UID, sig }));

    expect(res.status).toBe(200);
    expect(updatePatch).toEqual({ email_digest_opt_out: true });
    expect(updatePatch).not.toHaveProperty("email_briefing_opt_out");
  });

  it("an unrecognised kind falls back to the weekly digest preference", async () => {
    const sig = unsubscribeSignature(SECRET, UID);
    const res = await GET(req({ uid: UID, sig, kind: "something-else" }));

    expect(res.status).toBe(200);
    expect(updatePatch).toEqual({ email_digest_opt_out: true });
  });

  it("400s on an invalid signature with no DB write, regardless of kind", async () => {
    const res = await GET(req({ uid: UID, sig: "bad", kind: "briefing" }));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

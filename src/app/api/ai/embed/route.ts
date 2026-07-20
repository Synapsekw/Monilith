import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { embedBatch, embedBackfill } from "@/lib/ai/embeddings/index-actions";

// Runs on the default Node.js runtime (Cache Components forbids an explicit
// `runtime` export). The service client + node:crypto HMAC need Node APIs.

// The in-DB `embed-sweep` cron signs each body with the shared secret it reads
// from Vault (`ai_pgnet_hmac_secret`); we verify the SAME secret here. This HMAC
// is the ONLY thing standing between an attacker and a service-role embed write,
// so an unsigned/tampered body is rejected before any DB or model work.
const SIGNATURE_HEADER = "x-pulse-signature";

const sweepSchema = z.object({
  mode: z.literal("sweep"),
  batch: z.array(z.string().uuid()).max(200),
});
const backfillSchema = z.object({
  mode: z.literal("backfill"),
  cursor: z.string().uuid().nullish(),
  limit: z.number().int().positive().max(200).optional(),
});
const bodySchema = z.union([sweepSchema, backfillSchema]);

/**
 * F15 embedding pipeline endpoint (spec §4.4). Two modes:
 *   - `sweep`    — `{ batch: [item_id…] }` from the `embed-sweep` cron.
 *   - `backfill` — `?mode=backfill` (resumable, paged) for a one-time index of
 *                  existing items; idempotent (skips items already current).
 * Service-role, HMAC-verified. All model work + metering happens in embedBatch;
 * `userId: null` attributes this system (cron) usage to no user.
 */
export async function POST(req: Request) {
  const secret = getServerEnv().AI_PGNET_HMAC_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "embed pipeline not provisioned" },
      { status: 503 },
    );

  const raw = await req.text();
  const sig = req.headers.get(SIGNATURE_HEADER) ?? "";
  if (!verifyBody(raw, sig, secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // `?mode=backfill` selects the mode when the (signed) body omits it.
  const queryMode = new URL(req.url).searchParams.get("mode");
  const payload =
    json &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    !("mode" in json)
      ? { ...(json as Record<string, unknown>), mode: queryMode }
      : json;

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success)
    return NextResponse.json({ error: "invalid request" }, { status: 400 });

  if (parsed.data.mode === "sweep") {
    const result = await embedBatch(parsed.data.batch, { userId: null });
    return NextResponse.json({ mode: "sweep", ...result });
  }
  const result = await embedBackfill(
    { cursor: parsed.data.cursor ?? null, limit: parsed.data.limit },
    { userId: null },
  );
  return NextResponse.json({ mode: "backfill", ...result });
}

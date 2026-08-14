import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { verifyFreshSignedBody } from "@/lib/ai/agentic/hmac";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchGatewayFeed, refreshCatalog } from "@/lib/ai/models/refresh";

// Runs on the default Node.js runtime (Cache Components forbids an explicit
// `runtime` export). The service client + node:crypto HMAC need Node APIs.
//
// The in-DB `ai-models-refresh` cron signs its body with the shared Vault
// secret; we verify the SAME secret here. This HMAC is the only thing between
// an attacker and a service-role write to the catalog that prices every AI
// call in the product — an unsigned body is rejected before any work.
//
// The signed body also carries `ts` + `nonce` (see verifyFreshSignedBody): the
// cron used to sign a CONSTANT `{"mode":"refresh"}`, so its signature was
// constant too and one captured request replayed forever — and a refresh now
// re-verifies model ids using a borrowed user credential, so each replay spends
// a real user's key. The freshness check bounds that to a five-minute window.
const SIGNATURE_HEADER = "x-pulse-signature";

export async function POST(req: Request) {
  const secret = getServerEnv().AI_PGNET_HMAC_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "model refresh not provisioned" },
      { status: 503 },
    );

  const raw = await req.text();
  const sig = req.headers.get(SIGNATURE_HEADER) ?? "";
  const verified = verifyFreshSignedBody(raw, sig, secret);
  if (!verified.ok) {
    // Rejections MUST be observable: if the signer and this verifier ever fall
    // out of step the only other symptom is a silently stale model catalog,
    // which nobody notices for weeks. `reason` distinguishes "someone poked the
    // endpoint" (bad_signature) from "our own cron is being refused"
    // (missing_timestamp / stale) — the second is an incident, the first noise.
    // Never log the secret, the signature, or the body itself.
    console.warn("[ai/models/refresh] rejected signed body:", {
      reason: verified.reason,
      ageSeconds: verified.ageSeconds,
    });
    // One status for every reason — no oracle that tells a caller which check
    // it failed.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await refreshCatalog({
    fetchFeed: fetchGatewayFeed,
    client: createServiceClient(),
  });
  return NextResponse.json(result);
}

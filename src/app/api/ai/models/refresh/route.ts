import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchGatewayFeed, refreshCatalog } from "@/lib/ai/models/refresh";

// Runs on the default Node.js runtime (Cache Components forbids an explicit
// `runtime` export). The service client + node:crypto HMAC need Node APIs.
//
// The in-DB `ai-models-refresh` cron signs its body with the shared Vault
// secret; we verify the SAME secret here. This HMAC is the only thing between
// an attacker and a service-role write to the catalog that prices every AI
// call in the product — an unsigned body is rejected before any work.
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
  if (!verifyBody(raw, sig, secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await refreshCatalog({
    fetchFeed: fetchGatewayFeed,
    client: createServiceClient(),
  });
  return NextResponse.json(result);
}

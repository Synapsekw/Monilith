"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getAdapter } from "@/lib/ai/providers/registry";
import {
  getProviderRow,
  recordProviderVerification,
} from "@/lib/ai/providers/provider-rows";
import { ProviderAuthError } from "@/lib/ai/providers/types";
import { maskKey } from "@/lib/ai/credentials";
import { verifyProviderModels } from "@/lib/ai/models/verify-ids";
import { fail, type ActionResult } from "@/lib/actions/result";

// The provider is validated against the ai_providers table, not a hardcoded
// enum — that table is the constraint now, so a provider added by a DB row is
// immediately usable here with no code change.
const saveSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  key: z.string().trim().min(10).max(300),
});

export async function saveAiKey(input: {
  provider: string;
  key: string;
}): Promise<ActionResult<{ provider: string; hint: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid API key.");
  const { provider, key } = parsed.data;

  const user = await requireUser();
  const svc = createServiceClient();
  const row = await getProviderRow(svc, provider);
  if (!row || !row.enabled) return fail("Unknown provider.");

  // Cheap shape check from the row's regex, before the live network ping.
  if (!new RegExp(row.keyFormat).test(key))
    return fail(`That doesn't look like a ${row.label} key.`);

  // Saving a key is a LIVE probe of this provider, and its result used to be
  // computed and thrown away — which is why a key verified ten seconds ago
  // still read "Never checked" in Settings → AI until the nightly sweep ran.
  //
  // SUCCESS ONLY, and the asymmetry is deliberate — do not "fix" it by adding
  // the failure branch back. `ai_providers` is a PLATFORM-WIDE vendor registry
  // with no tenant column, so whatever is written here is visible to every
  // authenticated user in every org. A success is a true positive at that
  // scope: the provider really is reachable and this key really is accepted. A
  // failure is not. One person pasting a revoked or mistyped key would flip a
  // global badge to `failed` for every other tenant until the nightly sweep
  // overwrote it — one tenant's bad credential rendered as a vendor outage.
  // `verifyAllProviders` (models/refresh.ts), which probes under our own
  // platform key or a consenting user's, stays the sole authority on failures.
  // Nothing is lost for the person who typed the key: they still learn it was
  // rejected, from the error returned right here.
  //
  // Success is read off THROW-vs-RESOLVE, never off a return value.
  // `validateKey` returns `void` and signals failure by throwing, so the two
  // cases are genuinely distinguishable — the check gotcha-95 requires before
  // any health indicator is derived from an existing function. (Contrast
  // `verifyProviderModels`, which fails closed and is deliberately NOT the
  // source here.)
  const adapter = getAdapter(row.adapterKind);
  try {
    await adapter.validateKey({ apiKey: key, baseUrl: row.baseUrl });
  } catch (e) {
    if (e instanceof ProviderAuthError)
      return fail(`That key was rejected by ${row.label}.`);
    return fail("Couldn't verify the key. Please try again.");
  }

  // Health telemetry must never become a new way for "Save key" to fail.
  // `recordProviderVerification` already swallows its own write errors as a
  // documented contract; this catch covers it (or a future replacement)
  // throwing anyway — the same belt-and-braces the sweep applies around its
  // injected recorder in models/refresh.ts.
  //
  // `error` is null by construction. Any reason string this layer ever writes
  // must be AUTHORED here, never lifted off a thrown error: the column is read
  // by every authenticated user, and a raw SDK/transport message can carry the
  // request URL — which for Google carries the key in its query string.
  try {
    await recordProviderVerification(svc, provider, {
      status: "ok",
      error: null,
    });
  } catch (e) {
    console.error(
      `[ai] could not record save-time health for "${provider}"`,
      e,
    );
  }

  const hint = maskKey(key);
  const { error } = await svc.rpc("ai_credential_set", {
    p_user: user.id,
    p_provider: provider,
    p_secret: key,
    p_hint: hint,
  });
  if (error) return fail("Couldn't save the key. Please try again.");

  // This key is the only thing that can ask THIS provider which model ids it
  // actually answers to — the catalog is populated from the Gateway, whose id
  // namespace is not the providers'. Saving a key is therefore also the moment
  // this provider's catalog rows become selectable.
  //
  // It is NOT on the response path. Verification is a live round-trip to a
  // third party we do not control; awaiting it made "Save key" as slow as the
  // slowest provider, and a provider that accepts the connection and then
  // stalls would hold the user's action open. `after` hands it to the
  // platform's keep-alive (on Vercel, waitUntil) so the save returns as soon
  // as the key is stored. Never allowed to fail the save either: the key is
  // valid regardless, and an unverified row is simply not offered until the
  // next pass.
  const verifyIds = async () => {
    try {
      await verifyProviderModels({ client: svc, provider, apiKey: key });
    } catch (e) {
      console.error(
        `[ai] id verification failed after saving ${provider} key`,
        e,
      );
    }
  };
  try {
    after(verifyIds);
  } catch {
    // No request scope — a direct call in a unit test. Still run it, detached.
    void verifyIds();
  }

  revalidatePath("/settings/ai");
  return { ok: true, data: { provider, hint } };
}

export async function removeAiKey(input: {
  provider: string;
}): Promise<ActionResult<Record<never, never>>> {
  const parsed = z
    .object({ provider: z.string().trim().min(1).max(64) })
    .safeParse(input);
  if (!parsed.success) return fail("Unknown provider.");
  const user = await requireUser();
  const svc = createServiceClient();
  // Deletes ONLY this provider's key; other providers' keys survive.
  const { error } = await svc.rpc("ai_credential_delete", {
    p_user: user.id,
    p_provider: parsed.data.provider,
  });
  if (error) return fail("Couldn't remove the key. Please try again.");
  revalidatePath("/settings/ai");
  return { ok: true, data: {} };
}

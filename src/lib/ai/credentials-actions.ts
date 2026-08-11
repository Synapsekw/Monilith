"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getAdapter } from "@/lib/ai/providers/registry";
import { getProviderRow } from "@/lib/ai/providers/provider-rows";
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

  const adapter = getAdapter(row.adapterKind);
  try {
    await adapter.validateKey({ apiKey: key, baseUrl: row.baseUrl });
  } catch (e) {
    if (e instanceof ProviderAuthError)
      return fail(`That key was rejected by ${row.label}.`);
    return fail("Couldn't verify the key. Please try again.");
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
  // Never allowed to fail the save: the key is valid regardless, and an
  // unverified row is simply not offered until the next pass.
  try {
    await verifyProviderModels({ client: svc, provider, apiKey: key });
  } catch (e) {
    console.error(
      `[ai] id verification failed after saving ${provider} key`,
      e,
    );
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

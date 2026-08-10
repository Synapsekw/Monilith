"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getAdapterForProviderId } from "@/lib/ai/providers/registry";
import { ProviderAuthError } from "@/lib/ai/providers/types";
import { maskKey } from "@/lib/ai/credentials";
import { PROVIDER_CATALOG, type AiProvider } from "@/lib/ai/providers/catalog";
import { fail, type ActionResult } from "@/lib/actions/result";

const saveSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  key: z.string().trim().min(10).max(300),
});

export async function saveAiKey(input: {
  provider: AiProvider;
  key: string;
}): Promise<ActionResult<{ provider: AiProvider; hint: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid API key.");
  const { provider, key } = parsed.data;

  const user = await requireUser();
  const adapter = getAdapterForProviderId(provider);

  // Cheap pre-flight shape check before the live ping. The regex mirrors
  // `ai_providers.key_format`; Task 5 reads it from the row instead. It lives
  // per-PROVIDER, never on the adapter — one adapter serves several providers
  // whose keys look nothing alike.
  if (!new RegExp(PROVIDER_CATALOG[provider].keyFormat).test(key))
    return fail(
      `That doesn't look like a ${PROVIDER_CATALOG[provider].label} key.`,
    );

  try {
    await adapter.validateKey({ apiKey: key, baseUrl: null });
  } catch (e) {
    if (e instanceof ProviderAuthError)
      return fail(
        `That key was rejected by ${PROVIDER_CATALOG[provider].label}.`,
      );
    return fail("Couldn't verify the key. Please try again.");
  }

  const hint = maskKey(key);
  const svc = createServiceClient();
  const { error } = await svc.rpc("ai_credential_set", {
    p_user: user.id,
    p_provider: provider,
    p_secret: key,
    p_hint: hint,
  });
  if (error) return fail("Couldn't save the key. Please try again.");

  revalidatePath("/settings");
  return { ok: true, data: { provider, hint } };
}

export async function removeAiKey(): Promise<
  ActionResult<Record<never, never>>
> {
  const user = await requireUser();
  const svc = createServiceClient();
  const { error } = await svc.rpc("ai_credential_clear", { p_user: user.id });
  if (error) return fail("Couldn't remove the key. Please try again.");
  revalidatePath("/settings");
  return { ok: true, data: {} };
}

"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/ai/providers/registry";
import { ProviderAuthError } from "@/lib/ai/providers/types";
import { maskKey } from "@/lib/ai/credentials";
import { readOrgAiSettings, type AiMode } from "@/lib/ai/org-settings";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { type AiProvider } from "@/lib/ai/providers/catalog";
import { fail, type ActionResult } from "@/lib/actions/result";

const NOT_ADMIN = "Only organization admins can change AI settings.";

/**
 * Resolves the caller's active org after asserting they are an owner/admin.
 * The admin check runs through the RLS client (`has_org_role`); all subsequent
 * writes go through the SERVICE client — there is no client-side write path to
 * `org_ai_settings`. Returns null when there is no org or the caller isn't an admin.
 */
async function requireOrgAdmin(): Promise<{
  userId: string;
  orgId: string;
} | null> {
  const user = await requireUser();
  const orgs = await getUserOrgs();
  const org = orgs[0];
  if (!org) return null;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("has_org_role", {
    p_org_id: org.id,
    p_roles: ["owner", "admin"],
  });
  return allowed ? { userId: user.id, orgId: org.id } : null;
}

/** Member read for the settings page: current mode + entitlement + BYO key preview. */
export async function getOrgAiSettings(): Promise<
  ActionResult<{
    mode: AiMode;
    tier: string;
    creditsLimit: number;
    creditsUsed: number;
    byoProvider: AiProvider | null;
    byoKeyLast4: string | null;
  }>
> {
  await requireUser();
  const orgs = await getUserOrgs();
  const org = orgs[0];
  if (!org) return fail("No organization.");

  const supabase = await createClient();
  const settings = await readOrgAiSettings(supabase, org.id);
  const entitlement = await getAiEntitlement(org.id);

  return {
    ok: true,
    data: {
      mode: settings.mode,
      tier: settings.tier,
      creditsLimit: settings.monthlyCreditLimit,
      creditsUsed: entitlement.creditsUsed,
      byoProvider: settings.byoProvider,
      byoKeyLast4: settings.byoKeyLast4,
    },
  };
}

const modeSchema = z.object({
  mode: z.enum(["off", "managed", "org_byo", "per_user"]),
});

export async function setAiMode(input: {
  mode: AiMode;
}): Promise<ActionResult<{ mode: AiMode }>> {
  const parsed = modeSchema.safeParse(input);
  if (!parsed.success)
    return fail("Couldn't update the AI mode. Please try again.");
  const { mode } = parsed.data;

  const ctx = await requireOrgAdmin();
  if (!ctx) return fail(NOT_ADMIN);

  const svc = createServiceClient();

  if (mode === "org_byo") {
    const current = await readOrgAiSettings(svc, ctx.orgId);
    if (current.byoKeyLast4 === null)
      return fail("Add an organization key before switching to it.");
  }

  const { error } = await svc
    .from("org_ai_settings")
    .upsert(
      { org_id: ctx.orgId, ai_mode: mode, updated_by: ctx.userId },
      { onConflict: "org_id" },
    );
  if (error) return fail("Couldn't update the AI mode. Please try again.");

  revalidatePath("/settings");
  return { ok: true, data: { mode } };
}

const keySchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  key: z.string().trim().min(10).max(300),
});

export async function setOrgByoKey(input: {
  provider: AiProvider;
  key: string;
}): Promise<ActionResult<{ provider: AiProvider; hint: string }>> {
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid API key.");
  const { provider, key } = parsed.data;

  const ctx = await requireOrgAdmin();
  if (!ctx) return fail(NOT_ADMIN);

  const adapter = getAdapter(provider);

  if (!adapter.keyFormat.safeParse(key).success)
    return fail(`That doesn't look like a ${adapter.label} key.`);

  try {
    await adapter.validateKey(key);
  } catch (e) {
    if (e instanceof ProviderAuthError)
      return fail(`That key was rejected by ${adapter.label}.`);
    return fail("Couldn't verify the key. Please try again.");
  }

  const hint = maskKey(key);
  const svc = createServiceClient();
  const { error } = await svc.rpc("org_ai_secret_set", {
    p_org: ctx.orgId,
    p_provider: provider,
    p_secret: key,
    p_hint: hint,
  });
  if (error) return fail("Couldn't save the key. Please try again.");

  revalidatePath("/settings");
  return { ok: true, data: { provider, hint } };
}

export async function removeOrgByoKey(): Promise<
  ActionResult<Record<never, never>>
> {
  const ctx = await requireOrgAdmin();
  if (!ctx) return fail(NOT_ADMIN);

  const svc = createServiceClient();
  const { error } = await svc.rpc("org_ai_secret_clear", { p_org: ctx.orgId });
  if (error) return fail("Couldn't remove the key. Please try again.");

  revalidatePath("/settings");
  return { ok: true, data: {} };
}

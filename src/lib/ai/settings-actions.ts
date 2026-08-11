"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/ai/providers/registry";
import { getProviderRow } from "@/lib/ai/providers/provider-rows";
import { getModel } from "@/lib/ai/models/catalog-db";
import { verifyProviderModels } from "@/lib/ai/models/verify-ids";
import { ProviderAuthError } from "@/lib/ai/providers/types";
import { maskKey } from "@/lib/ai/credentials";
import { readOrgAiSettings, type AiMode } from "@/lib/ai/org-settings";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import type { AiProvider } from "@/lib/ai/providers/catalog";
import { fail, type ActionResult } from "@/lib/actions/result";
import { readOrgBillingStatus } from "@/lib/billing/status";
import { entitlesAi } from "@/lib/billing/entitling";

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
  const org = await resolveActiveOrg();
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
    /** The org-wide default, as a provider + CATALOG key pair. */
    defaultProvider: string | null;
    defaultModelId: string | null;
  }>
> {
  await requireUser();
  const org = await resolveActiveOrg();
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
      defaultProvider: settings.defaultProvider,
      defaultModelId: settings.defaultModelId,
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

  // `managed` spends OUR platform key, so it is derived from the subscription,
  // not chosen by the customer. Without this, an org that downgraded (the
  // webhook sets ai_mode 'off') could re-select "Managed" here and resume
  // spending against its previous credit pool — free AI, metered to us.
  if (mode === "managed") {
    const billing = await readOrgBillingStatus(ctx.orgId);
    if (!entitlesAi(billing.status))
      return fail("Managed AI needs an active Pulse subscription.");
  }

  // Turning AI off must also disarm the ceiling. Leaving a non-zero
  // monthly_credit_limit behind a disabled mode means any future path that
  // re-enables managed resumes against the old pool. The unmetered modes
  // (org_byo, per_user) cost us nothing, so their ceiling is irrelevant and is
  // left untouched — zeroing it would silently destroy an Enterprise org's
  // negotiated allowance on a temporary toggle.
  // One object shape with a conditional key, not a ternary between two shapes:
  // a ternary infers a union that the generated upsert overload rejects.
  const patch = {
    org_id: ctx.orgId,
    ai_mode: mode,
    updated_by: ctx.userId,
    ...(mode === "off" ? { monthly_credit_limit: 0 } : {}),
  };

  const { error } = await svc
    .from("org_ai_settings")
    .upsert(patch, { onConflict: "org_id" });
  if (error) return fail("Couldn't update the AI mode. Please try again.");

  revalidatePath("/settings");
  return { ok: true, data: { mode } };
}

// The provider is validated against the ai_providers TABLE, not a hardcoded
// enum — mirrors credentials-actions.ts. That three-member enum is why an org
// could not put a Mistral or Kimi key on file at all.
const keySchema = z.object({
  provider: z.string().trim().min(1).max(64),
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

  const svc = createServiceClient();
  const row = await getProviderRow(svc, provider);
  if (!row || !row.enabled) return fail("Unknown provider.");

  // See credentials-actions.ts: the shape check, the human label and the base
  // url are per-PROVIDER metadata, which is why they live on the row and not on
  // the (per-wire-format) adapter. Passing the row's base url is what lets an
  // openai-compatible provider be verified against its OWN endpoint instead of
  // OpenAI's.
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
  const { error } = await svc.rpc("org_ai_secret_set", {
    p_org: ctx.orgId,
    p_provider: provider,
    p_secret: key,
    p_hint: hint,
  });
  if (error) return fail("Couldn't save the key. Please try again.");

  // Same contract as `saveAiKey`, for the same reason: this key is the only
  // thing that can ask THIS provider which model ids it actually answers to,
  // and the catalog's ids come from the Gateway, whose namespace is not the
  // providers'. Saving the ORG key is therefore also the moment this provider's
  // rows become selectable — without it an admin saves the org's Mistral key
  // and the default-model picker still tells them to add one.
  //
  // Deferred via `after`, never awaited: verification is a live round-trip to a
  // third party, and awaiting it would make "Validate & save" as slow as the
  // slowest provider. `verifyProviderModels` already fails closed (a transport
  // error, an unparseable payload or an empty list skips the provider and
  // touches no row, and a verified row is never demoted), so nothing is layered
  // on top of it here — the try/catch below only keeps a deferred task from
  // rejecting into the platform, which nothing is left to observe.
  const verifyIds = async () => {
    try {
      await verifyProviderModels({ client: svc, provider, apiKey: key });
    } catch (e) {
      console.error(
        `[ai] id verification failed after saving the org ${provider} key`,
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

  revalidatePath("/settings");
  return { ok: true, data: { provider, hint } };
}

const defaultModelSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  modelId: z.string().trim().min(1).max(128),
});

/**
 * Points the whole org at one model. `modelId` is a CATALOG KEY
 * (`ai_models.model_id`) — never the wire id; `resolveModel` derives that.
 *
 * Both halves are re-validated server-side against the catalog and the registry
 * rather than trusted from the picker: a retired model, or a model belonging to
 * a provider that has been switched off, must never become the org-wide
 * fallback. `listActiveModels` deliberately does not join `ai_providers.enabled`
 * (see its doc comment), so the provider check is this action's job.
 *
 * UPDATE, never UPSERT. `org_ai_settings.ai_mode` defaults to `'per_user'`
 * while `DEFAULT_ORG_AI_SETTINGS` reads a MISSING row as `'off'` — inserting
 * here would hand AI to an org that has never been given it. An org with no row
 * is told to choose a mode first, which writes the row through `setAiMode`.
 */
export async function setOrgDefaultModel(input: {
  provider: string;
  modelId: string;
}): Promise<ActionResult<{ provider: string; modelId: string }>> {
  const parsed = defaultModelSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a model.");
  const { provider, modelId } = parsed.data;

  const ctx = await requireOrgAdmin();
  if (!ctx) return fail(NOT_ADMIN);

  const svc = createServiceClient();
  const row = await getProviderRow(svc, provider);
  if (!row || !row.enabled) return fail("Unknown provider.");

  const model = await getModel(svc, provider, modelId);
  if (!model || model.status !== "active")
    return fail("That model isn't available.");

  const { error, count } = await svc
    .from("org_ai_settings")
    .update(
      {
        default_provider: provider,
        default_model_id: modelId,
        updated_by: ctx.userId,
      },
      { count: "exact" },
    )
    .eq("org_id", ctx.orgId);
  if (error) return fail("Couldn't save the default model.");
  if (count === 0)
    return fail("Choose how AI is powered for this organization first.");

  revalidatePath("/settings/ai");
  return { ok: true, data: { provider, modelId } };
}

/**
 * Drops the org default, putting every feature back on its own tier.
 *
 * The counterpart to {@link setOrgDefaultModel}, and the way out of it: a
 * default overrides the tier a feature asks for, so "undo that" has to be
 * reachable. Both columns are cleared together — a catalog key is meaningless
 * without the provider it belongs to.
 *
 * An org with no settings row has no default to clear, so that is a success,
 * not an error (same reading as `removeAiKey`). Still an UPDATE, never an
 * UPSERT — see {@link setOrgDefaultModel} for what an insert here would do.
 */
export async function clearOrgDefaultModel(): Promise<
  ActionResult<Record<never, never>>
> {
  const ctx = await requireOrgAdmin();
  if (!ctx) return fail(NOT_ADMIN);

  const svc = createServiceClient();
  const { error } = await svc
    .from("org_ai_settings")
    .update(
      {
        default_provider: null,
        default_model_id: null,
        updated_by: ctx.userId,
      },
      { count: "exact" },
    )
    .eq("org_id", ctx.orgId);
  if (error) return fail("Couldn't clear the default model.");

  revalidatePath("/settings/ai");
  return { ok: true, data: {} };
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

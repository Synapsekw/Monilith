"use server";

import { redirect } from "next/navigation";
import { type ActionResult, fail } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  deleteAccountSchema,
  reassignmentSummarySchema,
  type ReassignmentSummary,
} from "@/lib/validations/account";
import type { Json } from "@/types/database.types";

/** Avatar object keys are `{user_id}/{uuid}.{ext}` (20260707130000_avatars_bucket). */
const AVATAR_BUCKET = "avatars";

/**
 * Self-serve hard delete of your own account.
 *
 * Mirrors `platformDeleteUser` (src/lib/platform/actions.ts) — same sole-owner
 * guard, same audit-before-delete — with the four differences that only apply to
 * deleting yourself: the confirmation is your own email (re-verified here, never
 * trusted from the client), authorship of org work product is reassigned to a
 * surviving owner first, the receiving owners are notified, and the session is
 * torn down afterwards.
 *
 * The ordering is load-bearing, in both directions:
 *   • Reassignment must PRECEDE the delete, because the 13 ownership-bearing FKs
 *     are deliberately still NOT NULL / NO ACTION (spec §3.2) — the delete is
 *     physically impossible until they are empty.
 *   • The audit rows must PRECEDE the delete too: they carry `actor_id` /
 *     `target_user_id` pointing at the user, which the new SET NULL FKs blank out
 *     as the row goes. Written afterwards they would fail their own FK.
 *   • `signOut` must FOLLOW the delete, because reaching the delete needs an
 *     authenticated context.
 *
 * The one seam that cannot be atomic is reassignment → `deleteUser`: the latter
 * is GoTrue's admin API, not SQL, so no transaction spans both. If the delete
 * fails after a successful reassignment the user still exists with their work
 * transferred to a co-owner — recoverable and visible in the audit log, and the
 * alternative (delete first) is impossible. Every failure BEFORE that point
 * mutates nothing.
 */
export async function deleteOwnAccount(input: unknown): Promise<ActionResult> {
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // The client already gates its button on this, but that is an accident guard,
  // not authorization: re-verify against the session's own email.
  const typed = parsed.data.confirmEmail.trim().toLowerCase();
  if (!user.email || typed !== user.email.toLowerCase())
    return fail("That's not your email address.");

  // Shared definition of "sole owner" with the admin delete path — the RPC's gate
  // was widened rather than cloned so the two can never drift apart.
  const { data: soleOrgs, error: checkErr } = await supabase.rpc(
    "platform_user_sole_owned_orgs",
    { p_user_id: user.id },
  );
  if (checkErr) return fail("Could not verify org ownership.");
  if (soleOrgs && soleOrgs.length > 0) {
    const names = soleOrgs.map((o) => o.org_name).join(", ");
    return fail(
      `You're the only owner of ${names}. Make someone else an owner in Settings → Members first, or delete the organization.`,
    );
  }

  // Deliberately the USER client, not the service client: the RPC's own gate is
  // `is_platform_admin() OR p_user_id = auth.uid()`, so going through the session
  // makes the database enforce "you may only do this to yourself" independently of
  // this code being correct.
  const { data: rawSummary, error: reassignErr } = await supabase.rpc(
    "user_delete_reassign_authorship",
    { p_user_id: user.id },
  );
  if (reassignErr)
    return fail("Could not transfer your work to another owner.");

  const summary = parseSummary(rawSummary);
  const svc = createServiceClient();

  // Audit BEFORE the delete (see the ordering note above). `actor_kind` is
  // CHECK-constrained to 'org' | 'platform', so a per-org row is 'org' and the
  // platform-level row (org_id null) is 'platform', matching platformDeleteUser.
  const auditBase = {
    actor_id: user.id,
    action: "account.self_deleted",
    target_user_id: user.id,
    // Retained in plaintext by decision D1; a purge window is a documented
    // follow-up. Both user pointers above become null as the row is deleted, so
    // this is the only identifier that survives — deliberately, for anti-abuse
    // and "was this account deleted?" support questions.
    target_email: user.email,
  };
  // The generated `Json` is a recursive union that a concrete object type never
  // satisfies structurally (no index signature) — the same codegen mismatch
  // `src/lib/supabase/typed-rpc.ts` documents for jsonb RPC args. The values are
  // Zod-validated above and provably serializable, so the casts are honest here.
  const { error: auditErr } = await svc.from("admin_audit_log").insert([
    {
      ...auditBase,
      org_id: null,
      actor_kind: "platform",
      // Only the platform row carries the full cross-org picture — its SELECT
      // policy is `is_platform_admin()`.
      metadata: summary as unknown as Json,
    },
    ...Object.entries(summary.targets).map(([orgId, ownerId]) => ({
      ...auditBase,
      org_id: orgId,
      actor_kind: "org",
      // Scoped to THIS org. Org rows are readable by that org's owners/admins, so
      // embedding the whole `targets` map would tell org A which other orgs the
      // user belonged to and who owns them — a cross-tenant leak through an audit
      // payload rather than through RLS.
      metadata: { counts: summary.counts, target: ownerId } as unknown as Json,
    })),
  ]);
  if (auditErr)
    console.error("[deleteOwnAccount] audit insert failed", {
      error: auditErr.message,
    });

  // `storage.objects` has NO foreign key to `auth.users` in this project, so
  // nothing else ever removes the avatar: `profiles.avatar_url` cascades away and
  // leaves a public, unreferenced image addressable by anyone holding the URL.
  // That is a real erasure gap (spec §7), so it is cleaned up explicitly — but
  // best-effort, because a Storage outage must not block the erasure itself.
  try {
    const { data: files } = await svc.storage.from(AVATAR_BUCKET).list(user.id);
    if (files?.length)
      await svc.storage
        .from(AVATAR_BUCKET)
        .remove(files.map((f) => `${user.id}/${f.name}`));
  } catch (err) {
    console.error("[deleteOwnAccount] avatar cleanup failed", { error: err });
  }

  const { error: delErr } = await svc.auth.admin.deleteUser(user.id);
  if (delErr) return fail("Could not delete your account.");

  // Decision D4: inheriting someone else's boards should surface, not sit in an
  // audit view nobody opens. System-authored (`actor_id` null) and best-effort —
  // the account is already gone, so a failed insert must not surface as an error.
  // Written after the delete because the recipient is a SURVIVING user; nothing
  // here references the deleted row.
  const notifications = Object.entries(summary.targets).map(
    ([orgId, ownerId]) => ({
      org_id: orgId,
      recipient_id: ownerId,
      actor_id: null,
      kind: "account_deleted" as const,
      payload: {
        deletedEmail: user.email ?? null,
        counts: summary.counts,
      },
    }),
  );
  if (notifications.length > 0) {
    const { error: notifyErr } = await svc
      .from("notifications")
      .insert(notifications);
    if (notifyErr)
      console.error("[deleteOwnAccount] owner notification failed", {
        error: notifyErr.message,
      });
  }

  // Access tokens are stateless JWTs, so deleting the row only revokes refresh
  // tokens; `signOut` is what clears the cookies. GoTrue may answer 401 for a
  // now-nonexistent user, hence the catch — any residual cookie is worthless
  // because `requireUser()` will fail against the missing row and bounce to /login.
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }

  redirect("/login?deleted=1");
}

/**
 * Narrow the RPC's opaque `Json` return into the shape the caller needs. Lenient
 * by design: this runs AFTER the reassignment has committed, so a parse failure
 * must degrade to "no per-org detail", never abort the deletion mid-flight.
 */
function parseSummary(raw: unknown): ReassignmentSummary {
  const result = reassignmentSummarySchema.safeParse(raw);
  if (result.success) return result.data;
  console.error("[deleteOwnAccount] unexpected reassignment summary shape", {
    issues: result.error.issues,
  });
  return { counts: {}, targets: {} };
}

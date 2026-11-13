import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { approvalTag } from "@/lib/cache/tags";
import type { SessionUser } from "@/lib/auth/session";

export { approvalTag };

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** Where an account that is not (yet) approved waits. */
export const PENDING_APPROVAL_PATH = "/pending-approval";

/**
 * The platform-admin approval status of an account. Same caching pattern as
 * `isPlatformAdminCached`: `userId` is the cache key and the tag scope, the
 * service client is created inside the cached scope (no cookies/headers), and
 * the explicit `user_id = userId` filter is the tenant boundary (the service
 * client bypasses RLS; `account_approvals` is readable by the service role only).
 *
 * A missing row counts as "pending". A read error THROWS — it must never let an
 * account through, nor be shown as "pending". A `use cache` function that
 * throws stores nothing (only a resolved value is cached), so a failed read is
 * retried on the next request instead of being pinned as a status.
 * Approve/Reject clear `approvalTag(userId)` via updateTag.
 */
export async function getAccountApproval(
  userId: string,
): Promise<ApprovalStatus> {
  "use cache";
  cacheLife("guard");
  cacheTag(approvalTag(userId));

  return queryApproval(userId);
}

/**
 * The same read with NO cache: always the live row. Used wherever a stale
 * "pending" would be wrong (the waiting screen's "Check again", and the gate's
 * second look before it sends an account to the waiting screen). Same
 * semantics: missing row -> "pending", read error -> throws.
 */
export async function readAccountApproval(
  userId: string,
): Promise<ApprovalStatus> {
  return queryApproval(userId);
}

async function queryApproval(userId: string): Promise<ApprovalStatus> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("account_approvals")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not verify account approval.");
  if (data?.status === "approved") return "approved";
  if (data?.status === "rejected") return "rejected";
  // No row, or an unexpected value: fail closed.
  return "pending";
}

/** Send an account that is not approved to the waiting screen. Only
 * "approved" is trusted from the cache: any other cached status is re-checked
 * live (a just-approved account must not bounce off a stale "pending" held by
 * another server instance). A read error propagates (never a redirect).
 * redirect() throws — keep it outside try/catch. */
export async function enforceApproval(
  user: Pick<SessionUser, "id">,
): Promise<void> {
  if ((await getAccountApproval(user.id)) === "approved") return;
  if ((await readAccountApproval(user.id)) !== "approved") {
    redirect(PENDING_APPROVAL_PATH);
  }
}

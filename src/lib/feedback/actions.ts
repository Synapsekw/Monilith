"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  submitFeedbackSchema,
  adminUpdateFeedbackSchema,
  type SubmitFeedbackInput,
  type AdminUpdateFeedbackInput,
} from "@/lib/validations/feedback";
import type { Tables } from "@/types/database.types";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

export type MyFeedback = Pick<
  Tables<"feedback">,
  | "id"
  | "kind"
  | "title"
  | "status"
  | "admin_response"
  | "responded_at"
  | "created_at"
>;

export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = submitFeedbackSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // The user's active org scopes the row (RLS also checks is_org_member).
  const { data: membership, error: memberErr } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (memberErr || !membership) return fail("No organization found.");

  const { data, error } = await supabase
    .from("feedback")
    .insert({
      submitted_by: user.id,
      org_id: membership.org_id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      body: parsed.data.body,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not submit feedback.");

  return { ok: true, data: { id: data.id } };
}

export async function listMyFeedback(): Promise<ActionResult<MyFeedback[]>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // RLS already restricts to own rows; the explicit eq keeps the index hot.
  const { data, error } = await supabase
    .from("feedback")
    .select("id, kind, title, status, admin_response, responded_at, created_at")
    .eq("submitted_by", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return fail("Could not load your requests.");

  return { ok: true, data: data ?? [] };
}

export async function adminUpdateFeedback(
  input: AdminUpdateFeedbackInput,
): Promise<ActionResult> {
  const parsed = adminUpdateFeedbackSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const patch: Partial<Tables<"feedback">> = {
    status: parsed.data.status,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.adminResponse !== undefined) {
    patch.admin_response = parsed.data.adminResponse;
    patch.responded_by = user.id;
    patch.responded_at = new Date().toISOString();
  }

  // RLS gates this update to platform admins.
  const { data: row, error } = await supabase
    .from("feedback")
    .update(patch)
    .eq("id", parsed.data.id)
    .select("id, org_id, submitted_by")
    .single();
  if (error || !row) return fail("Could not update feedback.");

  // Notify the submitter via the service client: the platform admin is not a
  // member of the submitter's org, so the notifications-insert RLS policy would
  // block a normal insert. Skip self-notification.
  if (row.submitted_by !== user.id) {
    const service = createServiceClient();
    // Best-effort notify: the feedback update already succeeded, so a failed
    // insert must not fail the action — but log it instead of dropping it.
    const { error: notifyErr } = await service.from("notifications").insert({
      org_id: row.org_id,
      recipient_id: row.submitted_by,
      actor_id: user.id,
      kind: "feedback_response",
      feedback_id: row.id,
    });
    if (notifyErr)
      console.error("[adminUpdateFeedback] notification insert failed", {
        feedbackId: row.id,
        recipientId: row.submitted_by,
        error: notifyErr.message,
      });
  }

  revalidatePath("/admin/feedback");
  return { ok: true, data: undefined };
}

"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fail, type ActionResult } from "@/lib/actions/result";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { folderMembersTag, sharedBoardsTag } from "@/lib/cache/tags";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import {
  folderAccessSchema,
  inviteToFolderSchema,
  revokeFolderInvitationSchema,
  shareFolderSchema,
  unshareFolderSchema,
} from "@/lib/validations/folder-sharing";
import { FOLDER_GONE_ERROR } from "./types";
import type {
  FolderAccessData,
  FolderInvitationEntry,
  InviteOutcome,
} from "./sharing-types";

const MEMBERS_LIMIT = 200;
const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Maps a raised SQL exception to friendly, non-leaking copy. */
function friendly(error: { message: string; code?: string }): string {
  const m = error.message.toLowerCase();
  if (m.includes("not allowed to manage"))
    return "Only the folder's creator or an admin can invite people";
  if (m.includes("invalid email")) return "Enter a valid email address";
  if (m.includes("not a member"))
    return "That person isn't in your organization yet.";
  if (m.includes("mono follows"))
    return "A Mono gets access through its owner.";
  if (m.includes("invitation not found"))
    return "That invitation is no longer pending.";
  if (error.code === "23505" || m.includes("already has access"))
    return "That person already has access";
  return GENERIC_ERROR;
}

/**
 * What a folder grant change makes stale for one person: their "Shared with
 * me" list (also the tag of the portfolio readable-boards cache) and their
 * folder-membership cache (sidebar guest filter). foldersTag is deliberately
 * NOT invalidated: the cached folder list holds only folders and placements,
 * which a membership change does not touch.
 */
function invalidateFor(userId: string): void {
  updateTag(sharedBoardsTag(userId));
  updateTag(folderMembersTag(userId));
}

/** Everything the share dialog shows. Loaded when the dialog opens, not on first paint. */
export async function loadFolderAccess(
  input: unknown,
): Promise<ActionResult<FolderAccessData>> {
  const parsed = folderAccessSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");
  const { folderId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("You must be signed in.");

  const [{ data: folder }, manageRes, membersRes] = await Promise.all([
    supabase
      .from("folders")
      .select("id, org_id")
      .eq("id", folderId)
      .maybeSingle(),
    typedRpc(supabase, "can_manage_folder", { p_folder_id: folderId }),
    supabase
      .from("folder_members")
      .select("user_id, access_level")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: true })
      .limit(MEMBERS_LIMIT),
  ]);
  if (!folder) return fail(FOLDER_GONE_ERROR);
  const canManage = manageRes.data === true;

  const [roster, invitesRes] = await Promise.all([
    listOrgMembersCached(folder.org_id),
    canManage
      ? typedRpc(supabase, "folder_invitation_states", {
          p_folder_id: folderId,
        })
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const byId = new Map(roster.map((m) => [m.userId, m]));
  const memberIds = new Set((membersRes.data ?? []).map((r) => r.user_id));

  return {
    ok: true,
    data: {
      canManage,
      myUserId: user.id,
      // True when the folder has more members than the list holds.
      membersTruncated: (membersRes.data ?? []).length >= MEMBERS_LIMIT,
      members: (membersRes.data ?? []).map((r) => ({
        userId: r.user_id,
        fullName: byId.get(r.user_id)?.fullName ?? null,
        avatarUrl: byId.get(r.user_id)?.avatarUrl ?? null,
        level: r.access_level === "editor" ? "editor" : "viewer",
      })),
      invitations: (invitesRes.data ?? []).map((i): FolderInvitationEntry => ({
        id: i.id,
        email: i.email,
        level: i.access_level === "editor" ? "editor" : "viewer",
        state:
          i.state === "awaiting_approval" ? "awaiting_approval" : "invited",
      })),
      // People in the org who are not on the folder yet. Only a manager can
      // add anyone, so nobody else receives the list.
      candidates: canManage
        ? roster
            .filter((m) => !memberIds.has(m.userId))
            .map((m) => ({ userId: m.userId, fullName: m.fullName }))
        : [],
    },
  };
}

export async function shareFolder(input: unknown): Promise<ActionResult> {
  const parsed = shareFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "share_folder", {
    p_folder_id: parsed.data.folderId,
    p_user_id: parsed.data.userId,
    p_level: parsed.data.level,
  });
  if (error) return fail(friendly(error));
  invalidateFor(parsed.data.userId);
  return { ok: true, data: undefined };
}

export async function unshareFolder(input: unknown): Promise<ActionResult> {
  const parsed = unshareFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "unshare_folder", {
    p_folder_id: parsed.data.folderId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendly(error));
  invalidateFor(parsed.data.userId);
  return { ok: true, data: undefined };
}

/**
 * Invite by email. An address that already belongs to an active org member is
 * shared directly (`kind: "shared"`). Any other address gets a pending folder
 * invitation plus a guest org invitation (both recorded by the RPC, which does
 * its own permission check on the caller's RLS client), then the standard
 * invite email; `emailSent` is false only when delivery genuinely failed (an
 * already-registered address counts as sent, so account existence is not
 * revealed). Access starts when the
 * person signs in after a platform admin has approved the account.
 */
export async function inviteToFolder(
  input: unknown,
): Promise<ActionResult<InviteOutcome>> {
  const parsed = inviteToFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { folderId, email, level } = parsed.data;

  const supabase = await createClient();
  const { data: sharedUserId, error } = await typedRpc(
    supabase,
    "invite_to_folder",
    { p_folder_id: folderId, p_email: email, p_level: level },
  );
  if (error) return fail(friendly(error));

  if (typeof sharedUserId === "string") {
    invalidateFor(sharedUserId);
    return { ok: true, data: { kind: "shared" } };
  }

  // The RPC succeeded, so the caller is allowed. Only now use the service role.
  const svc = createServiceClient();
  const { error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email);
  // "Already registered" counts as sent (they redeem on their next sign-in), so
  // the result never reveals whether an address has an account. Only a genuine
  // delivery failure reports `emailSent: false`.
  let emailSent = true;
  if (inviteErr && !/already.*regist/i.test(inviteErr.message)) {
    emailSent = false;
    console.error("[inviteToFolder] invite email delivery failed", {
      folderId,
      error: inviteErr.message,
    });
  }

  const [
    { data: folder },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from("folders")
      .select("id, org_id")
      .eq("id", folderId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  const { error: auditErr } = await svc.from("admin_audit_log").insert({
    org_id: folder?.org_id ?? null,
    actor_id: user?.id ?? null,
    actor_kind: "org",
    action: "folder.invited",
    target_email: email,
    metadata: { folderId, level },
  });
  if (auditErr)
    console.error("[inviteToFolder] audit-log insert failed (compliance)", {
      folderId,
      error: auditErr.message,
    });

  return { ok: true, data: { kind: "invited", emailSent } };
}

export async function revokeFolderInvitation(
  input: unknown,
): Promise<ActionResult> {
  const parsed = revokeFolderInvitationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "revoke_folder_invitation", {
    p_id: parsed.data.invitationId,
  });
  if (error) return fail(friendly(error));
  return { ok: true, data: undefined };
}

/** A member removes themself (RLS: "folder_members: member leaves"). */
export async function leaveFolder(input: unknown): Promise<ActionResult> {
  const parsed = folderAccessSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("You must be signed in.");
  const { data: removed, error } = await supabase
    .from("folder_members")
    .delete()
    .eq("folder_id", parsed.data.folderId)
    .eq("user_id", user.id)
    .select("user_id");
  if (error) return fail(GENERIC_ERROR);
  // Nothing removed: not on this folder (any more), so nothing was left.
  if ((removed ?? []).length === 0)
    return fail("You are not a member of this folder");
  invalidateFor(user.id);
  return { ok: true, data: undefined };
}

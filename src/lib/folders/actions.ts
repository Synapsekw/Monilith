"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { dashboardsTag, foldersTag, sharedBoardsTag } from "@/lib/cache/tags";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  attachDashboardSchema,
  createFolderSchema,
  deleteFolderSchema,
  folderIdSchema,
  moveBoardToFolderSchema,
  renameFolderSchema,
} from "@/lib/validations/folders";
import type { MoveConfirm } from "./sharing-types";
import { resolveFolderTimeline, resolveFolderWorkload } from "./resolve";
import type { FolderTimelineData } from "@/lib/boards/timeline-context";
import {
  FOLDER_GONE_ERROR,
  type FolderSummary,
  type WorkloadRow,
} from "./types";

const DUPLICATE_NAME =
  "A folder with that name already exists in this workspace.";

const SHARED_FOLDER_MOVE =
  "Only the board's owner or an admin can move a board into or out of a shared folder.";

const GENERIC_FOLDER_ERROR = "Something went wrong. Please try again.";
/** Read cap on the members of the folders a placement change touches. */
const MEMBER_ROWS_LIMIT = 500;

/** Logs the raw database error server-side; the client only sees generic copy. */
function genericFolderError(action: string, error: { message: string }) {
  console.error(`[${action}] folder write failed`, { error: error.message });
  return GENERIC_FOLDER_ERROR;
}

/** The shared-folder trigger gets its own copy; anything else stays generic. */
function moveError(error: { message: string }) {
  return error.message.includes("shared folder")
    ? SHARED_FOLDER_MOVE
    : genericFolderError("moveBoardToFolder", error);
}

type Db = Awaited<ReturnType<typeof createClient>>;

/** Members of these folders. RLS client: only folders the caller can see answer. */
async function folderMemberRows(
  supabase: Db,
  folderIds: string[],
): Promise<{ folder_id: string; user_id: string }[]> {
  if (folderIds.length === 0) return [];
  const { data } = await supabase
    .from("folder_members")
    .select("folder_id, user_id")
    .in("folder_id", folderIds)
    .limit(MEMBER_ROWS_LIMIT);
  return data ?? [];
}

/** A placement change alters which boards these people can read. */
function invalidateSharedLists(rows: { user_id: string }[]): void {
  for (const id of new Set(rows.map((r) => r.user_id)))
    updateTag(sharedBoardsTag(id));
}

/**
 * Shared folders are org-visible and workspace-scoped, so every action runs on
 * the request's RLS client and invalidates ONLY foldersTag(orgId) — no board
 * row changes, so boardsTag / sharedBoardsTag stay warm.
 */
export async function createFolder(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<FolderSummary>> {
  const parsed = createFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const user = await getUser();
  if (!user) return fail("You must be signed in.");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("folders")
    .select("position")
    .eq("workspace_id", parsed.data.workspaceId)
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("folders")
    .insert({
      org_id: org.id,
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      position,
      created_by: user.id,
    })
    .select("id, name, position, workspace_id, org_id")
    .single();
  if (error?.code === "23505") return fail(DUPLICATE_NAME);
  if (error || !data) return fail(error?.message ?? "Couldn't create folder.");

  updateTag(foldersTag(org.id));
  return {
    ok: true,
    data: {
      id: data.id,
      name: data.name,
      workspaceId: data.workspace_id,
      orgId: data.org_id,
      position: data.position,
    },
  };
}

/**
 * `workspace_id` is deliberately not part of `renameFolderSchema` (or this
 * input): RLS would allow moving a folder's workspace on an update, but that
 * breaks the one-workspace-per-folder invariant, so the surface here can only
 * ever change the name.
 */
export async function renameFolder(input: {
  folderId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("folders")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.folderId)
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return fail(DUPLICATE_NAME);
  if (error) return fail(error.message);
  if (!data) return fail(FOLDER_GONE_ERROR);
  updateTag(foldersTag(org.id));
  return { ok: true, data: undefined };
}

/** Deleting a folder cascades its placements and nulls dashboards.folder_id; boards are untouched. */
export async function deleteFolder(input: {
  folderId: string;
}): Promise<ActionResult> {
  const parsed = deleteFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();
  // Read before the delete: the cascade removes the rows that say whose
  // "Shared with me" list just changed.
  const memberRows = await folderMemberRows(supabase, [parsed.data.folderId]);
  const { data, error } = await supabase
    .from("folders")
    .delete()
    .eq("id", parsed.data.folderId)
    .select("id")
    .maybeSingle();
  if (error) return fail(genericFolderError("deleteFolder", error));
  if (!data) return fail(FOLDER_GONE_ERROR);
  updateTag(foldersTag(org.id));
  updateTag(dashboardsTag(org.id));
  invalidateSharedLists(memberRows);
  return { ok: true, data: undefined };
}

/**
 * File a board (upsert on the board_id PK — "one folder per board" is the key)
 * or unfile with null.
 *
 * Filing a board into a folder that has members gives those people access to
 * it, so the first call returns `needsConfirm` and changes nothing; the caller
 * confirms and calls again with `confirmShared: true`.
 *
 * `needsConfirm` is the TOTAL number of members of the target folder, including
 * the mover and people who can already read the board. Word it as "N people in
 * this folder will have access", not "N new people". `truncated` is true when
 * the member read hit its cap, so the real count may be higher.
 */
export async function moveBoardToFolder(input: {
  boardId: string;
  folderId: string | null;
  confirmShared?: boolean;
}): Promise<ActionResult<MoveConfirm | undefined>> {
  const parsed = moveBoardToFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();
  const { boardId, folderId, confirmShared } = parsed.data;

  const { data: current } = await supabase
    .from("folder_boards")
    .select("folder_id")
    .eq("board_id", boardId)
    .maybeSingle();
  const currentFolderId = current?.folder_id ?? null;
  const affected = [currentFolderId, folderId].filter(
    (v): v is string => typeof v === "string",
  );
  const memberRows = await folderMemberRows(supabase, [...new Set(affected)]);

  if (folderId !== null && folderId !== currentFolderId && !confirmShared) {
    const incoming = memberRows.filter((r) => r.folder_id === folderId).length;
    if (incoming > 0)
      return {
        ok: true,
        data: {
          needsConfirm: incoming,
          truncated: memberRows.length >= MEMBER_ROWS_LIMIT,
        },
      };
  }

  if (folderId === null) {
    // Unfiling a board with no placement is a legitimate no-op (double click, stale menu).
    const { error } = await supabase
      .from("folder_boards")
      .delete()
      .eq("board_id", boardId);
    if (error) return fail(moveError(error));
  } else {
    const { data: last } = await supabase
      .from("folder_boards")
      .select("position")
      .eq("folder_id", folderId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (last?.[0]?.position ?? -1) + 1;
    const { error } = await supabase
      .from("folder_boards")
      .upsert(
        { board_id: boardId, folder_id: folderId, position },
        { onConflict: "board_id" },
      );
    // A board outside the folder's workspace, or one you cannot read, is refused
    // by RLS (folder_accepts_board); moving into or out of a shared folder is
    // guarded by a trigger (owner or admin only).
    if (error) return fail(moveError(error));
  }
  updateTag(foldersTag(org.id));
  invalidateSharedLists(memberRows);
  return { ok: true, data: undefined };
}

/** Attach a dashboard to a folder in the SAME workspace, or detach with null (spec §3.3). */
export async function attachDashboardToFolder(input: {
  dashboardId: string;
  folderId: string | null;
}): Promise<ActionResult> {
  const parsed = attachDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();

  if (parsed.data.folderId === null) {
    const { data, error } = await supabase
      .from("dashboards")
      .update({ folder_id: null })
      .eq("id", parsed.data.dashboardId)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("That dashboard no longer exists.");
  } else {
    const { data: folder, error: folderErr } = await supabase
      .from("folders")
      .select("workspace_id")
      .eq("id", parsed.data.folderId)
      .maybeSingle();
    if (folderErr) return fail(folderErr.message);
    if (!folder) return fail(FOLDER_GONE_ERROR);
    const { data, error } = await supabase
      .from("dashboards")
      .update({ folder_id: parsed.data.folderId })
      .eq("id", parsed.data.dashboardId)
      .eq("workspace_id", folder.workspace_id)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("That dashboard is not in this folder's workspace.");
  }
  updateTag(dashboardsTag(org.id));
  updateTag(foldersTag(org.id));
  return { ok: true, data: undefined };
}

/** People tab data — fetched once on first open into TanStack Query (spec §6). */
export async function getFolderWorkload(input: {
  folderId: string;
}): Promise<ActionResult<WorkloadRow[]>> {
  const parsed = folderIdSchema.safeParse(input.folderId);
  if (!parsed.success) return fail("Invalid folder.");
  const supabase = await createClient();
  const res = await resolveFolderWorkload(supabase, parsed.data);
  if (!res.ok) return fail(res.error);
  return { ok: true, data: res.rows };
}

/** Timeline tab data — fetched once when the tab first mounts (TanStack Query). */
export async function getFolderTimeline(input: {
  folderId: string;
}): Promise<ActionResult<FolderTimelineData>> {
  const parsed = folderIdSchema.safeParse(input.folderId);
  if (!parsed.success) return fail("Invalid folder.");
  const supabase = await createClient();
  const res = await resolveFolderTimeline(supabase, parsed.data);
  if (!res.ok) return fail(res.error);
  return { ok: true, data: res.data };
}

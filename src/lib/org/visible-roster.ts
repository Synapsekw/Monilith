import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { OrgMember } from "@/lib/boards/queries";
import type { OrgMono } from "@/lib/monos/types";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getFolderAccessForUserCached } from "@/lib/folders/access-cached";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { listOrgMonosCached } from "@/lib/monos/queries-cached";
import {
  listWorkspacesCached,
  type WorkspaceListEntry,
} from "@/lib/workspaces/queries-cached";

/**
 * THE roster a given viewer may see.
 *
 * `listOrgMembersCached`, `listOrgMonosCached` and `listWorkspacesCached` are
 * read with the service client and cached per ORG, so they hold the whole org
 * and are shared by every viewer. A guest must not receive that: they see only
 * the people they share a folder or a board with, the Monos on boards they can
 * read, and the workspaces that hold something shared with them.
 *
 * The rule itself lives in the database (the read policies on `org_members`
 * and `workspaces`, migration 20261115173759). This module does not restate
 * it: for a guest it asks the viewer's own RLS-scoped client which ids it can
 * read and keeps those rows of the cached list. A non-guest costs nothing
 * extra: their role comes from `getFolderAccessForUserCached`, which the
 * shell already reads on every page.
 *
 * Narrowing happens AFTER the cached read, per viewer, so no per-org cache
 * entry ever holds a narrowed list and no viewer is served another's.
 *
 * Every page, picker and prompt that shows people, Monos or workspaces must
 * go through this module, never through the three cached reads directly.
 */
export type Visibility =
  { all: true } | { all: false; ids: ReadonlySet<string> };

/** Ids a guest could plausibly share access with; far above any real folder. */
const VISIBLE_IDS_LIMIT = 1000;

/** Keep the rows the viewer may see. Returns `rows` itself for `all`. */
export function narrowForViewer<T>(
  rows: T[],
  visibility: Visibility,
  idOf: (row: T) => string,
): T[] {
  if (visibility.all) return rows;
  return rows.filter((r) => visibility.ids.has(idOf(r)));
}

async function isConfined(userId: string, orgId: string): Promise<boolean> {
  // Fails closed: no active membership or a failed read reports a guest.
  return (await getFolderAccessForUserCached(userId, orgId)).isGuest;
}

/**
 * Which user ids (people and Monos) `userId` may see in `orgId`. `supabase`
 * must be the VIEWER's client (cookie-bound or MCP-bridged), never the
 * service client: its RLS is what answers. A failed read leaves a guest with
 * themselves alone.
 */
export async function loadRosterVisibility(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string,
): Promise<Visibility> {
  if (!userId || !orgId) return { all: false, ids: new Set() };
  if (!(await isConfined(userId, orgId))) return { all: true };
  const { data, error } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .limit(VISIBLE_IDS_LIMIT);
  const ids = new Set<string>([userId]);
  if (!error) for (const r of data ?? []) ids.add(r.user_id);
  return { all: false, ids };
}

/** Which workspaces of `orgId` the viewer may see. Same contract as above. */
export async function loadWorkspaceVisibility(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string,
): Promise<Visibility> {
  if (!userId || !orgId) return { all: false, ids: new Set() };
  if (!(await isConfined(userId, orgId))) return { all: true };
  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("org_id", orgId)
    .limit(VISIBLE_IDS_LIMIT);
  return {
    all: false,
    ids: new Set(error ? [] : (data ?? []).map((r) => r.id)),
  };
}

/** The org's people, as `userId` may see them. */
export async function visibleOrgMembersFor(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string,
): Promise<OrgMember[]> {
  const [members, visibility] = await Promise.all([
    listOrgMembersCached(orgId),
    loadRosterVisibility(supabase, userId, orgId),
  ]);
  return narrowForViewer(members, visibility, (m) => m.userId);
}

/** The org's Monos, as `userId` may see them: a Mono is visible on its own
 *  account (it is on a board the viewer can read), never through its owner. */
export async function visibleOrgMonosFor(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string,
): Promise<OrgMono[]> {
  const [monos, visibility] = await Promise.all([
    listOrgMonosCached(orgId),
    loadRosterVisibility(supabase, userId, orgId),
  ]);
  return narrowForViewer(monos, visibility, (m) => m.userId);
}

/**
 * People and Monos together, on ONE visibility read (the board page needs
 * both). A failed Monos read costs the Monos, never the people.
 */
export async function visibleRosterFor(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string,
): Promise<{ members: OrgMember[]; monos: OrgMono[] }> {
  const [members, monos, visibility] = await Promise.all([
    listOrgMembersCached(orgId),
    listOrgMonosCached(orgId).catch((): OrgMono[] => []),
    loadRosterVisibility(supabase, userId, orgId),
  ]);
  return {
    members: narrowForViewer(members, visibility, (m) => m.userId),
    monos: narrowForViewer(monos, visibility, (m) => m.userId),
  };
}

/** The org's workspaces, as `userId` may see them. */
export async function visibleWorkspacesFor(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string,
): Promise<WorkspaceListEntry[]> {
  const [workspaces, visibility] = await Promise.all([
    listWorkspacesCached(orgId),
    loadWorkspaceVisibility(supabase, userId, orgId),
  ]);
  return narrowForViewer(workspaces, visibility, (w) => w.id);
}

// ── Cookie-bound entry points (RSC, Server Actions, route handlers) ──────────
// The viewer is the signed-in user. `cache()` shares one visibility read per
// org across a request, however many consumers ask.

const sessionRosterVisibility = cache(
  async (orgId: string): Promise<Visibility> => {
    const user = await getUser();
    if (!user) return { all: false, ids: new Set() };
    return loadRosterVisibility(await createClient(), user.id, orgId);
  },
);

const sessionWorkspaceVisibility = cache(
  async (orgId: string): Promise<Visibility> => {
    const user = await getUser();
    if (!user) return { all: false, ids: new Set() };
    return loadWorkspaceVisibility(await createClient(), user.id, orgId);
  },
);

/** The org's people, as the signed-in user may see them. */
export async function listVisibleOrgMembers(
  orgId: string,
): Promise<OrgMember[]> {
  const [members, visibility] = await Promise.all([
    listOrgMembersCached(orgId),
    sessionRosterVisibility(orgId),
  ]);
  return narrowForViewer(members, visibility, (m) => m.userId);
}

/** The org's Monos, as the signed-in user may see them. */
export async function listVisibleOrgMonos(orgId: string): Promise<OrgMono[]> {
  const [monos, visibility] = await Promise.all([
    listOrgMonosCached(orgId),
    sessionRosterVisibility(orgId),
  ]);
  return narrowForViewer(monos, visibility, (m) => m.userId);
}

/** The org's workspaces, as the signed-in user may see them. */
export async function listVisibleWorkspaces(
  orgId: string,
): Promise<WorkspaceListEntry[]> {
  const [workspaces, visibility] = await Promise.all([
    listWorkspacesCached(orgId),
    sessionWorkspaceVisibility(orgId),
  ]);
  return narrowForViewer(workspaces, visibility, (w) => w.id);
}

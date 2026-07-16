import { Suspense } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";
import { FirstBoardEmptyState } from "@/components/boards/FirstBoardEmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { getUser, enforcePasswordChange } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { listMyBoards, listSharedBoards } from "@/lib/boards/queries";
import { boardIdFromPath, LAST_BOARD_COOKIE } from "@/lib/boards/last-board";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";

/**
 * Authenticated entry dispatcher. The public landing (`/`) is a static hero with
 * no per-user data; the cookie-reading "where does this user go" logic lives
 * here so `/` can be prerendered and served from the edge. `proxy.ts` redirects
 * logged-in visitors who hit `/` to this route; a logged-out visitor who reaches
 * it directly is sent to /login. Routing logic is unchanged from the prior `/`.
 */
export async function HomeDispatch() {
  const user = await getUser();
  if (!user) redirect("/login");

  enforcePasswordChange(user);

  // Fast path: the proxy stamps the last board the user visited. One bounded
  // RLS-scoped PK probe replaces the 3-list dispatch for a returning user. A
  // readable board implies org membership, so the orgs check is safely skipped
  // here. Shape-validate via boardIdFromPath so a tampered cookie never reaches
  // the uuid filter. Invalid/stale → ignore and fall through (the next board
  // visit overwrites it in the proxy).
  const jar = await cookies();
  const rawLast = jar.get(LAST_BOARD_COOKIE)?.value;
  const lastBoardId = rawLast ? boardIdFromPath(`/boards/${rawLast}`) : null;
  if (lastBoardId) {
    const supabase = await createClient();
    const { data: lastBoard } = await supabase
      .from("boards")
      .select("id")
      .eq("id", lastBoardId)
      .is("archived_at", null)
      .maybeSingle();
    if (lastBoard) redirect(`/boards/${lastBoard.id}`);
  }

  // The active org and the two board lists are independent (the org gates
  // onboarding; the two lists gate the board redirects) — batch them into one
  // round-trip. Decision ORDER is unchanged: onboarding wins over any board
  // redirect, owned over shared.
  const [org, boards, sharedBoards] = await Promise.all([
    resolveActiveOrg(),
    listMyBoards(),
    listSharedBoards(),
  ]);

  if (!org) redirect("/onboarding");

  if (boards.length > 0) redirect(`/boards/${boards[0].id}`);

  // A member who owns no boards but has one shared with them should land on it,
  // not on the empty welcome screen (the sidebar's "Shared with me" only renders
  // under /boards/*). Mirrors the owned-board redirect above.
  if (sharedBoards.length > 0) redirect(`/boards/${sharedBoards[0].id}`);

  // First-run: no boards at all. Guide the user to create their first board
  // right here — the org's first workspace is the create target (a fresh org
  // always has one from onboarding).
  const workspaces = await listWorkspacesCached(org.id);

  return (
    <AuthenticatedShell>
      <FirstBoardEmptyState
        orgName={org.name}
        workspaceId={workspaces[0]?.id}
      />
    </AuthenticatedShell>
  );
}

/** Minimal centered pulse shown while the dispatch's reads stream. /home lives
 * outside the (app) shell, so this owns the whole viewport. */
function HomeDispatchFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading your workspace"
      className="flex min-h-dvh items-center justify-center"
    >
      <Skeleton className="size-8 rounded-full" />
    </div>
  );
}

export default function Home() {
  // The cookie-bound dispatch (redirects + welcome shell) streams behind a
  // Suspense boundary so the route satisfies Cache Components.
  return (
    <Suspense fallback={<HomeDispatchFallback />}>
      <HomeDispatch />
    </Suspense>
  );
}

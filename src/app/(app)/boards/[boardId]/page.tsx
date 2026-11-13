import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { BoardViews } from "@/components/boards/BoardViews";
import { AiBoardReviewBanner } from "@/components/boards/ai/AiBoardReviewBanner";
import { BoardDock } from "@/components/boards/dock/BoardDock";
import { deriveBoardAccess, getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { resolveActiveOrg } from "@/lib/org/active";
import { BOARD_ENTRY_COOKIE } from "@/lib/boards/last-board";
import { resolveSelectedView } from "@/lib/boards/views";
import { getBoardViewPrefs } from "@/lib/boards/view-prefs";
import { getBoardLastSeenAt } from "@/lib/boards/intelligence/visits";
import { getLatestBoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ view?: string; review?: string }>;
}) {
  const { boardId } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  // getBoardPayload and the all-grants board_members read don't depend on
  // each other, so they run in parallel. This replaces the page's former
  // extra getBoardAccess call (a re-select of boards.created_by + a second,
  // narrower board_members lookup) — access is now derived below from data
  // already loaded here (see deriveBoardAccess).
  const [
    payload,
    { data: grantRows },
    { data: agentRows },
    viewPrefs,
    lastSeenAt,
    latestRun,
    activeOrgMembers,
  ] = await Promise.all([
    getBoardPayload(boardId),
    supabase
      .from("board_members")
      .select("user_id, access_level")
      .eq("board_id", boardId),
    // Owner-scoped by RLS and capped by max_agents_per_user (default 3) —
    // this is a roster of names for the dock's switcher, NOT thread data.
    // Threads stay unfetched until the dock is opened.
    supabase
      .from("user_agents")
      .select("id, name")
      .eq("owner_id", user.id)
      .order("name"),
    // The caller's saved arrangement for this board. A point read on the
    // (user_id, board_id) primary key, issued in parallel with work that is
    // already slower, so it costs no measurable added latency. Resolving it
    // server-side is what lets collapsed groups arrive already collapsed —
    // no expand-then-collapse flash.
    getBoardViewPrefs(supabase, boardId, user.id),
    // Board Intelligence: when this user last had the board open. A point
    // read on the (board_id, user_id) primary key, in parallel with the
    // payload — the one extra first-paint read spec §8 allows. Drives the
    // "changed since" chip; null on a first visit hides it.
    getBoardLastSeenAt(supabase, boardId, user.id),
    // Board Intelligence: one indexed LIMIT 1 single-row read, in parallel;
    // the dock badge and the strip's "updated" meta are true on first paint,
    // and the tab's first open costs no read.
    getLatestBoardIntelligenceRun(supabase, boardId, user.id),
    // The member roster is keyed on the board's org, which is only known once
    // the payload lands — so it used to be a wave of its own after this one.
    // Almost every board lives in the ACTIVE org, and that is resolvable now
    // (request-memoised, the shell resolves it too), so the roster for it is
    // read speculatively here and used below only when the org matches. A
    // board from another org (shared across orgs) falls back to the read that
    // was always there. `resolveActiveOrg` is membership-verified, so this
    // never reads a roster the caller could not already see; a failure here
    // must not fail the page, hence the catch → fallback.
    resolveActiveOrg()
      .then(async (org) =>
        org
          ? { orgId: org.id, members: await listOrgMembersCached(org.id) }
          : null,
      )
      .catch(() => null),
  ]);
  // Opening the app (`/`) lands here straight from the proxy on the strength
  // of the last-board cookie, which the proxy cannot check against the DB. If
  // that board has since been deleted, un-shared or archived, do not park the
  // visitor on a dead end every time they open the app: hand them to the /home
  // dispatcher, whose own probe rejects this board and falls through to a live
  // one (so this cannot loop). Only for that cookie-driven arrival — the
  // short-lived marker names the board — so any other visit to a dead link
  // keeps the honest not-found page, and an archived board opened on purpose
  // still renders. The cookie is read only on this rare path.
  if (!payload || payload.board.archived_at) {
    const entry = (await cookies()).get(BOARD_ENTRY_COOKIE)?.value;
    if (entry === boardId) redirect("/home");
  }
  if (!payload) notFound();

  const sp = await searchParams;
  // The URL always wins: a link carrying ?view= opens that view, exactly as it
  // does today. The saved view only fills the gap when the URL is silent, so
  // persistence is invisible to anyone arriving by link.
  const selected = resolveSelectedView(
    payload.views,
    sp.view ?? viewPrefs.viewId ?? undefined,
  );
  const selectedViewId = selected?.id ?? payload.views[0]?.id ?? "";

  const members =
    activeOrgMembers?.orgId === payload.board.org_id
      ? activeOrgMembers.members
      : await listOrgMembersCached(payload.board.org_id);

  const grants = (grantRows ?? []).map((g) => ({
    userId: g.user_id,
    access: g.access_level,
  }));
  const access = deriveBoardAccess(payload.board, grants, user.id);

  return (
    <div className="flex h-full min-h-0">
      {/* min-w-0 is load-bearing: board tables carry a min-width wider than the
          narrowed column, and without it this flex child refuses to shrink and
          pushes the PAGE into horizontal scroll instead of its own container. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {sp.review === "1" && (
          <div className="px-4 pt-4">
            <AiBoardReviewBanner boardId={boardId} />
          </div>
        )}
        <BoardViews
          payload={payload}
          members={members}
          initialViewId={selectedViewId}
          currentUserId={user.id}
          access={access ?? "viewer"}
          grants={grants}
          viewPrefs={viewPrefs}
          lastSeenAt={lastSeenAt}
        />
      </div>
      {/* Rendered here (it needs the page's roster, access and latest run) but
          NOT laid out here: on the wide surface it portals its <aside> into the
          shell's `#app-dock-slot`, beside the content card. This flex row only
          ever holds the board column. */}
      <BoardDock
        boardId={boardId}
        agents={agentRows ?? []}
        currentUserId={user.id}
        access={access ?? "viewer"}
        initialRun={latestRun}
        // "Always do this" maps a suggestion onto an automation draft purely
        // on the client (spec §2.2/§4). Column kinds and member ids are all
        // the mapper checks, and both are already in hand here — no new
        // query.
        ruleMeta={{
          columns: payload.columns.map((c) => ({ id: c.id, kind: c.kind })),
          memberIds: members.map((m) => m.userId),
        }}
      />
    </div>
  );
}

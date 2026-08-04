import { notFound } from "next/navigation";
import { BoardViews } from "@/components/boards/BoardViews";
import { AiBoardReviewBanner } from "@/components/boards/ai/AiBoardReviewBanner";
import { BoardDock } from "@/components/boards/dock/BoardDock";
import { deriveBoardAccess, getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { resolveSelectedView } from "@/lib/boards/views";
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
  const [payload, { data: grantRows }, { data: agentRows }] = await Promise.all(
    [
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
    ],
  );
  if (!payload) notFound();

  const sp = await searchParams;
  const selected = resolveSelectedView(payload.views, sp.view);
  const selectedViewId = selected?.id ?? payload.views[0]?.id ?? "";

  const members = await listOrgMembersCached(payload.board.org_id);

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
        />
      </div>
      <BoardDock
        boardId={boardId}
        agents={agentRows ?? []}
        currentUserId={user.id}
      />
    </div>
  );
}

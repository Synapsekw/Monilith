import { notFound } from "next/navigation";
import { BoardViews } from "@/components/boards/BoardViews";
import {
  getBoardAccess,
  getBoardPayload,
  listOrgMembers,
} from "@/lib/boards/queries";
import { resolveSelectedView } from "@/lib/boards/views";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { boardId } = await params;
  const user = await requireUser();

  const payload = await getBoardPayload(boardId);
  if (!payload) notFound();

  const { view } = await searchParams;
  const selected = resolveSelectedView(payload.views, view);
  const selectedViewId = selected?.id ?? payload.views[0]?.id ?? "";

  const supabase = await createClient();
  const [members, access, { data: grantRows }] = await Promise.all([
    listOrgMembers(payload.board.org_id),
    getBoardAccess(boardId),
    supabase
      .from("board_members")
      .select("user_id, access_level")
      .eq("board_id", boardId),
  ]);

  const grants = (grantRows ?? []).map((g) => ({
    userId: g.user_id,
    access: g.access_level,
  }));

  return (
    <BoardViews
      payload={payload}
      members={members}
      initialViewId={selectedViewId}
      currentUserId={user.id}
      access={access ?? "viewer"}
      grants={grants}
    />
  );
}

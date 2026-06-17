import { notFound } from "next/navigation";
import { BoardViews } from "@/components/boards/BoardViews";
import { getBoardPayload, listOrgMembers } from "@/lib/boards/queries";
import { resolveSelectedView } from "@/lib/boards/views";
import { requireUser } from "@/lib/auth/session";

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

  const members = await listOrgMembers(payload.board.org_id);

  return (
    <BoardViews
      payload={payload}
      members={members}
      initialViewId={selectedViewId}
      currentUserId={user.id}
    />
  );
}

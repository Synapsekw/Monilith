import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BoardTable } from "@/components/boards/BoardTable";
import { KanbanBoard } from "@/components/boards/KanbanBoard";
import {
  getBoardPayload,
  listBoards,
  listOrgMembers,
} from "@/lib/boards/queries";
import { resolveSelectedView } from "@/lib/boards/views";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
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
  const [orgs, boards, { data: workspaces }, members] = await Promise.all([
    getUserOrgs(),
    listBoards(),
    supabase.from("workspaces").select("id, name"),
    listOrgMembers(payload.board.org_id),
  ]);

  return (
    <AppShell
      user={{
        email: user.email,
        full_name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null,
      }}
      org={{ name: orgs[0]?.name ?? "Pulse" }}
      workspaces={workspaces ?? []}
      boards={boards}
      activeBoardId={boardId}
    >
      {selected?.kind === "kanban" ? (
        <KanbanBoard
          payload={payload}
          members={members}
          selectedViewId={selectedViewId}
        />
      ) : (
        <BoardTable
          payload={payload}
          members={members}
          selectedViewId={selectedViewId}
        />
      )}
    </AppShell>
  );
}

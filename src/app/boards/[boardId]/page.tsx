import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BoardTable } from "@/components/boards/BoardTable";
import { getBoardPayload, listBoards } from "@/lib/boards/queries";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const user = await requireUser();

  const payload = await getBoardPayload(boardId);
  if (!payload) notFound();

  const supabase = await createClient();
  const [orgs, boards, { data: workspaces }] = await Promise.all([
    getUserOrgs(),
    listBoards(),
    supabase.from("workspaces").select("id, name"),
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
      <BoardTable payload={payload} />
    </AppShell>
  );
}

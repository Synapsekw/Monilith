import { notFound } from "next/navigation";
import { CommandCenter } from "@/components/folders/CommandCenter";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildFolderPayload } from "@/lib/folders/payload";
import { folderIdSchema } from "@/lib/validations/folders";

/**
 * The folder command center (spec §4). One RSC render; every in-page
 * interaction is client state + history.replaceState (working agreement #5).
 * `searchParams` is deliberately NOT awaited here: tab/stage/board are read on
 * the client from useSearchParams(), so a bare link and a deep link render the
 * same server payload.
 */
export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  if (!folderIdSchema.safeParse(folderId).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();
  const payload = await buildFolderPayload(supabase, folderId, user.id);
  if (!payload) notFound();
  return <CommandCenter payload={payload} />;
}

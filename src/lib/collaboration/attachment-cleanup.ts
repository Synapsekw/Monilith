import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "attachments";
// Supabase storage.remove() takes an array; keep batches modest to stay well
// under request limits when a board with many files is deleted.
const BATCH_SIZE = 100;

/**
 * Best-effort removal of attachment storage objects via the service-role client
 * (bypasses the per-object uploader/admin RLS so a member can clear files other
 * people uploaded). An empty list is a no-op; logs — does not throw — on storage
 * errors, because the authoritative DB delete has already happened and a failed
 * object removal is at worst a rare orphan, never a dangling row.
 */
export async function removeAttachmentObjects(
  storagePaths: string[],
): Promise<void> {
  if (storagePaths.length === 0) return;

  const admin = createServiceClient();
  for (let i = 0; i < storagePaths.length; i += BATCH_SIZE) {
    const batch = storagePaths.slice(i, i + BATCH_SIZE);
    const { error } = await admin.storage.from(BUCKET).remove(batch);
    if (error) {
      console.error(
        `[attachment-cleanup] failed to remove ${batch.length} object(s): ${error.message}`,
      );
    }
  }
}

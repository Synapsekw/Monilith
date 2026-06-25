import { requireUser } from "@/lib/auth/session";
import { isPlatformAdminCached } from "@/lib/platform/guard";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { UserMenu } from "@/components/shell/user-menu";

/**
 * Streamed header user region (notifications bell + account menu). Rendered
 * behind a <Suspense> in the authenticated layout so its cookie-bound awaits
 * stream into the static shell rather than blocking first paint.
 */
export async function HeaderUserData() {
  const user = await requireUser();
  const platformAdmin = await isPlatformAdminCached(user.id);
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  return (
    <>
      <NotificationsBell userId={user.id} />
      <FeedbackButton />
      <UserMenu
        user={{ email: user.email, full_name: fullName }}
        isPlatformAdmin={platformAdmin}
      />
    </>
  );
}

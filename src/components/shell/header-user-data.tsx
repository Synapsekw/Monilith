import { requireUser } from "@/lib/auth/session";
import { isPlatformAdminCached } from "@/lib/platform/guard";
import { countNewFeedback } from "@/lib/feedback/queries";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { PlatformAdminMenu } from "@/components/shell/platform-admin-menu";
import { UserMenu } from "@/components/shell/user-menu";

/**
 * Streamed header user region (platform-admin button + notifications bell +
 * feedback + account menu). Rendered behind a <Suspense> in the authenticated
 * layout so its cookie-bound awaits stream into the static shell.
 */
export async function HeaderUserData() {
  const user = await requireUser();
  const platformAdmin = await isPlatformAdminCached(user.id);
  const newFeedbackCount = platformAdmin ? await countNewFeedback() : 0;
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;
  // `updateProfileAvatar` mirrors avatar_url into user_metadata, so the header
  // avatar paints from the session claims with no extra client/DB round-trip
  // (same path full_name already flows through).
  const avatarUrl =
    typeof user.user_metadata?.avatar_url === "string"
      ? user.user_metadata.avatar_url
      : null;

  return (
    <>
      <PlatformAdminMenu
        isPlatformAdmin={platformAdmin}
        newCount={newFeedbackCount}
      />
      <NotificationsBell userId={user.id} />
      <FeedbackButton />
      <UserMenu
        user={{ email: user.email, full_name: fullName, avatar_url: avatarUrl }}
      />
    </>
  );
}

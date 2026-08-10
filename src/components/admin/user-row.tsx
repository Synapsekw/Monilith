import type { PlatformUser } from "@/lib/platform/queries";
import { UserRowActions } from "@/components/admin/user-row-actions";

/** Column template shared by the header, the people table and the collapsed
 *  system/test section, so all three stay aligned as one grid. */
export const USER_ROW_GRID = "grid grid-cols-[1.6fr_2fr_0.7fr_120px] gap-3";

/**
 * One row of the platform user list. Extracted so the "System & test accounts"
 * accordion renders byte-identical markup to the main table — including the
 * full row actions, since an admin must still be able to ban or reset a system
 * account that has been collapsed out of the way.
 */
export function UserRow({ user }: { user: PlatformUser }) {
  const banned = Boolean(user.bannedUntil);
  return (
    <div
      className={`${USER_ROW_GRID} items-center border-b px-4 py-3 text-sm last:border-b-0`}
    >
      <span className="text-foreground truncate">{user.email ?? "—"}</span>
      <span className="text-muted-foreground truncate">
        {user.orgNames.length ? user.orgNames.join(" · ") : "—"}
      </span>
      <span className={banned ? "text-destructive" : "text-muted-foreground"}>
        {banned ? "Banned" : "Active"}
      </span>
      <UserRowActions
        userId={user.id}
        email={user.email ?? ""}
        banned={banned}
      />
    </div>
  );
}

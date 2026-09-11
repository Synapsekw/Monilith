/** The member avatar shared by the People cell and the People editor — one
 *  rendering of "who this is" so the picker and the cell it edits never drift.
 *  Lives outside `cells/index.tsx` because the editor cannot import from it
 *  (the cell renderers import the editors, not the other way round). */

import Image from "next/image";

import { cn } from "@/lib/utils";
import {
  STATUS_COLORS,
  statusToneClasses,
  type StatusColor,
} from "@/components/ui/status-pill";

/** 24px — the largest disc that still breathes inside a 36px board row. */
const AVATAR_PX = 24;

export function memberInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * A member's identity colour: one of the eight status tokens, picked by a
 * stable hash of the user id (FNV-1a). Same person, same colour on every board
 * and in every session — with no column to store it in and no ordering
 * dependency, which a palette handed out by index would have. Photos win where
 * a member has one; this only fills the initials disc.
 */
export function memberColor(userId: string): StatusColor {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return STATUS_COLORS[(h >>> 0) % STATUS_COLORS.length];
}

/**
 * Member avatar: the member's photo (a stable Supabase public URL rendered via
 * `<Image unoptimized>` — the established avatar pattern, not routed through
 * the optimizer), or initials on a solid fill in their identity colour.
 *
 * The fill is deliberate: a one-step `bg-surface-muted` disc reads as an empty
 * dot next to a full-colour photo, so a stack of them was a grey caterpillar
 * rather than four people. `statusToneClasses(..., "solid")` carries the
 * WCAG-checked near-black (light-mode purple: white) text for each token.
 */
export function MemberAvatar({
  userId,
  name,
  avatarUrl,
  className,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  className?: string;
}) {
  return (
    <span
      data-slot="member-avatar"
      className={cn(
        "text-2xs flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        avatarUrl
          ? "bg-surface-muted"
          : statusToneClasses(memberColor(userId), "solid"),
        className,
      )}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          width={AVATAR_PX}
          height={AVATAR_PX}
          unoptimized
          className="size-full object-cover"
        />
      ) : (
        memberInitials(name)
      )}
    </span>
  );
}

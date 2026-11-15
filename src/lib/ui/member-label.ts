import { memberInitials } from "@/lib/ui/initials";

export const UNKNOWN_MEMBER = "Unknown member";

/** What an assignee prints as when the viewer was not given that person: a
 *  guest sees only the people they share access with, and an item can be
 *  assigned to anyone in the org. Neutral on purpose: no name, no email. */
export const HIDDEN_MEMBER = "Member";

type Nameable = { fullName: string | null; email?: string | null };

/** What to print for a person: their name, else their email, else "Unknown
 *  member" (nobody known, e.g. someone who has left the org). Names are never
 *  followed by an email here; callers that want a secondary line add it. */
export function memberLabel(m: Nameable): string {
  return m.fullName?.trim() || m.email?.trim() || UNKNOWN_MEMBER;
}

/** Initials for a printed label. An email-shaped label uses its local part
 *  ("ada.lovelace@x.com" -> "AL"); the unknown fallback yields "". */
export function labelInitials(label: string): string {
  if (label === UNKNOWN_MEMBER) return "";
  const at = label.indexOf("@");
  if (at <= 0) return memberInitials(label);
  return memberInitials(
    label
      .slice(0, at)
      .split(/[._+-]+/)
      .join(" "),
  );
}

/** Initials for a member, from their name or else their email's local part. */
export function memberLabelInitials(m: Nameable): string {
  return labelInitials(memberLabel(m));
}

/** The email to carry to the browser for a person: only when their name is
 *  missing, since the email is then the label. Named people stay name-only,
 *  so this adds no exposure beyond what a nameless row needs. */
export function labelEmail(m: {
  fullName: string | null;
  email: string | null;
}): string | null {
  return m.fullName?.trim() ? null : (m.email ?? null);
}

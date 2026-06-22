export type PresenceViewKind = "table" | "kanban" | "calendar" | "timeline" | "panel";

export type PresenceFocus = {
  viewKind: PresenceViewKind;
  targetId: string;
};

/** What each client publishes over the presence channel (one per tab). */
export type PresenceState = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  focus: PresenceFocus | null;
};

/** A user condensed from one-or-more tabs into a single roster entry. */
export type RosterOccupant = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  isSelf: boolean;
};

import type { PresenceState, RosterOccupant } from "./presence-types";

type RawPresence = Record<string, PresenceState[]>;

function flatten(raw: RawPresence): PresenceState[] {
  return Object.values(raw).flat();
}

/** The current user's own identity, from the cached board payload — carried so
 *  the roster can render self at first paint, before the presence websocket
 *  handshake (SUBSCRIBED → track → sync) round-trips. */
export type RosterSelf = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
};

/**
 * One entry per user (multiple tabs merged); self flagged. Self is seeded from
 * `self` FIRST so the current user's face shows immediately — the presence sync
 * only adds the *other* occupants once it arrives. When the sync later also
 * carries self, it dedupes by userId against the seed (self appears once, and
 * the seed's avatar — sourced from the cached payload — is preserved).
 */
export function toRoster(raw: RawPresence, self: RosterSelf): RosterOccupant[] {
  const byUser = new Map<string, RosterOccupant>();
  byUser.set(self.userId, {
    userId: self.userId,
    name: self.name,
    avatarUrl: self.avatarUrl,
    color: self.color,
    isSelf: true,
  });
  for (const s of flatten(raw)) {
    if (byUser.has(s.userId)) continue;
    byUser.set(s.userId, {
      userId: s.userId,
      name: s.name,
      avatarUrl: s.avatarUrl,
      color: s.color,
      isSelf: s.userId === self.userId,
    });
  }
  return [...byUser.values()];
}

/** targetId -> distinct users focused there. */
export function toFocusMap(raw: RawPresence): Map<string, RosterOccupant[]> {
  const map = new Map<string, Map<string, RosterOccupant>>();
  for (const s of flatten(raw)) {
    if (!s.focus) continue;
    const key = s.focus.targetId;
    if (!map.has(key)) map.set(key, new Map());
    const inner = map.get(key)!;
    if (!inner.has(s.userId)) {
      inner.set(s.userId, {
        userId: s.userId,
        name: s.name,
        avatarUrl: s.avatarUrl,
        color: s.color,
        isSelf: false,
      });
    }
  }
  return new Map([...map].map(([k, v]) => [k, [...v.values()]]));
}

export function flashDecision(args: {
  incomingTargetId: string;
  focusedTargetId: string | null;
  valueChanged: boolean;
}): boolean {
  return (
    args.focusedTargetId !== null &&
    args.incomingTargetId === args.focusedTargetId &&
    args.valueChanged
  );
}

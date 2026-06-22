import type { PresenceState, RosterOccupant } from "./presence-types";

type RawPresence = Record<string, PresenceState[]>;

function flatten(raw: RawPresence): PresenceState[] {
  return Object.values(raw).flat();
}

/** One entry per user (multiple tabs merged); self flagged. */
export function toRoster(raw: RawPresence, selfUserId: string): RosterOccupant[] {
  const byUser = new Map<string, RosterOccupant>();
  for (const s of flatten(raw)) {
    if (byUser.has(s.userId)) continue;
    byUser.set(s.userId, {
      userId: s.userId,
      name: s.name,
      avatarUrl: s.avatarUrl,
      color: s.color,
      isSelf: s.userId === selfUserId,
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

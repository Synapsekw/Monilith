import type { MonoMemberMeta, MyMono, OrgMono } from "./types";

export type PersonRow = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};
export type RosterMember = PersonRow & { mono?: MonoMemberMeta };

/**
 * The board's member payload with the org's Monos appended, so People cells,
 * pickers and update authors resolve a Mono id with no extra read. Only the
 * viewer's own awake Mono is `directable` (Personal Monos spec §4).
 */
export function withMonoMembers(
  people: readonly PersonRow[],
  monos: readonly OrgMono[],
  myMono: MyMono | null,
): RosterMember[] {
  const nameOf = new Map(people.map((p) => [p.userId, p.fullName]));
  return [
    ...people,
    ...monos.map((m) => ({
      userId: m.userId,
      fullName: m.name,
      email: null,
      avatarUrl: null,
      mono: {
        color: m.color,
        ownerId: m.ownerId,
        ownerName: nameOf.get(m.ownerId) ?? null,
        directable:
          myMono !== null &&
          myMono.userId === m.userId &&
          myMono.brain !== "none",
      },
    })),
  ];
}

/** Who a picker may ADD: people, plus the viewer's own awake Mono. */
export function assignableMembers<T extends { mono?: MonoMemberMeta }>(
  members: readonly T[],
): T[] {
  return members.filter((m) => !m.mono || m.mono.directable);
}

/**
 * Plain copy for the People-cell Mono guard (`tg_cell_values_guard_mono_assign`):
 * 42501 when someone other than its owner adds a Mono, P0001 when the Mono is
 * asleep. A stale picker can still offer one, so the write fails like any other
 * cell write (rollback + toast) with these words. Any other error: null.
 */
export function monoAssignErrorMessage(error: {
  code?: string;
  message: string;
}): string | null {
  if (error.code === "42501" && /assign a Mono/i.test(error.message))
    return "Only its owner can assign a Mono.";
  if (error.code === "P0001" && /Mono is asleep/i.test(error.message))
    return "This Mono is asleep. Its owner can wake it in Settings.";
  return null;
}

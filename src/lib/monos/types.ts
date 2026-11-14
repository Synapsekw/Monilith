/** Client-safe shapes for personal Monos (no server-only imports). */

export type MonoBrain = "none" | "key" | "connected";
export type MonoKeyProvider = "anthropic" | "openai";

/** The caller's own Mono, brain included (owner-only read). */
export type MyMono = {
  userId: string;
  orgId: string;
  ownerId: string;
  name: string;
  color: string;
  brain: MonoBrain;
  keyProvider: MonoKeyProvider | null;
  lastSeenAt: string | null;
  createdAt: string;
};

/** Any Mono in the org, as every member may see it (no brain). */
export type OrgMono = {
  userId: string;
  ownerId: string;
  name: string;
  color: string;
};

/** What a member row carries when it is a Mono (cells, pickers, authorship). */
export type MonoMemberMeta = {
  color: string;
  ownerId: string;
  ownerName: string | null;
  /** The viewer's own awake Mono: the only Mono they may assign or mention. */
  directable: boolean;
};

export type MonoBoard = {
  boardId: string;
  name: string;
  accessLevel: "viewer" | "editor";
};

/** The internal address the magic-link mint needs (ADR decision-44). */
export function monoEmail(monoUserId: string): string {
  return `mono-${monoUserId}@monolith.internal`;
}

export function toBrain(value: string): MonoBrain {
  return value === "key" || value === "connected" ? value : "none";
}

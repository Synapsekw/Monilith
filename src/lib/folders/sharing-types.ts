export type FolderLevel = "viewer" | "editor";
export type FolderAccessHead = {
  count: number;
  memberIds: string[];
  canManage: boolean;
};
export type FolderAccessEntry = {
  userId: string;
  fullName: string | null;
  email?: string | null;
  avatarUrl: string | null;
  level: FolderLevel;
};
export type FolderInvitationEntry = {
  id: string;
  email: string;
  level: FolderLevel;
  state: "invited" | "awaiting_approval";
};
export type FolderCandidate = {
  userId: string;
  fullName: string | null;
  email?: string | null;
};
export type FolderAccessData = {
  canManage: boolean;
  myUserId: string;
  /** The member list was cut at the read limit. */
  membersTruncated: boolean;
  members: FolderAccessEntry[];
  invitations: FolderInvitationEntry[];
  candidates: FolderCandidate[];
};
export type InviteOutcome =
  { kind: "shared" } | { kind: "invited"; emailSent: boolean };

/**
 * Returned by moveBoardToFolder when the target folder has members and the move
 * is not confirmed yet. `needsConfirm` is the total member count of the target
 * folder (including the mover and people who can already read the board);
 * `truncated` means the member read was capped, so the count may be higher.
 */
export type MoveConfirm = { needsConfirm: number; truncated: boolean };

/** Cap on the avatar stack's first-paint read. */
export const FOLDER_ACCESS_HEAD_LIMIT = 50;

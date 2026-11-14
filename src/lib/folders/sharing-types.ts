export type FolderLevel = "viewer" | "editor";
export type FolderAccessHead = {
  count: number;
  memberIds: string[];
  canManage: boolean;
};
export type FolderAccessEntry = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
  level: FolderLevel;
};
export type FolderInvitationEntry = {
  id: string;
  email: string;
  level: FolderLevel;
  state: "invited" | "awaiting_approval";
};
export type FolderCandidate = { userId: string; fullName: string | null };
export type FolderAccessData = {
  canManage: boolean;
  myUserId: string;
  members: FolderAccessEntry[];
  invitations: FolderInvitationEntry[];
  candidates: FolderCandidate[];
};
export type InviteOutcome =
  { kind: "shared" } | { kind: "invited"; emailSent: boolean };

/** Cap on the avatar stack's first-paint read. */
export const FOLDER_ACCESS_HEAD_LIMIT = 50;

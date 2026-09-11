import type { ColumnOption } from "@/lib/validations/boards";

export type Settings = Record<string, unknown> & { options?: ColumnOption[] };

/** Member shape for the People editor — defined locally to avoid the
 * `server-only` import that `OrgMember` from `@/lib/boards/queries` carries. */
export type EditorMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type EditorProps<V> = {
  value: V | null;
  settings: Settings;
  onCommit: (value: V) => void;
  onCancel: () => void;
  /** Clear the cell entirely (deletes the row). Falls back to onCancel. */
  onClear?: () => void;
};

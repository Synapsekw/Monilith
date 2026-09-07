/**
 * What a batched create returns.
 *
 * Partial success is a SUCCESS with a report attached: an entry that fails is
 * recorded by `index` and the rest proceed. The caller is a model that can read
 * `errors` and retry precisely, and failing a whole batch for one bad name
 * would throw away work that already landed.
 *
 * It lives here, in the shared layer, rather than in whichever core file
 * happened to need it first — `core/group.ts`, `core/column.ts` and the
 * `create_item` handler all return it, and they are built in three separate
 * worktrees that must not import from one another.
 */
export type BatchResult<T> = {
  created: T[];
  errors: { index: number; error: string }[];
};

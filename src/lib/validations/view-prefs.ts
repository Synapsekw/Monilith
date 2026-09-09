import { z } from "zod";

/**
 * Per-user, per-board view arrangement.
 *
 * The DB stores this as an opaque `jsonb` blob, so this schema is the only
 * definition of its shape. It is applied at BOTH boundaries: before a write,
 * and again on read — a row written by an older client version must not be
 * trusted to match the current shape.
 */

/** Cap on each remembered id list, so a long-lived row cannot grow unbounded. */
export const MAX_PREF_IDS = 500;
/** Cap on the serialized filter query string. */
export const MAX_FILTER_QUERY_CHARS = 2000;

const uuid = z.string().uuid();
const idList = z.array(uuid).max(MAX_PREF_IDS);

/**
 * `.strict()` so an unrecognised key is rejected rather than silently stored —
 * a typo in a future field would otherwise persist forever as dead weight.
 */
export const boardViewPrefsStateSchema = z
  .object({
    /** Last active board view. */
    viewId: uuid.nullable().optional(),
    /** Groups the user has collapsed in the table view. */
    collapsedGroupIds: idList.optional(),
    /** Items whose sub-item rows the user has expanded. */
    expandedItemIds: idList.optional(),
    /**
     * The serialized URL query string for the filter params (q / people /
     * status / filter / sort). Stored as the URL form, not a parsed object, so
     * `serializeBoardFilter` / `parseBoardFilter` stay the only encoder and the
     * persisted form cannot drift from the URL form.
     */
    filterQuery: z.string().max(MAX_FILTER_QUERY_CHARS).optional(),
  })
  .strict();

export type BoardViewPrefsState = z.infer<typeof boardViewPrefsStateSchema>;

/** The same state with every field present — what the app actually renders from. */
export type ResolvedBoardViewPrefs = {
  viewId: string | null;
  collapsedGroupIds: string[];
  expandedItemIds: string[];
  filterQuery: string;
};

export const EMPTY_BOARD_VIEW_PREFS: ResolvedBoardViewPrefs = {
  viewId: null,
  collapsedGroupIds: [],
  expandedItemIds: [],
  filterQuery: "",
};

/**
 * Parse stored state, failing open. A malformed or unrecognised blob renders
 * the board with today's defaults rather than erroring — remembering an
 * arrangement is a convenience, never a precondition for showing the board.
 */
export function parseBoardViewPrefs(raw: unknown): ResolvedBoardViewPrefs {
  const parsed = boardViewPrefsStateSchema.safeParse(raw);
  if (!parsed.success) return EMPTY_BOARD_VIEW_PREFS;
  return {
    viewId: parsed.data.viewId ?? null,
    collapsedGroupIds: parsed.data.collapsedGroupIds ?? [],
    expandedItemIds: parsed.data.expandedItemIds ?? [],
    filterQuery: parsed.data.filterQuery ?? "",
  };
}

/** Server Action input boundary. */
export const saveBoardViewPrefsSchema = z
  .object({
    boardId: uuid,
    state: boardViewPrefsStateSchema,
  })
  .strict();

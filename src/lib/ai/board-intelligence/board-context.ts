import type { BoardPayload } from "@/lib/boards/queries";
import { parseColumnOptions } from "@/lib/boards/column-options";
import type { Member } from "@/lib/collaboration/activity";
import type { Signal } from "@/lib/boards/intelligence/types";

export type BoardContext = {
  boardId: string;
  orgId: string;
  items: Map<
    string,
    { id: string; name: string; groupId: string; parentId: string | null }
  >;
  columns: Map<
    string,
    { id: string; name: string; kind: string; options: Map<string, string> }
  >;
  members: Map<string, string>;
  /** The run's signals, in `SIGNAL_ORDER`. `toAction` reads them to resolve a
   *  `filter` on `overloaded` to the person it is about; empty is legitimate
   *  (apply-time re-validation builds a context with no run attached). */
  signals: readonly Signal[];
};

/** Everything validation, labelling and apply need to check a model-supplied
 *  id against the board — built once from the RLS-scoped payload. */
export function buildBoardContext(
  payload: BoardPayload,
  members: readonly Member[],
  signals: readonly Signal[] = [],
): BoardContext {
  return {
    boardId: payload.board.id,
    orgId: payload.board.org_id,
    items: new Map(
      payload.items.map((i) => [
        i.id,
        { id: i.id, name: i.name, groupId: i.group_id, parentId: i.parent_id },
      ]),
    ),
    columns: new Map(
      payload.columns.map((c) => [
        c.id,
        {
          id: c.id,
          name: c.name,
          kind: c.kind,
          options: new Map(
            parseColumnOptions(c.settings).map((o) => [o.id, o.label]),
          ),
        },
      ]),
    ),
    members: new Map(members.map((m) => [m.userId, m.fullName ?? "Someone"])),
    signals,
  };
}

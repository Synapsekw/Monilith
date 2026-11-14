import type { TimelineSpan } from "@/lib/boards/dates";
import { isLinkLate } from "@/lib/boards/schedule";
import type { DependencyContext } from "@/lib/boards/timeline-context";

export type ExternalLinkStub = {
  dependencyId: string;
  direction: "waiting_on" | "blocking";
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  endISO: string | null;
  late: boolean;
};

type Dep = { id: string; predecessor_id: string; successor_id: string };

/** Stubs for links with exactly one end local, keyed by the local item id. */
export function crossBoardStubs(args: {
  dependencies: readonly Dep[];
  localItemIds: ReadonlySet<string>;
  localSpans: ReadonlyMap<string, TimelineSpan | null>;
  context: DependencyContext;
  contextSpans: ReadonlyMap<string, TimelineSpan | null>;
}): Map<string, ExternalLinkStub[]> {
  const items = new Map(args.context.items.map((i) => [i.id, i]));
  const boards = new Map(args.context.boards.map((b) => [b.id, b]));
  const out = new Map<string, ExternalLinkStub[]>();
  for (const d of args.dependencies) {
    const predLocal = args.localItemIds.has(d.predecessor_id);
    const succLocal = args.localItemIds.has(d.successor_id);
    if (predLocal === succLocal) continue;
    const localId = predLocal ? d.predecessor_id : d.successor_id;
    const foreignId = predLocal ? d.successor_id : d.predecessor_id;
    const foreign = items.get(foreignId);
    const board = foreign ? boards.get(foreign.board_id) : undefined;
    if (!foreign || !board) continue;
    const fSpan = args.contextSpans.get(foreignId) ?? null;
    const lSpan = args.localSpans.get(localId) ?? null;
    const stub: ExternalLinkStub = {
      dependencyId: d.id,
      direction: predLocal ? "blocking" : "waiting_on",
      itemId: foreign.id,
      itemName: foreign.name,
      boardId: board.id,
      boardName: board.name,
      endISO: fSpan?.end ?? null,
      late: predLocal ? isLinkLate(lSpan, fSpan) : isLinkLate(fSpan, lSpan),
    };
    const list = out.get(localId);
    if (list) list.push(stub);
    else out.set(localId, [stub]);
  }
  return out;
}

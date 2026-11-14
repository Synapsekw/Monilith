import type { TimelineSpan } from "@/lib/boards/dates";
import { isLinkLate } from "@/lib/boards/schedule";
import type { DependencyContext } from "@/lib/boards/timeline-context";

export type DependencyEntry = {
  dependencyId: string;
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  endISO: string | null;
  late: boolean;
  local: boolean;
};

export function buildDependencyList(args: {
  itemId: string;
  dependencies: readonly {
    id: string;
    predecessor_id: string;
    successor_id: string;
  }[];
  localItems: readonly { id: string; name: string }[];
  localBoard: { id: string; name: string };
  localSpans: ReadonlyMap<string, TimelineSpan | null>;
  context: DependencyContext;
  contextSpans: ReadonlyMap<string, TimelineSpan | null>;
}): { waitingOn: DependencyEntry[]; blocking: DependencyEntry[] } {
  const local = new Map(args.localItems.map((i) => [i.id, i]));
  const foreign = new Map(args.context.items.map((i) => [i.id, i]));
  const boards = new Map(args.context.boards.map((b) => [b.id, b]));
  const mySpan = args.localSpans.get(args.itemId) ?? null;
  const waitingOn: DependencyEntry[] = [];
  const blocking: DependencyEntry[] = [];
  for (const d of args.dependencies) {
    const isSucc = d.successor_id === args.itemId;
    const isPred = d.predecessor_id === args.itemId;
    if (!isSucc && !isPred) continue;
    const otherId = isSucc ? d.predecessor_id : d.successor_id;
    let entry: Omit<DependencyEntry, "late"> | null = null;
    let otherSpan: TimelineSpan | null = null;
    const l = local.get(otherId);
    if (l) {
      otherSpan = args.localSpans.get(otherId) ?? null;
      entry = {
        dependencyId: d.id,
        itemId: l.id,
        itemName: l.name,
        boardId: args.localBoard.id,
        boardName: args.localBoard.name,
        endISO: otherSpan?.end ?? null,
        local: true,
      };
    } else {
      const f = foreign.get(otherId);
      const b = f ? boards.get(f.board_id) : undefined;
      if (!f || !b) continue;
      otherSpan = args.contextSpans.get(otherId) ?? null;
      entry = {
        dependencyId: d.id,
        itemId: f.id,
        itemName: f.name,
        boardId: b.id,
        boardName: b.name,
        endISO: otherSpan?.end ?? null,
        local: false,
      };
    }
    if (isSucc)
      waitingOn.push({ ...entry, late: isLinkLate(otherSpan, mySpan) });
    else blocking.push({ ...entry, late: isLinkLate(mySpan, otherSpan) });
  }
  return { waitingOn, blocking };
}

import type { BoardTemplate } from "@/lib/boards/templates";
import type { Json } from "@/types/database.types";

/** Fully-resolved seed payload handed to the create_board_from_template RPC. */
export type TemplatePayload = {
  groups: { id: string; name: string; color: string; position: number }[];
  columns: {
    id: string;
    kind: string;
    name: string;
    settings: Json;
    position: number;
  }[];
  items: {
    id: string;
    groupId: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
};

function isoFromToday(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Turn a code-defined BoardTemplate into a fully-resolved seed payload:
 * mints uuids for groups/columns/options/items, builds kind-shaped cell
 * values, and resolves date offsets to concrete ISO dates. Pure (no Supabase),
 * so it lives outside the "use server" actions module and stays unit-testable.
 */
export function buildTemplatePayload(template: BoardTemplate): TemplatePayload {
  const groupId = new Map<string, string>();
  const columnId = new Map<string, string>();
  // optionId maps are per-column: columnRef -> (optionRef -> uuid)
  const optionId = new Map<string, Map<string, string>>();

  const groups = template.groups.map((g, i) => {
    const id = crypto.randomUUID();
    groupId.set(g.ref, id);
    return { id, name: g.name, color: g.color, position: i };
  });

  const columns = template.columns.map((c, i) => {
    const id = crypto.randomUUID();
    columnId.set(c.ref, id);
    let settings: Json = {};
    if (c.options) {
      const m = new Map<string, string>();
      const options = c.options.map((o) => {
        const oid = crypto.randomUUID();
        m.set(o.ref, oid);
        return { id: oid, label: o.label, color: o.color };
      });
      optionId.set(c.ref, m);
      settings = { options };
    } else if (c.settings) {
      settings = { ...c.settings } as Json;
    }
    return { id, kind: c.kind, name: c.name, settings, position: i };
  });

  const items = template.items.map((item, i) => {
    const cells = Object.entries(item.cells).map(([colRef, tv]) => {
      const col = template.columns.find((c) => c.ref === colRef)!;
      let value: Json;
      switch (col.kind) {
        case "status":
          value = {
            optionId: optionId
              .get(colRef)!
              .get((tv as { optionRef: string }).optionRef)!,
          };
          break;
        case "dropdown":
          value = {
            optionIds: (tv as { optionRefs: string[] }).optionRefs.map(
              (r) => optionId.get(colRef)!.get(r)!,
            ),
          };
          break;
        case "date": {
          const d = tv as { dateOffset: number; endOffset?: number };
          value =
            d.endOffset === undefined
              ? { date: isoFromToday(d.dateOffset) }
              : {
                  date: isoFromToday(d.dateOffset),
                  end: isoFromToday(d.endOffset),
                };
          break;
        }
        case "numbers":
          value = { n: (tv as { n: number }).n };
          break;
        case "text":
          value = { text: (tv as { text: string }).text };
          break;
        default:
          value = {};
      }
      return { columnId: columnId.get(colRef)!, value };
    });
    return {
      id: crypto.randomUUID(),
      groupId: groupId.get(item.groupRef)!,
      name: item.name,
      position: i,
      cells,
    };
  });

  return { groups, columns, items };
}

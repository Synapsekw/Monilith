import type { Tables } from "@/types/database.types";

export type RelationLinkRow = Tables<"relation_links">;

/** A relation link as the UI consumes it (linked name resolved client-side). */
export type RelationLink = {
  id: string;
  itemId: string;
  columnId: string;
  linkedItemId: string;
  /** null when the target board is not readable by the caller (RLS-filtered). */
  linkedItemName: string | null;
  position: number;
};

export type RelationSettings = {
  targetBoardId: string;
  allowMultiple: boolean;
};

/** Sort links by stored position (stable for chip rendering). */
export function sortLinks(links: RelationLink[]): RelationLink[] {
  return [...links].sort((a, b) => a.position - b.position);
}

/** Collapsed-parent rollup label, e.g. "3 linked" / "1 linked" / "". */
export function relationRollup(links: RelationLink[]): string {
  const n = new Set(links.map((l) => l.linkedItemId)).size;
  return n === 0 ? "" : `${n} linked`;
}

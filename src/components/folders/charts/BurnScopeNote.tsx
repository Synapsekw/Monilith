import { MetaChip } from "@/components/ui/meta-chip";

/**
 * Honest scope caption for the planned-vs-completed panel.
 *
 * `folder_burn` buckets by (stage, week) only — a `BurnRow` carries no
 * `board_id` — so the chart is always folder-wide. Every other panel on the
 * Overview and Stages tabs narrows with the board dropdown, which made the
 * burn chart look like it had narrowed too. Rather than silently disagree
 * with the filter bar, the panel says so while a board filter is active.
 *
 * Renders nothing when no board filter is set (the chart's scope and the
 * page's scope agree, so there is nothing to explain).
 */
export function BurnScopeNote({ board }: { board: string | null }) {
  if (board === null) return null;
  return (
    <div data-testid="burn-scope-note" className="flex flex-col gap-1">
      <MetaChip label="Scope">All boards</MetaChip>
      <p className="text-muted-foreground text-xs">
        Planned vs completed is folder-wide — the board filter does not narrow
        it.
      </p>
    </div>
  );
}

import { CellRenderer } from "@/components/boards/cells";
import type { MirrorValue } from "@/lib/boards/mirror";
import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";

/** Target kinds that have no inline read-only renderer (CellRenderer returns
 * null for them — files/time_tracking are special-cased in BoardTable, and
 * relation/mirror are never valid mirror targets). Show a muted dash instead. */
const NON_RENDERABLE: ReadonlySet<ColumnKind> = new Set<ColumnKind>([
  "files",
  "time_tracking",
  "relation",
  "mirror",
]);

type TargetSettings = Record<string, unknown> & { options?: ColumnOption[] };

export type MirrorCellProps = {
  values: MirrorValue[];
  /** The mirrored (target) column's kind — drives which renderer is used. */
  targetKind: ColumnKind;
  /** The target column's settings (e.g. status options live here, not the mirror). */
  targetSettings: TargetSettings;
  /** Cap on visible mirrored values before collapsing into "+K more". */
  maxItems?: number;
};

/**
 * Read-only presentational cell for a mirror column. Delegates each mirrored
 * value to the target field kind's existing renderer (a mirrored status shows
 * the status pill, a mirrored date the formatted date, …) using the TARGET
 * column's settings. Values that are null (RLS-filtered or unset) are omitted;
 * an all-absent cell renders blank. Overflow past `maxItems` collapses into
 * "+K more", matching RelationCell. Non-renderable target kinds show a muted
 * dash. There is no editor — mirrors are never inline-edited.
 */
export function MirrorCell({
  values,
  targetKind,
  targetSettings,
  maxItems = 2,
}: MirrorCellProps) {
  if (NON_RENDERABLE.has(targetKind))
    return <span className="text-muted-foreground text-sm">—</span>;

  const present = values.filter((v) => v.value != null);
  if (present.length === 0) return <span className="text-sm" />;

  const visible = present.slice(0, maxItems);
  const overflow = present.length - visible.length;

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {visible.map((v) => (
        <span key={v.linkedItemId} className="min-w-0 truncate">
          <CellRenderer
            kind={targetKind}
            value={v.value}
            settings={targetSettings}
          />
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-muted-foreground shrink-0 text-xs">
          +{overflow} more
        </span>
      )}
    </span>
  );
}

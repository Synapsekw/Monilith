"use client";

import type { Column, Item } from "@/lib/boards/queries";
import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";
import { CellRenderer } from "@/components/boards/cells";
import { FlashHighlight } from "@/components/boards/presence/FlashHighlight";
import { PresenceRing } from "@/components/boards/presence/PresenceRing";
import { presenceTarget } from "@/lib/boards/presence-target";
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { FilesCell } from "@/components/boards/cells/FilesCell";
import { TimeTrackingCell } from "@/components/boards/cells/TimeTrackingCell";
import { RelationCell } from "@/components/boards/cells/RelationCell";
import { MirrorCell } from "@/components/boards/cells/MirrorCell";
import {
  mirrorValuesForCell,
  mirrorTargetColumnFor,
} from "@/lib/boards/mirror";
import { listRelationCandidates } from "@/lib/boards/relation-candidates";
import { type RelationLink } from "@/lib/boards/relations";
import { CellEditor } from "@/components/boards/cells/editors";
import {
  filesForCell,
  timeEntriesForCell,
  relationLinksForCell,
  type CacheCellValue,
} from "@/lib/boards/cache";
import type { CellControls } from "./shared";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };

/**
 * One configurable-column cell. Resting state renders the read-only
 * `CellRenderer` wrapped in a click/Enter-to-edit affordance; when active it
 * swaps to the kind's `CellEditor`. Commits write through `setCell`
 * (optimistically); an explicit clear (Status "Clear", emptied number/date,
 * empty multi-select) routes through `clearCellValue`, which deletes the row.
 */
export function EditableCell({
  item,
  column,
  value,
  controls,
  overdue = false,
  dependents,
}: {
  item: Item;
  column: Column;
  value: CacheCellValue["value"];
  controls: CellControls;
  /** Date cells only: past-due + incomplete (see @/lib/boards/overdue). */
  overdue?: boolean;
  /** Priority cells only: direct dependents of the item — see @/lib/boards/priority. */
  dependents?: number;
}) {
  const { editing, setEditing, setCell, clearCellValue, members } = controls;
  const isEditing =
    editing?.itemId === item.id && editing.columnId === column.id;
  const settings = (column.settings ?? {}) as Settings;
  const accessibleName = `${item.name} ${column.name}`;
  const target = presenceTarget.cell(item.id, column.id);
  // Broadcast the local user's focus on this cell while they're editing it; the
  // hook clears it on blur/unmount. Called unconditionally (once per cell) so it
  // stays valid across the kind-specific early returns below.
  usePresenceFocus({ viewKind: "table", targetId: target }, isEditing);

  // Files cells are not inline-edited like other kinds: they render a thumbnail
  // strip + upload affordance, and open a lightbox on click. Thumbnails use
  // icons (no signed URLs on load); preview URLs are minted on lightbox open.
  if (column.kind === "files") {
    const files = filesForCell(controls.cache, item.id, column.id);
    return (
      <div className="flex h-full items-center border-l px-3">
        <FilesCell
          files={files}
          previewUrls={{}}
          onOpen={(i) => controls.openFilesLightbox(files, i)}
          onUpload={(f) => controls.uploadColumnFile(item.id, column.id, f)}
        />
      </div>
    );
  }

  // Time-tracking cells need the board cache + timer callbacks — special-cased
  // like files; not routed through CellRenderer or the isEditing/inline branch.
  if (column.kind === "time_tracking") {
    const entries = timeEntriesForCell(controls.cache, item.id, column.id);
    const estimate =
      (value as { estimateSeconds?: number } | null)?.estimateSeconds ?? null;
    return (
      <div className="flex h-full items-center border-l px-3">
        <TimeTrackingCell
          entries={entries}
          estimateSeconds={estimate}
          currentUserId={controls.currentUserId}
          onStart={() => controls.startTimer(item.id, column.id)}
          onStop={(id) => controls.stopTimer(id)}
          onAddManual={(date, secs) =>
            controls.addManualEntry(item.id, column.id, date, secs)
          }
          onEdit={(id, date, secs) => controls.editEntry(id, date, secs)}
          onDelete={(id) => controls.deleteEntry(id)}
          onSetEstimate={(secs) =>
            controls.setEstimate(item.id, column.id, secs)
          }
        />
      </div>
    );
  }

  // Relation cells render linked-item chips + an RLS-scoped picker; links live
  // in relation_links (not cell_values), so they're special-cased like files.
  if (column.kind === "relation") {
    const links = relationLinksForCell(controls.cache, item.id, column.id);
    const relSettings = (column.settings ?? {}) as {
      target_board_id?: string;
      allow_multiple?: boolean;
    };
    const targetBoardId = relSettings.target_board_id ?? "";
    return (
      <div className="flex h-full items-center border-l px-1">
        <RelationCell
          links={links}
          allowMultiple={relSettings.allow_multiple ?? true}
          loadCandidates={(search) =>
            targetBoardId
              ? listRelationCandidates(targetBoardId, search)
              : Promise.resolve([])
          }
          onChange={(selection) => {
            const newLinks: RelationLink[] = selection.map((s, i) => ({
              id: `optimistic-${item.id}-${column.id}-${s.linkedItemId}`,
              itemId: item.id,
              columnId: column.id,
              linkedItemId: s.linkedItemId,
              linkedItemName: s.linkedItemName,
              position: i,
            }));
            controls.setRelationLinks({
              itemId: item.id,
              columnId: column.id,
              links: newLinks,
            });
          }}
        />
      </div>
    );
  }

  // Mirror cells reflect a target column's value across linked items; they are
  // strictly read-only (no editor) and derive from the mirror cache slices.
  if (column.kind === "mirror") {
    const values = mirrorValuesForCell(controls.cache, item.id, column);
    const target = mirrorTargetColumnFor(controls.cache, column);
    return (
      <div className="flex h-full items-center border-l px-3">
        {target ? (
          <MirrorCell
            values={values}
            targetKind={target.kind as ColumnKind}
            targetSettings={(target.settings ?? {}) as Record<string, unknown>}
          />
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="relative flex items-center border-l px-3">
        <CellEditor
          kind={column.kind}
          value={value}
          settings={settings}
          members={members}
          dependents={dependents}
          onCommit={(v) => {
            setCell({ itemId: item.id, columnId: column.id, value: v });
            setEditing(null);
          }}
          onClear={() => {
            clearCellValue({ itemId: item.id, columnId: column.id });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
        <PresenceRing target={target} />
        <FlashHighlight target={target} />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={accessibleName}
      onClick={() => setEditing({ itemId: item.id, columnId: column.id })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing({ itemId: item.id, columnId: column.id });
        }
      }}
      className="hover:bg-surface-muted focus-visible:ring-ring relative flex h-full cursor-pointer items-center truncate border-l px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      <CellRenderer
        kind={column.kind}
        value={value}
        settings={settings}
        members={members}
        overdue={overdue}
        dependents={dependents}
      />
      <PresenceRing target={target} />
      <FlashHighlight target={target} />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Kicker } from "@/components/ui/kicker";
import { EditableCell } from "@/components/boards/table/EditableCell";
import { useEditingCell } from "@/components/boards/table/editing-store";
import type { EditableCellControls } from "@/components/boards/table/shared";
import type { EditorMember } from "@/components/boards/cells/editors";
import { FilePreviewLightbox } from "@/components/boards/item-panel/FilePreviewLightbox";
import type { CacheAttachment, CacheCellValue } from "@/lib/boards/cache";
import {
  boardWorkRule,
  isDueColumn,
  isOverdue,
  isStatusValueComplete,
  localTodayISO,
} from "@/lib/boards/overdue";
import { useLoadedBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import {
  getAttachmentDownloadUrl,
  getAttachmentPreviewUrls,
} from "@/lib/collaboration/actions";

/**
 * "Fields": every column of the board with THIS item's value, edited in place
 * with the table's own cell (`EditableCell`), so each kind renders, edits and
 * goes read-only exactly as it does in a row.
 *
 * Data budget: 0 round-trips to open. Values come from the board cache a board
 * view already hydrated (`useLoadedBoardCache` never fetches); an edit is the
 * table's optimistic mutation (`useBoardMutations`), one Server Action per
 * commit, patched into the same cache, so the row behind the panel updates
 * with it. Only opening a Files preview asks the server (signed URLs).
 */
export function FieldsSection({
  itemId,
  boardId,
  canEdit,
  currentUserId,
  members,
}: {
  itemId: string;
  boardId: string;
  /** False = view only: values render, nothing that writes is offered. */
  canEdit: boolean;
  currentUserId: string;
  members: EditorMember[];
}) {
  const { data: cache } = useLoadedBoardCache(boardId);
  const mutations = useBoardMutations(boardId, currentUserId);
  const setEditing = useEditingCell((s) => s.setEditing);

  // Edit mode is keyed to this surface (`"panel"`), so the same cell in the
  // table under the sheet stays closed. Leaving the section (tab switch, panel
  // close, another item) must not leave a panel editor marked open.
  useEffect(
    () => () => {
      if (useEditingCell.getState().editing?.surface === "panel")
        setEditing(null);
    },
    [setEditing, itemId],
  );

  // Viewer-local "today" for the overdue tint, snapshotted at mount (same
  // purity idiom as the table row).
  const [todayISO] = useState(() => localTodayISO());

  // Files preview, as in the table: URLs are minted when a preview opens.
  const [lightbox, setLightbox] = useState<{
    files: CacheAttachment[];
    index: number;
  } | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const openFilesLightbox = useCallback(
    (files: readonly CacheAttachment[], index: number) => {
      const list = [...files];
      setLightbox({ files: list, index });
      setPreviewUrls({});
      setThumbUrls({});
      void getAttachmentPreviewUrls({
        attachmentIds: list.map((a) => a.id),
        thumb: { width: 96, height: 96 },
      }).then((res) => {
        if (res.ok) {
          setPreviewUrls(res.data.urls);
          setThumbUrls(res.data.thumbUrls);
        }
      });
    },
    [],
  );

  const columns = cache?.columns;
  const board = cache?.board;
  const workRule = useMemo(
    () => boardWorkRule(columns ?? [], board),
    [columns, board],
  );

  // This item's values by column: one pass over the cache per cache change,
  // only while the section is mounted.
  const cellValues = cache?.cellValues;
  const valueByColumn = useMemo(() => {
    const map = new Map<string, CacheCellValue["value"]>();
    for (const c of cellValues ?? [])
      if (c.item_id === itemId) map.set(c.column_id, c.value);
    return map;
  }, [cellValues, itemId]);

  const dependencies = cache?.dependencies;
  const dependents = useMemo(
    () =>
      (dependencies ?? []).filter((d) => d.predecessor_id === itemId).length,
    [dependencies, itemId],
  );

  const item = cache?.items.find((i) => i.id === itemId);
  // No board view has hydrated this board (or the item is gone): nothing to
  // show, and this section never fetches a board.
  if (!cache || !item) return null;

  const controls: EditableCellControls = {
    canEdit,
    setEditing,
    setCell: mutations.setCell,
    clearCellValue: mutations.clearCellValue,
    members,
    currentUserId,
    cache,
    workRule,
    uploadColumnFile: mutations.uploadColumnFile,
    openFilesLightbox,
    filesPreviewUrls: previewUrls,
    filesThumbUrls: thumbUrls,
    startTimer: mutations.startTimer,
    stopTimer: mutations.stopTimer,
    addManualEntry: mutations.addManualEntry,
    editEntry: mutations.editEntry,
    deleteEntry: mutations.deleteEntry,
    setEstimate: mutations.setEstimate,
    setRelationLinks: mutations.setRelationLinks,
  };

  const complete = isStatusValueComplete(
    workRule.statusColumn
      ? (valueByColumn.get(workRule.statusColumn.id) ?? null)
      : null,
    workRule,
  );

  return (
    <section aria-labelledby="item-fields-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="item-fields-heading">
          <Kicker index="BOARD">Fields</Kicker>
        </h3>
        {!canEdit && (
          <span className="text-muted-foreground text-xs">View only</span>
        )}
      </div>

      {cache.columns.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This board has no columns yet.
        </p>
      ) : (
        <dl>
          {cache.columns.map((column) => {
            const value = valueByColumn.get(column.id) ?? null;
            return (
              <div
                key={column.id}
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2"
              >
                <dt
                  className="text-muted-foreground truncate text-sm"
                  title={column.name}
                >
                  {column.name}
                </dt>
                {/* A fixed-height grid box: the cell (h-full at rest, auto
                    while its editor is open) always fills it. */}
                <dd className="grid h-9 min-w-0 *:min-w-0 pointer-coarse:h-11">
                  <EditableCell
                    item={item}
                    column={column}
                    value={value}
                    controls={controls}
                    surface="panel"
                    align="start"
                    overdue={
                      isDueColumn(workRule, column.id) &&
                      isOverdue(value, todayISO) &&
                      !complete
                    }
                    dependents={
                      column.kind === "priority" ? dependents : undefined
                    }
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {lightbox && (
        <FilePreviewLightbox
          attachments={lightbox.files}
          index={lightbox.index}
          previewUrls={previewUrls}
          // The preview offers Delete to the uploader; view only never gets it.
          currentUserId={canEdit ? currentUserId : ""}
          onIndexChange={(i) =>
            setLightbox((s) => (s ? { ...s, index: i } : s))
          }
          onClose={() => setLightbox(null)}
          onDownload={(a) => {
            void getAttachmentDownloadUrl({ attachmentId: a.id }).then(
              (res) => {
                if (res.ok) window.open(res.data.url, "_blank", "noopener");
              },
            );
          }}
          onDelete={(a) => {
            mutations.deleteColumnFile(a.id);
            setLightbox(null);
          }}
        />
      )}
    </section>
  );
}

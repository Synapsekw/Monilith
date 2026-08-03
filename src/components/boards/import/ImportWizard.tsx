"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewImport, commitImport } from "@/lib/boards/spreadsheet-actions";
import { MAX_ROWS, type ImportPreview } from "@/lib/boards/spreadsheet/types";
import type { BoardColumnRef } from "@/lib/boards/spreadsheet/match-columns";
import {
  buildCommitColumns,
  buildCommitGroups,
  buildCommitStructure,
  deriveSheetStateSafe,
  isEmptySheetState,
  orphanGridIndices,
  seedStructure,
  tableFor,
  type SheetState,
} from "./import-wizard-state";
import { UploadStep } from "./UploadStep";
import { MapStep } from "./MapStep";
import { StructureStep } from "./StructureStep";
import { ConfirmStep } from "./ConfirmStep";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Destination =
  | { type: "new"; workspaceId: string }
  | {
      type: "existing";
      boardId: string;
      boardColumns: BoardColumnRef[];
      groups: { id: string; name: string }[];
    };

const STEPS = [
  { n: 1 as const, label: "Upload" },
  { n: 2 as const, label: "Select & map" },
  { n: 3 as const, label: "Structure" },
  { n: 4 as const, label: "Confirm" },
];

function StepIndicator({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((s, i) => (
        <li key={s.n} className="flex items-center gap-2">
          {i > 0 ? <span className="text-muted-foreground">·</span> : null}
          <span
            className={cn(
              "flex items-center gap-1.5",
              s.n === step
                ? "text-foreground font-medium"
                : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-xs",
                s.n === step
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted",
              )}
            >
              {s.n}
            </span>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Pinned footer whose primary action tracks the current step: Upload has no
 * nav (upload auto-advances), Map/Structure show Next, Confirm shows Import. */
function WizardFooter({
  step,
  busy,
  nextDisabled,
  confirmDisabled,
  onBack,
  onNext,
  onConfirm,
}: {
  step: 1 | 2 | 3 | 4;
  busy: boolean;
  nextDisabled: boolean;
  confirmDisabled: boolean;
  onBack: () => void;
  onNext: () => void;
  onConfirm: () => void;
}) {
  if (step === 1) return null; // upload auto-advances; no footer nav
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t px-6 py-4">
      <Button type="button" variant="outline" onClick={onBack}>
        Back
      </Button>
      {step === 4 ? (
        <Button type="button" disabled={confirmDisabled} onClick={onConfirm}>
          {busy ? "Importing…" : "Import"}
        </Button>
      ) : (
        <Button type="button" disabled={nextDisabled} onClick={onNext}>
          Next
        </Button>
      )}
    </div>
  );
}

/**
 * Three-step "upload → map → confirm" wizard that replaces the retired v1
 * single-page import dialog. Both destination arms are wired up:
 * `destination.type === "new"` mints a brand-new board; `"existing"` appends
 * into one group of an existing board, auto-matching columns onto
 * `destination.boardColumns` (see `deriveSheetState`'s `boardColumns` arm).
 */
export function ImportWizard({
  destination,
  open,
  onOpenChange,
}: {
  destination: Destination;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheetStates, setSheetStates] = useState<Record<number, SheetState>>(
    {},
  );
  const [activeSheet, setActiveSheet] = useState(0);
  const [boardName, setBoardName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

  const boardColumns =
    destination.type === "existing" ? destination.boardColumns : undefined;

  function resetState() {
    setStep(1);
    setFileBase64(null);
    setFileName(null);
    setPreview(null);
    setSheetStates({});
    setActiveSheet(0);
    setBoardName("");
    setError(null);
    setBusy(false);
  }

  function handleDialogOpenChange(o: boolean) {
    if (!o) resetState();
    onOpenChange(o);
  }

  function handleFile(file: { name: string; base64: string }) {
    setError(null);
    setBusy(true);
    setFileBase64(file.base64);
    setFileName(file.name);

    previewImport({ fileBase64: file.base64, fileName: file.name })
      .then((res) => {
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setPreview(res.data);
        setBoardName(res.data.boardName);
        setActiveSheet(0);
        setSheetStates({
          0: deriveSheetStateSafe(
            res.data.sheets[0]?.grid ?? [],
            0,
            boardColumns,
          ),
        });
        setStep(2);
      })
      .catch((err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : "Unknown error");
      });
  }

  function handleSheetChange(i: number) {
    setActiveSheet(i);
    setSheetStates((prev) => {
      if (prev[i]) return prev;
      const grid = preview?.sheets[i]?.grid ?? [];
      // Safe variant: a blank worksheet yields the empty-sheet sentinel
      // instead of throwing mid-setState (MapStep renders it as an inline
      // "This sheet has no data" message).
      return { ...prev, [i]: deriveSheetStateSafe(grid, 0, boardColumns) };
    });
  }

  const activeSheetPreview = preview?.sheets[activeSheet];
  const activeState = sheetStates[activeSheet];
  const activeSheetEmpty = activeState ? isEmptySheetState(activeState) : false;

  const table = useMemo(() => {
    // The empty-sheet sentinel has no derivable table (`tableFor` throws on
    // a blank grid), and step 3 is unreachable for it anyway.
    if (!activeState || isEmptySheetState(activeState)) return null;
    return tableFor(activeSheetPreview?.grid ?? [], activeState);
  }, [activeSheetPreview, activeState]);

  // Commit hard-rejects a selected table above MAX_ROWS — so the warning is
  // a blocker, not a "we'll truncate for you" promise, and Next is gated on
  // it (see handleNext).
  const overRowCap = Boolean(
    activeSheetPreview && activeSheetPreview.rowCount > MAX_ROWS,
  );
  const rowCapWarning =
    overRowCap && activeSheetPreview
      ? `Sheet "${activeSheetPreview.name}" has ${activeSheetPreview.rowCount} rows, which exceeds the ${MAX_ROWS}-row import limit. Reduce the file to ${MAX_ROWS} rows or fewer to import it.`
      : null;

  const hasNameColumn = activeState
    ? activeState.columns.some((c) => c.include && c.role === "name")
    : false;

  // Step-3 (Structure) gate: subitem rows with no item above them in their
  // group block advancing to Confirm — commit would hard-reject them anyway.
  const structureBlocked =
    table && activeState
      ? orphanGridIndices(table, activeState).length > 0
      : false;

  function handleNext() {
    if (step === 2) {
      if (!hasNameColumn || activeSheetEmpty || overRowCap) return;
      if (!table) return;
      const existingGroups =
        destination.type === "existing" ? destination.groups : [];
      setSheetStates((prev) => ({
        ...prev,
        [activeSheet]: seedStructure(
          prev[activeSheet],
          table,
          destination.type,
          existingGroups,
        ),
      }));
      setStep(3);
      return;
    }
    if (step === 3) {
      if (structureBlocked) return;
      setStep(4);
    }
  }

  function handleConfirm() {
    if (!fileBase64 || !fileName || !preview || !activeState) return;
    // Same gates as handleNext — commitImport would hard-fail both cases.
    if (activeSheetEmpty || overRowCap) return;
    setError(null);

    startTransition(async () => {
      const res = await commitImport({
        fileBase64,
        fileName,
        sheetName: preview.sheets[activeSheet].name,
        headerRow: activeState.headerRow,
        excludedRows: activeState.excluded,
        columns: buildCommitColumns(activeState),
        groups: buildCommitGroups(activeState),
        structure: table ? buildCommitStructure(table, activeState) : [],
        destination:
          destination.type === "new"
            ? {
                type: "new",
                workspaceId: destination.workspaceId,
                boardName,
              }
            : {
                type: "existing",
                boardId: destination.boardId,
              },
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      onOpenChange(false);
      resetState();
      // The "new" arm lands on the freshly created board; the "existing" arm
      // is already on that board's page, so it only needs a data refresh —
      // no navigation (gotcha-09: never RSC-navigate for in-page data).
      if (destination.type === "new") {
        router.push(`/boards/${res.data.boardId}`);
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] flex-col gap-0 p-0 sm:max-w-[1400px]">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Import from file</DialogTitle>
          <StepIndicator step={step} />
        </DialogHeader>

        <div
          data-scroll-container
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
        >
          {step === 1 ? (
            <UploadStep busy={busy} error={error} onFile={handleFile} />
          ) : null}

          {step === 2 && preview && activeState ? (
            <div className="flex flex-col gap-2">
              <MapStep
                sheets={preview.sheets}
                activeSheet={activeSheet}
                onSheetChange={handleSheetChange}
                state={activeState}
                onStateChange={(next) =>
                  setSheetStates((prev) => ({
                    ...prev,
                    [activeSheet]: next,
                  }))
                }
                mode={destination.type}
                boardColumns={boardColumns}
                rowCapWarning={rowCapWarning}
              />
              {!hasNameColumn && !activeSheetEmpty ? (
                <p role="alert" className="text-destructive text-xs">
                  Mark a column as the item name (via its column menu) before
                  continuing.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 3 && preview && activeState && table ? (
            <StructureStep
              table={table}
              state={activeState}
              mode={destination.type}
              existingGroups={
                destination.type === "existing" ? destination.groups : []
              }
              onStateChange={(next) =>
                setSheetStates((prev) => ({ ...prev, [activeSheet]: next }))
              }
            />
          ) : null}

          {step === 4 &&
          preview &&
          activeSheetPreview &&
          activeState &&
          table ? (
            <ConfirmStep
              table={table}
              state={activeState}
              rowCount={activeSheetPreview.rowCount}
              previewedRowCount={activeSheetPreview.grid.length}
              destination={
                destination.type === "new"
                  ? {
                      type: "new",
                      boardName,
                      onBoardNameChange: setBoardName,
                    }
                  : { type: "existing" }
              }
              error={error}
            />
          ) : null}
        </div>

        <WizardFooter
          step={step}
          busy={busy || isPending}
          nextDisabled={
            step === 3
              ? structureBlocked
              : !hasNameColumn || activeSheetEmpty || overRowCap
          }
          confirmDisabled={
            isPending || (destination.type === "new" && boardName.trim() === "")
          }
          onBack={() =>
            setStep((s) => (s === 1 ? s : ((s - 1) as 1 | 2 | 3 | 4)))
          }
          onNext={handleNext}
          onConfirm={handleConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

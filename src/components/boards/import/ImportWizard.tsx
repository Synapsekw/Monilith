"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewImport, commitImport } from "@/lib/boards/spreadsheet-actions";
import { MAX_ROWS, type ImportPreview } from "@/lib/boards/spreadsheet/types";
import type { BoardColumnRef } from "@/lib/boards/spreadsheet/match-columns";
import {
  buildCommitColumns,
  deriveSheetState,
  tableFor,
  type SheetState,
} from "./import-wizard-state";
import { UploadStep } from "./UploadStep";
import { MapStep } from "./MapStep";
import { ConfirmStep } from "./ConfirmStep";
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
  { n: 3 as const, label: "Confirm" },
];

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
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

type GroupChoice = { groupId: string } | { newGroupName: string };

/** Default group choice for the existing-board confirm step: the board's
 * first group, or a fresh "Imported" group when it has none yet. */
function defaultGroupChoice(destination: Destination): GroupChoice {
  if (destination.type !== "existing") return { newGroupName: "Imported" };
  return destination.groups[0]
    ? { groupId: destination.groups[0].id }
    : { newGroupName: "Imported" };
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

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheetStates, setSheetStates] = useState<Record<number, SheetState>>(
    {},
  );
  const [activeSheet, setActiveSheet] = useState(0);
  const [boardName, setBoardName] = useState("");
  const [groupChoice, setGroupChoice] = useState<GroupChoice>(() =>
    defaultGroupChoice(destination),
  );
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
    setGroupChoice(defaultGroupChoice(destination));
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
          0: deriveSheetState(res.data.sheets[0]?.grid ?? [], 0, boardColumns),
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
      return { ...prev, [i]: deriveSheetState(grid, 0, boardColumns) };
    });
  }

  const activeSheetPreview = preview?.sheets[activeSheet];
  const activeState = sheetStates[activeSheet];

  const table = useMemo(() => {
    if (!activeState) return null;
    return tableFor(activeSheetPreview?.grid ?? [], activeState);
  }, [activeSheetPreview, activeState]);

  const rowCapWarning =
    activeSheetPreview && activeSheetPreview.rowCount > MAX_ROWS
      ? `Sheet "${activeSheetPreview.name}" has ${activeSheetPreview.rowCount} rows — only the first ${MAX_ROWS} will be imported.`
      : null;

  const hasNameColumn = activeState
    ? activeState.columns.some((c) => c.include && c.role === "name")
    : false;

  function handleNext() {
    if (!hasNameColumn) return;
    setStep(3);
  }

  function handleConfirm() {
    if (!fileBase64 || !fileName || !preview || !activeState) return;
    setError(null);

    startTransition(async () => {
      const res = await commitImport({
        fileBase64,
        fileName,
        sheetName: preview.sheets[activeSheet].name,
        headerRow: activeState.headerRow,
        excludedRows: activeState.excluded,
        columns: buildCommitColumns(activeState),
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
                group: groupChoice,
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
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Import from file</DialogTitle>
          <StepIndicator step={step} />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
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
                onBack={() => setStep(1)}
                onNext={handleNext}
              />
              {!hasNameColumn ? (
                <p role="alert" className="text-destructive text-xs">
                  Mark a column as the item name (via its column menu) before
                  continuing.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 3 && preview && activeState && table ? (
            <ConfirmStep
              table={table}
              state={activeState}
              destination={
                destination.type === "new"
                  ? {
                      type: "new",
                      boardName,
                      onBoardNameChange: setBoardName,
                    }
                  : {
                      type: "existing",
                      groups: destination.groups,
                      groupChoice,
                      onGroupChange: setGroupChoice,
                    }
              }
              error={error}
              pending={isPending}
              onBack={() => setStep(2)}
              onConfirm={handleConfirm}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

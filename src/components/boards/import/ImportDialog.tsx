"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { previewImport, commitImport } from "@/lib/boards/spreadsheet-actions";
import {
  IMPORTABLE_KINDS,
  type ImportPreview,
  type ImportableKind,
} from "@/lib/boards/spreadsheet/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ImportDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();

  // Stage: "pick" | "preview"
  const [stage, setStage] = useState<"pick" | "preview">("pick");

  // File state
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [boardName, setBoardName] = useState("");
  // kinds: per-column overrides (indexed to preview.columns)
  const [kinds, setKinds] = useState<ImportableKind[]>([]);

  // Error + pending
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setStage("pick");
    setFileBase64(null);
    setFileName(null);
    setPreview(null);
    setBoardName("");
    setKinds([]);
    setError(null);
  }

  function handleDialogOpenChange(o: boolean) {
    if (!o) resetState();
    onOpenChange(o);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setIsPreviewing(true);

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the "data:...;base64," prefix
      const base64 = result.replace(/^data:[^;]+;base64,/, "");
      setFileBase64(base64);
      setFileName(file.name);

      // Call previewImport
      previewImport({ fileBase64: base64, fileName: file.name })
        .then((res) => {
          setIsPreviewing(false);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          setPreview(res.data);
          setBoardName(res.data.boardName);
          setKinds(res.data.columns.map((c) => c.kind));
          setStage("preview");
        })
        .catch((err: unknown) => {
          setIsPreviewing(false);
          setError(err instanceof Error ? err.message : "Unknown error");
        });
    };
    reader.readAsDataURL(file);
  }

  function handleCreate() {
    if (!fileBase64 || !fileName || !preview) return;
    setError(null);

    const columnMappings = preview.columns.map((col, i) => {
      const kind = kinds[i] ?? col.kind;
      // Keep synthesized options only for status/dropdown kinds
      const keepOptions = kind === "status" || kind === "dropdown";
      return {
        header: col.header,
        kind,
        options: keepOptions ? col.options : [],
      };
    });

    startTransition(async () => {
      const res = await commitImport({
        fileBase64,
        fileName,
        workspaceId,
        boardName,
        columnMappings,
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      onOpenChange(false);
      resetState();
      router.push(`/boards/${res.data.boardId}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from file</DialogTitle>
          <DialogDescription>
            Upload an .xlsx or .csv file to create a new board from it.
          </DialogDescription>
        </DialogHeader>

        {/* Hidden file input — always rendered so tests can find it */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          onChange={handleFileChange}
          aria-label="Choose file"
        />

        {stage === "pick" && (
          <div className="flex flex-col items-center gap-4 py-6">
            {isPreviewing ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Analyzing file…
              </div>
            ) : (
              <>
                <p className="text-muted-foreground text-center text-sm">
                  Select an .xlsx or .csv file to preview and import.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file
                </Button>
              </>
            )}
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
          </div>
        )}

        {stage === "preview" && preview ? (
          <div className="flex flex-col gap-4">
            {/* Board name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-board-name">Board name</Label>
              <Input
                id="import-board-name"
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
                placeholder="My board"
              />
            </div>

            {/* Column mapping table */}
            <div className="overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="px-3 py-2 text-left font-medium">Column</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Sample values
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.columns.map((col, i) => (
                    <tr key={col.header} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{col.header}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Column type for ${col.header}`}
                          value={kinds[i] ?? col.kind}
                          onChange={(e) => {
                            const next = [...kinds];
                            next[i] = e.target.value as ImportableKind;
                            setKinds(next);
                          }}
                          className="border-input focus:border-ring focus:ring-ring/50 h-7 rounded-md border bg-transparent px-2 text-sm outline-none focus:ring-2"
                        >
                          {IMPORTABLE_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-muted-foreground px-3 py-2">
                        {col.sampleValues.slice(0, 3).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Sample rows */}
            {preview.sampleRows.length > 0 && (
              <details className="text-muted-foreground text-xs">
                <summary className="cursor-pointer font-medium select-none">
                  Preview rows ({preview.rowCount} total)
                </summary>
                <div className="mt-2 overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        {preview.columns.map((c) => (
                          <th
                            key={c.header}
                            className="px-2 py-1 text-left font-medium"
                          >
                            {c.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, ri) => (
                        <tr key={ri} className="border-b last:border-0">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* Dropped sheets + caveat notes */}
            {preview.droppedSheets.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Note: Only the first sheet was imported. Dropped sheets:{" "}
                {preview.droppedSheets.join(", ")}.
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Row order is preserved. Rows indented with ↳ are imported as
              subtasks of the item above them.
            </p>

            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleDialogOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isPending || !boardName.trim()}
                onClick={handleCreate}
              >
                {isPending ? "Creating…" : "Create board"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

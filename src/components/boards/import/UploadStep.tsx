"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_BYTES } from "@/lib/boards/spreadsheet/types";
import { cn } from "@/lib/utils";

const ACCEPTED_EXTENSIONS = [".xlsx", ".csv"];

function hasAcceptedExtension(name: string) {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function UploadStep({
  busy,
  error,
  onFile,
}: {
  busy: boolean;
  error: string | null;
  onFile: (file: { name: string; base64: string }) => void;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function processFile(file: File) {
    setLocalError(null);

    if (!hasAcceptedExtension(file.name)) {
      setLocalError("Only .xlsx and .csv files are supported.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError("File is too large. Maximum size is 5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.replace(/^data:[^;]+;base64,/, "");
      onFile({ name: file.name, base64 });
    };
    reader.readAsDataURL(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = "";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    processFile(file);
  }

  const displayError = localError ?? error;

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.csv"
        className="sr-only"
        onChange={handleInputChange}
        aria-label="Choose file"
      />

      {busy ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Analyzing file…
        </div>
      ) : (
        <div
          data-testid="upload-dropzone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex w-full flex-col items-center gap-3 rounded-md border border-dashed p-8 text-center transition-colors",
            dragActive ? "border-primary bg-accent" : "border-border",
          )}
        >
          <p className="text-muted-foreground text-sm">
            Drag and drop an .xlsx or .csv file here, or
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </Button>
        </div>
      )}

      {displayError ? (
        <p role="alert" className="text-destructive text-xs">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}

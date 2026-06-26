"use client";

import { useTransition, useState } from "react";
import { Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { exportBoard } from "@/lib/boards/spreadsheet-actions";
import type { ImportFormat } from "@/lib/boards/spreadsheet/types";

export function ExportMenu({ boardId }: { boardId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function triggerDownload(base64: string, mime: string, fileName: string) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExport(format: ImportFormat) {
    setError(null);
    startTransition(async () => {
      const result = await exportBoard({ boardId, format });
      if (result.ok) {
        triggerDownload(
          result.data.base64,
          result.data.mime,
          result.data.fileName,
        );
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Export"
            disabled={isPending}
          >
            <Download className="size-3.5" /> Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => handleExport("xlsx")}>
            Excel (.xlsx)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleExport("csv")}>
            CSV (.csv)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p role="alert" className="text-destructive mt-1 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { Link2, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Spec §5.1 header extras. Export prints canvas tabs only; RLS gates the shared link. */
export function HeaderActions({
  folderId,
  canExport,
}: {
  folderId: string;
  canExport: boolean;
}) {
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied");
    } catch {
      toast("Couldn't copy the link");
    }
  }
  return (
    <div className="flex items-center gap-2" data-print-hide>
      <Button type="button" variant="outline" size="sm" onClick={share}>
        <Link2 className="size-4" /> Share
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canExport}
        onClick={() => window.print()}
        title={canExport ? undefined : "Switch to a canvas tab to export"}
      >
        <Printer className="size-4" /> Export PDF
      </Button>
      <Button asChild size="sm">
        <Link href={`/ask?folder=${folderId}`}>
          <Sparkles className="size-4" /> Ask about this folder
        </Link>
      </Button>
    </div>
  );
}

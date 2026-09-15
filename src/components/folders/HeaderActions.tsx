"use client";

import Link from "next/link";
import { Link2, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CommandTab } from "./command-center-state";

/** Spec §5.1 header extras. Export prints the Overview only; RLS gates the shared link. */
export function HeaderActions({
  folderId,
  tab,
}: {
  folderId: string;
  tab: CommandTab;
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
        disabled={tab !== "overview"}
        onClick={() => window.print()}
        title={tab === "overview" ? undefined : "Switch to Overview to export"}
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

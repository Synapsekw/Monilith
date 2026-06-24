"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Lazy-load the wizard (and its action/SDK imports) only when needed.
const AiDashboardWizard = dynamic(
  () => import("./AiDashboardWizard").then((m) => m.AiDashboardWizard),
  { ssr: false },
);

export function GenerateWithAiButton({
  workspaceId,
}: {
  workspaceId?: string;
}) {
  const searchParams = useSearchParams();
  // Auto-open once when arriving with ?ai=1 (e.g. the review banner's
  // "Regenerate" action routes back here to reopen the wizard). Seeded from
  // the initial URL via a lazy initializer — no setState-in-effect — so later
  // navigations that drop the param don't force it back open.
  const [open, setOpen] = useState(() => searchParams.get("ai") === "1");

  if (!workspaceId) return null;

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Generate dashboard with AI"
              className="size-6"
              onClick={() => setOpen(true)}
            >
              <Sparkles className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Generate with AI</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {open ? (
        <AiDashboardWizard
          workspaceId={workspaceId}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}

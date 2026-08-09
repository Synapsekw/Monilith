"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { createReport, createReportFromTemplate } from "@/lib/reports/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ReportTemplateOption = { id: string; name: string };

/**
 * Start a new report on a board.
 *
 * The primary button stays a ONE-CLICK instant create — click, land in the
 * builder. Templates are an adjacent affordance, not a step in front of it: the
 * split trigger only exists when the org actually has templates, so a first-run
 * org sees exactly the button it saw before.
 */
export function CreateReportButton({
  boardId,
  templates = [],
}: {
  boardId: string;
  templates?: ReportTemplateOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function open(id: string) {
    router.push(`/reports/${id}`);
  }

  function createBlank() {
    start(async () => {
      const res = await createReport({
        name: "Status Report",
        scope: "board",
        boardId,
      });
      if (res.ok) open(res.data.id);
      else
        showMutationError("Couldn't create the report.", new Error(res.error));
    });
  }

  function createFrom(template: ReportTemplateOption) {
    start(async () => {
      const res = await createReportFromTemplate({
        templateId: template.id,
        name: template.name,
        scope: "board",
        boardId,
      });
      if (res.ok) open(res.data.id);
      else
        showMutationError(
          "Couldn't create the report from that template.",
          new Error(res.error),
        );
    });
  }

  if (templates.length === 0) {
    return (
      <Button type="button" disabled={pending} onClick={createBlank}>
        <Plus data-icon="inline-start" />
        New report
      </Button>
    );
  }

  return (
    <div className="flex items-center">
      <Button
        type="button"
        className="rounded-r-none"
        disabled={pending}
        onClick={createBlank}
      >
        <Plus data-icon="inline-start" />
        New report
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            className="rounded-l-none border-l"
            aria-label="Start from a template"
            disabled={pending}
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Start from a template</DropdownMenuLabel>
          {templates.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => createFrom(t)}>
              <span className="truncate">{t.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutGrid,
  Rocket,
  Megaphone,
  BarChart3,
  Plus,
  Upload,
  Sparkles,
} from "lucide-react";
import { createBoardFromTemplate } from "@/lib/boards/actions";
import { BOARD_TEMPLATES } from "@/lib/boards/templates";
import { ImportWizard } from "@/components/boards/import/ImportWizard";

// Lazy-load the AI wizard (and its action/SDK imports) only when needed.
const AiBoardWizard = dynamic(
  () =>
    import("@/components/boards/ai/AiBoardWizard").then((m) => m.AiBoardWizard),
  { ssr: false },
);
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  board: LayoutGrid,
  rocket: Rocket,
  megaphone: Megaphone,
  dashboard: BarChart3,
};

export function NewBoardDialog({
  workspaceId,
  collapsed = false,
}: {
  workspaceId?: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeOpen = useUIStore((s) => s.newBoardOpen);
  const setNewBoardOpen = useUIStore((s) => s.setNewBoardOpen);
  const [localOpen, setLocalOpen] = useState(false);
  const open = storeOpen || localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    if (!next) setNewBoardOpen(false);
  };
  const [templateId, setTemplateId] = useState("blank");
  const [name, setName] = useState("Blank board");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [importOpen, setImportOpen] = useState(false);
  // Auto-open the AI wizard once when arriving with ?ai=1 (the review banner's
  // "Regenerate" routes back here to reopen it). Seeded from the initial URL via
  // a lazy initializer so later navigations that drop the param don't reopen it.
  const [aiOpen, setAiOpen] = useState(() => searchParams.get("ai") === "1");

  function pick(id: string, defaultName: string) {
    setTemplateId(id);
    setName(defaultName);
  }

  function submit() {
    if (!workspaceId) return;
    setError(null);
    startTransition(async () => {
      const res = await createBoardFromTemplate({
        workspaceId,
        templateId,
        name,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.push(`/boards/${res.data.boardId}`);
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        {collapsed ? null : (
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="New board"
              className="size-6"
            >
              <Plus className="size-4" />
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>
              Pick a template to start from, then name your board.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            {BOARD_TEMPLATES.map((t) => {
              const Icon = ICONS[t.icon] ?? LayoutGrid;
              const selected = t.id === templateId;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pick(t.id, t.name)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
                    selected
                      ? "border-primary bg-accent"
                      : "border-border hover:bg-accent/50",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="size-4" />
                    {t.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t.description}
                  </span>
                </button>
              );
            })}
          </div>

          {workspaceId ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  setOpen(false);
                  setAiOpen(true);
                }}
                aria-label="Generate a board with AI"
              >
                <Sparkles className="size-4" />
                Generate with AI
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  setOpen(false);
                  setImportOpen(true);
                }}
              >
                <Upload className="size-4" />
                Import from file
              </Button>
            </div>
          ) : null}

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="board-name">Board name</Label>
              <Input
                id="board-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sprint backlog"
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? "Creating…" : "Create board"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {workspaceId ? (
        <ImportWizard
          destination={{ type: "new", workspaceId }}
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      ) : null}
      {workspaceId && aiOpen ? (
        <AiBoardWizard
          workspaceId={workspaceId}
          open={aiOpen}
          onOpenChange={setAiOpen}
        />
      ) : null}
    </>
  );
}

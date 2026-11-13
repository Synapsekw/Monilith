"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  LayoutGrid,
  Rocket,
  Megaphone,
  BarChart3,
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  board: LayoutGrid,
  rocket: Rocket,
  megaphone: Megaphone,
  dashboard: BarChart3,
};

/**
 * Everything of the "New board" dialog that is NOT its trigger: the template
 * picker + name form (the `DialogContent`), and the two follow-on wizards
 * (import from file, generate with AI).
 *
 * Rendered by `NewBoardDialog` INSIDE its `<Dialog>` root, as a lazy chunk
 * mounted on first open — so this module, `ImportWizard` and `BOARD_TEMPLATES`
 * stay out of the sidebar's (i.e. every app route's) first-load JS. It stays
 * mounted after the first open, so the picked template, typed name and wizard
 * state survive a close/reopen exactly as they did when it was eager.
 */
export function NewBoardDialogBody({
  workspaceId,
  setOpen,
  initialAiOpen,
}: {
  workspaceId?: string;
  /** Open/close the parent "New board" dialog (also clears the store flag). */
  setOpen: (open: boolean) => void;
  /** Whether the page was entered with `?ai=1` — see `NewBoardDialog`. */
  initialAiOpen: boolean;
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState("blank");
  const [name, setName] = useState("Blank board");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [importOpen, setImportOpen] = useState(false);
  // Seeded from the URL the shell was mounted with (`?ai=1`), not read here:
  // this body can mount long after that navigation.
  const [aiOpen, setAiOpen] = useState(initialAiOpen);

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
      // push only: the action's updateTag already refreshed the sidebar list
      // in its response, and the new board's page is fetched by the push.
      router.push(`/boards/${res.data.boardId}`);
    });
  }

  return (
    <>
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
                    : "border-border hover:bg-state-hover/50",
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

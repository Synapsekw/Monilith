"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { once, useEverOpened } from "@/lib/ui/lazy-dialog";
import { useUIStore } from "@/stores/ui";

// This component sits in the sidebar, i.e. in every app route's first-load JS.
// Only the trigger and the open state live here; the dialog's content — the
// template picker, `ImportWizard` and the AI wizard — is a code-split chunk
// fetched the first time the dialog opens (or a moment earlier, on trigger
// hover/focus). Same pattern as the on-demand dialogs in BoardHeader.tsx; the
// loader is memoised so the prefetch and the `dynamic` render share ONE
// in-flight `import()`.
const loadBody = once(() =>
  import("@/components/boards/NewBoardDialogBody").then(
    (m) => m.NewBoardDialogBody,
  ),
);
const NewBoardDialogBody = dynamic(loadBody, { ssr: false });

// A failed prefetch is swallowed; the real open retries through `dynamic`.
function prefetchBody() {
  loadBody().catch(() => {});
}

export function NewBoardDialog({
  workspaceId,
  collapsed = false,
}: {
  workspaceId?: string;
  collapsed?: boolean;
}) {
  const searchParams = useSearchParams();
  const storeOpen = useUIStore((s) => s.newBoardOpen);
  const setNewBoardOpen = useUIStore((s) => s.setNewBoardOpen);
  const [localOpen, setLocalOpen] = useState(false);
  const open = storeOpen || localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    if (!next) setNewBoardOpen(false);
  };
  // Auto-open the AI wizard once when arriving with ?ai=1 (the review banner's
  // "Regenerate" routes back here to reopen it). Seeded from the initial URL via
  // a lazy initializer so later navigations that drop the param don't reopen it.
  // The wizard lives in the lazy body, so `?ai=1` also mounts the body.
  const [aiRequested] = useState(() => searchParams.get("ai") === "1");
  // Mount on first open, then stay mounted: Radix can play the close animation
  // and the body keeps its state (picked template, name, wizard step).
  const bodyMounted = useEverOpened(open) || aiRequested;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {collapsed ? null : (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="New board"
            className="size-6"
            onPointerEnter={prefetchBody}
            onFocus={prefetchBody}
          >
            <Plus className="size-4" />
          </Button>
        </DialogTrigger>
      )}
      {/* Triggerless when collapsed: the ⌘K "New board" command still opens it
          through the store flag. */}
      {bodyMounted ? (
        <NewBoardDialogBody
          workspaceId={workspaceId}
          setOpen={setOpen}
          initialAiOpen={aiRequested}
        />
      ) : null}
    </Dialog>
  );
}

import { toast } from "sonner";

/**
 * Surface a failed mutation to the user via a toast. Callers that already roll
 * back optimistic cache/state own the visual revert; this is the user-visible
 * half — a mutation must never fail silently (stability-audit: silent failures).
 *
 * `action` is the human-readable headline ("Couldn't delete the widget — it was
 * restored."); `err.message` becomes the description. Shared across the board,
 * dashboard, and automation mutation surfaces so the copy/behavior stays uniform.
 */
export function showMutationError(action: string, err: Error): void {
  toast.error(action, { description: err.message });
}

/**
 * Success toast with an Undo action for a reversible destructive op (archive /
 * "move to Trash"). The 8s window is the approved undo grace period; clicking
 * Undo fires `onUndo` (the paired restore mutation).
 */
export function showUndoToast(message: string, onUndo: () => void): void {
  toast(message, {
    action: { label: "Undo", onClick: onUndo },
    duration: 8000,
  });
}

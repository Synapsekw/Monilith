"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import {
  deactivateUserAction,
  reactivateUserAction,
  resetUserPasswordAction,
  setUserPasswordAction,
  deleteUserAction,
} from "@/lib/platform/search-action";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFieldStatus } from "@/components/ui/field-status";
import { showMutationSuccess } from "@/lib/ui/mutation-toast";
import type { ActionResult } from "@/lib/actions/result";

/** Per-user actions for the admin Users page: reset email, set temp password,
 * suspend/reactivate, hard delete. Refreshes the route on success. */
export function UserRowActions({
  userId,
  email,
  banned,
}: {
  userId: string;
  email: string;
  banned: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  // One `error` state, but two dialogs — and only one is ever mounted, so each
  // gets its own id/description pair rather than sharing one element id.
  const pwStatus = useFieldStatus(error);
  const delStatus = useFieldStatus(error);

  /** For the two DIALOG actions: the dialog is on screen, so its message goes
   *  to the field it belongs to via `useFieldStatus`. */
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else {
        onOk?.();
        router.refresh();
      }
    });

  /** For the three DROPDOWN-ONLY actions. These fire with no dialog mounted, so
   *  routing their failure through `setError` put it in state that renders
   *  nowhere — a refused reset/suspend/reactivate looked identical to a
   *  successful one. There is no field to describe either, so the outcome
   *  announces as a toast, matching settings/danger-zone.tsx. `okMessage` is
   *  only for the action whose success is invisible (the reset email);
   *  suspend/reactivate flip the row's own status cell on `router.refresh()`,
   *  and that IS the feedback. */
  const runFromMenu = (fn: () => Promise<ActionResult>, okMessage?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong.");
        return;
      }
      if (okMessage) showMutationSuccess(okMessage);
      router.refresh();
    });

  return (
    <span className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label="User actions"
            disabled={pending}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              runFromMenu(
                () => resetUserPasswordAction(userId),
                `Password reset email sent to ${email}.`,
              )
            }
          >
            Send password reset email
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setError(null);
              setPassword("");
              setPwOpen(true);
            }}
          >
            Set temporary password…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {banned ? (
            <DropdownMenuItem
              onSelect={() => runFromMenu(() => reactivateUserAction(userId))}
            >
              Reactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => runFromMenu(() => deactivateUserAction(userId))}
            >
              Suspend
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setError(null);
              setConfirmEmail("");
              setDelOpen(true);
            }}
          >
            Delete user…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Set temporary password */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set temporary password</DialogTitle>
            <DialogDescription>
              {email} will be required to choose a new password at next login.
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            aria-label="New temporary password"
            {...pwStatus.controlProps}
            className="bg-surface focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          {error && (
            <p {...pwStatus.messageProps} className="text-destructive text-xs">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPwOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              disabled={pending || password.length < 8}
              onClick={() =>
                run(
                  () => setUserPasswordAction(userId, password),
                  () => setPwOpen(false),
                )
              }
            >
              Set password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hard delete */}
      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              This permanently deletes {email} and all of their data. Type the
              email to confirm.
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={email}
            aria-label="Type the user's email to confirm deletion"
            {...delStatus.controlProps}
            className="bg-surface focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          {error && (
            <p {...delStatus.messageProps} className="text-destructive text-xs">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDelOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending || confirmEmail !== email}
              onClick={() =>
                run(
                  () => deleteUserAction(userId),
                  () => setDelOpen(false),
                )
              }
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}

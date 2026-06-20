"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

type Result = { ok: boolean; error?: string };

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

  const run = (fn: () => Promise<Result>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else {
        onOk?.();
        router.refresh();
      }
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
            onSelect={() => run(() => resetUserPasswordAction(userId))}
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
              onSelect={() => run(() => reactivateUserAction(userId))}
            >
              Reactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => run(() => deactivateUserAction(userId))}
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
            className="bg-surface focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          {error && (
            <p role="alert" className="text-destructive text-xs">
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
            className="bg-surface focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          {error && (
            <p role="alert" className="text-destructive text-xs">
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

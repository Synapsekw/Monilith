"use client";

import { useId, useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import { deleteOwnAccount } from "@/lib/account/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFieldStatus } from "@/components/ui/field-status";

/**
 * Deleting your account is irreversible and it moves your colleagues' view of
 * your work to someone else, so it sits behind a type-your-email confirm — the
 * same pattern as the platform admin delete (`admin/user-row-actions.tsx`). A
 * `Dialog` rather than an `AlertDialog` because the confirm input needs focus
 * management that an alert dialog's action buttons fight.
 *
 * The typed-match gate here is only an accident guard; the server re-verifies the
 * email against the session. Failures render IN PLACE rather than as a toast: the
 * sole-owner refusal is a paragraph the user has to read and act on, and a toast
 * that disappears while the dialog is still open is exactly the wrong shape for it.
 *
 * Keystone: monochrome chrome, `text-destructive` for the danger affordance,
 * hairline that brightens (never thickens) on hover, and the destructive state
 * carried by text + placement, not colour alone.
 */
export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputId = useId();
  // Replaces a hand-rolled id + aria-invalid + aria-describedby + role trio
  // with the shared helper, so this field states the same contract as every
  // other one.
  const errorStatus = useFieldStatus(error);

  const typed = confirm.trim();
  const matches = typed.toLowerCase() === email.toLowerCase();

  function submit() {
    setError(null);
    start(async () => {
      // On success the action redirects, so control never returns here.
      const res = await deleteOwnAccount({ confirmEmail: typed });
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive border-destructive/40 hover:border-destructive/60 hover:bg-destructive/10"
        onClick={() => {
          // Reopening always starts clean — a stale error or half-typed email
          // from a previous attempt would be actively misleading here.
          setConfirm("");
          setError(null);
          setOpen(true);
        }}
      >
        Delete account
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert
                className="text-destructive size-4 shrink-0"
                aria-hidden
              />
              Delete your account?
            </DialogTitle>
            <DialogDescription>
              This permanently erases your profile, email address, avatar,
              notifications and tracked time. Boards, items, files and updates
              you created stay with your organization — they transfer to an
              owner, and updates you wrote are no longer attributed to you. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={inputId}>
              Type your email address to confirm deletion
            </Label>
            <Input
              id={inputId}
              type="email"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={email}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              {...errorStatus.controlProps}
            />
            {error ? (
              <p
                {...errorStatus.messageProps}
                className="text-destructive text-xs leading-relaxed"
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={submit}
              disabled={pending || !matches}
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

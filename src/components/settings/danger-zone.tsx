"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { leaveOrg } from "@/lib/org/actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Leaving is destructive and not self-reversing — you need a fresh invite to
 * get back in — so it sits behind a confirm.
 *
 * The sole-owner refusal is decided by the server action, not here; this
 * component's only job on failure is to show what the server said instead of
 * swallowing it.
 */
export function DangerZone({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function confirmLeave() {
    start(async () => {
      const res = await leaveOrg({ orgId });
      if (res.ok) {
        setOpen(false);
        router.push("/home");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive border-destructive/40 hover:bg-destructive/10"
        onClick={() => setOpen(true)}
      >
        Leave organization
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this organization?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll lose access to {orgName} and everything in it. An
              owner or admin has to invite you again to get back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog mounted while the action runs so the pending
                // label is visible and a failure can be reported in place.
                e.preventDefault();
                confirmLeave();
              }}
              disabled={pending}
            >
              {pending ? "Leaving…" : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

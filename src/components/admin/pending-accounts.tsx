"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveUserAction,
  rejectUserAction,
} from "@/lib/platform/search-action";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
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
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { PlatformUser } from "@/lib/platform/queries";
import type { ActionResult } from "@/lib/actions/result";

/** Email, signup date, actions. There is no Organizations column: a pending
 *  account can never belong to an organization. The last column holds two
 *  labelled buttons instead of one icon menu. */
const PENDING_ROW_GRID = "grid grid-cols-[2fr_0.8fr_auto] gap-3";

/** Signup date only. Locale and zone are pinned so the server render and the
 *  hydrated client produce the same string (see lib/datetime/format.ts). */
const signedUp = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/**
 * New accounts waiting for a platform admin. Renders nothing when the list is
 * empty. Approve and Reject are Server Actions; on success the route refreshes
 * and the row leaves the list, which is the feedback.
 */
export function PendingAccounts({
  accounts,
  total,
}: {
  accounts: PlatformUser[];
  /** Exact number of waiting accounts (the list itself is capped). */
  total?: number;
}) {
  if (accounts.length === 0) return null;
  const count = Math.max(total ?? accounts.length, accounts.length);
  const capped = count > accounts.length;
  return (
    <section
      aria-labelledby="pending-accounts-title"
      className="bg-surface overflow-hidden rounded-lg border"
    >
      <div className="flex items-baseline gap-2 border-b px-4 py-3">
        <h2
          id="pending-accounts-title"
          className="text-foreground text-sm font-medium"
        >
          Waiting for approval
        </h2>
        <span className="text-muted-foreground text-sm tabular-nums">
          {count}
        </span>
        {capped ? (
          <span className="text-muted-foreground text-xs">
            Showing the newest {accounts.length}
          </span>
        ) : null}
        <span className="text-kicker ml-auto hidden text-xs sm:inline">
          New accounts can&apos;t join an organization until approved
        </span>
      </div>
      <div className={`${PENDING_ROW_GRID} border-b px-4 py-2.5`}>
        <Kicker>Email</Kicker>
        <Kicker>Signed up</Kicker>
        <span />
      </div>
      {accounts.map((a) => (
        <PendingRow key={a.id} account={a} />
      ))}
    </section>
  );
}

function PendingRow({ account }: { account: PlatformUser }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const email = account.email ?? "this account";

  const run = (
    fn: () => Promise<ActionResult>,
    failure: string,
    onDone?: () => void,
  ) =>
    start(async () => {
      const r = await fn();
      onDone?.();
      if (!r.ok) {
        showMutationError(
          failure,
          new Error(r.error ?? "Something went wrong."),
        );
        return;
      }
      router.refresh();
    });

  return (
    <div
      className={`${PENDING_ROW_GRID} items-center border-b px-4 py-3 text-sm last:border-b-0`}
    >
      <span className="text-foreground truncate">{account.email ?? "—"}</span>
      <time
        dateTime={account.createdAt}
        className="text-muted-foreground tabular-nums"
      >
        {signedUp.format(new Date(account.createdAt))}
      </time>
      <span className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Reject ${email}`}
          disabled={pending}
          onClick={() => setConfirmOpen(true)}
        >
          Reject
        </Button>
        <Button
          size="sm"
          aria-label={`Approve ${email}`}
          disabled={pending}
          onClick={() =>
            run(
              () => approveUserAction(account.id),
              `Couldn't approve ${email}.`,
            )
          }
        >
          {pending ? "Saving…" : "Approve"}
        </Button>
      </span>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this account?</AlertDialogTitle>
            <AlertDialogDescription>
              {email} won&apos;t be able to join any organization. You can still
              approve it later from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                // Keep the dialog mounted while the action runs so the pending
                // state is visible; it closes once the result is in.
                e.preventDefault();
                run(
                  () => rejectUserAction(account.id),
                  `Couldn't reject ${email}.`,
                  () => setConfirmOpen(false),
                );
              }}
            >
              {pending ? "Rejecting…" : "Reject account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

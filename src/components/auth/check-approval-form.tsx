"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { checkApproval } from "@/app/pending-approval/actions";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";

/** "Check again": posts to the Server Action; no polling. While the account is
 * still waiting the action returns ok, the page re-renders, and a short line
 * confirms the check ran. For a rejected account the page message itself is
 * the feedback, so the line is not shown. */
export function CheckApprovalForm({
  rejected = false,
}: {
  rejected?: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(() => checkApproval(), null);
  return (
    <form action={formAction} className="space-y-3">
      {state && !state.ok ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      ) : null}
      {state?.ok && !rejected ? (
        <p role="status" className="text-muted-foreground text-sm">
          Still waiting for approval.
        </p>
      ) : null}
      <Button
        type="submit"
        className="shadow-glow-primary w-full"
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        Check again
      </Button>
    </form>
  );
}

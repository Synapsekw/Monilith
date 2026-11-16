"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { signOutEverywhere } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

/**
 * Sign out of every device and disconnect every connected app. The action
 * redirects to /login on success, so there is deliberately no success state to
 * render here — it only ever returns a result when something failed, and that
 * must be shown: a silent failure reads as "everything is signed out".
 */
export function SignOutEverywhereButton() {
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await signOutEverywhere();
          if (res && !res.ok) toast.error(res.error);
        })
      }
    >
      {pending ? "Signing out…" : "Sign out everywhere"}
    </Button>
  );
}

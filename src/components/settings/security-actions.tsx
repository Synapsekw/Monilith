"use client";

import { useTransition } from "react";
import { signOutEverywhere } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

/**
 * Sign out of every device. The action redirects to /login on success, so there
 * is deliberately no success state to render here.
 */
export function SignOutEverywhereButton() {
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => start(() => void signOutEverywhere())}
    >
      {pending ? "Signing out…" : "Sign out everywhere"}
    </Button>
  );
}

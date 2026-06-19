"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deactivateUserAction,
  reactivateUserAction,
} from "@/lib/platform/search-action";
import { Button } from "@/components/ui/button";

/** Ban/unban buttons for a user row on the (server-rendered) Users page.
 * Refreshes the route on success so the server-rendered status updates. */
export function UserRowActions({
  userId,
  banned,
}: {
  userId: string;
  banned: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: (id: string) => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn(userId);
      if (!r.ok) alert(r.error ?? "Something went wrong.");
      else router.refresh();
    });

  return (
    <span className="flex justify-end">
      {banned ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(reactivateUserAction)}
        >
          Unban
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(deactivateUserAction)}
        >
          Ban
        </Button>
      )}
    </span>
  );
}

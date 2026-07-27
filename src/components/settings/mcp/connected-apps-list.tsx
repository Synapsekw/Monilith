"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeConnectionAction } from "@/lib/mcp/oauth/connections-actions";
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

export type Connection = {
  id: string;
  clientName: string;
  createdAt: string;
};

/**
 * Apps holding a live MCP token.
 *
 * Replaces ConnectedAppsSection, which submitted an inline `form action` and
 * threw away the ActionResult — a failed revoke rendered identically to a
 * successful one, so a user could believe they had cut off access when they
 * had not. Here the result is awaited and reported.
 */
export function ConnectedAppsList({
  connections,
}: {
  connections: Connection[];
}) {
  const [target, setTarget] = useState<Connection | null>(null);
  const [pending, start] = useTransition();

  if (connections.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-sm">
        No apps connected via MCP yet. Follow the steps above to connect one.
      </p>
    );
  }

  function confirmRevoke() {
    if (!target) return;
    const name = target.clientName;
    const id = target.id;
    start(async () => {
      const res = await revokeConnectionAction(id);
      if (res.ok) {
        toast.success(`${name} can no longer access your account.`);
        setTarget(null);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <ul className="space-y-2 py-4">
        {connections.map((c) => (
          <li
            key={c.id}
            className="border-border hover:border-border-hover flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm font-medium">
                {c.clientName}
              </p>
              <p className="text-muted-foreground text-xs">
                Connected{" "}
                {new Date(c.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => setTarget(c)}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {target?.clientName}&apos;s access?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It will immediately lose access to your Monolith boards. You can
              connect it again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog mounted while the action runs so the pending
                // label shows and a failure can be reported in place.
                e.preventDefault();
                confirmRevoke();
              }}
              disabled={pending}
            >
              {pending ? "Revoking…" : "Revoke access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

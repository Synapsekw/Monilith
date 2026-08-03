"use client";

import { useState, useTransition } from "react";
import type { Database } from "@/types/database.types";
import {
  setMemberRole,
  removeMember,
  deactivateMember,
  reactivateMember,
  resetMemberPassword,
} from "@/lib/org/admin-actions";
import { platformSetOrgRole } from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/actions/result";
import { StatusPill } from "@/components/ui/status-pill";

type Role = Database["public"]["Enums"]["org_role"];

export type Member = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  deactivated_at: string | null;
};

const ROLES: Role[] = ["owner", "admin", "member", "guest"];

export function MembersTable({
  orgId,
  members,
  currentUserId,
  currentUserRole,
  mode = "org",
}: {
  orgId: string;
  members: Member[];
  currentUserId: string;
  currentUserRole: Role;
  mode?: "org" | "platform";
}) {
  const [pending, start] = useTransition();
  // Minimal inline error surface — the project has no toast primitive yet
  // (no sonner / use-toast in src/components/ui). Mirrors timezone-form's
  // inline-message pattern; keyed by the row that failed.
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );

  const run = (id: string, fn: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError({ id, message: res.error });
    });

  const canManage = (target: Member) => {
    if (mode === "platform") return true; // platform admin manages anyone
    if (currentUserRole === "owner") return true;
    // admin: cannot touch owners/admins
    return target.role !== "owner" && target.role !== "admin";
  };

  const changeRole = (m: Member, role: Role) =>
    run(m.user_id, () =>
      mode === "platform"
        ? platformSetOrgRole({ orgId, userId: m.user_id, role })
        : setMemberRole({ orgId, userId: m.user_id, role }),
    );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-border border-b text-left text-xs font-medium">
            <tr>
              <th className="py-2 pr-3 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="py-2 pl-3" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {members.map((m) => {
              const isSelf = m.user_id === currentUserId;
              const locked = !canManage(m) || pending;
              const deactivated = m.deactivated_at !== null;
              return (
                <tr key={m.user_id}>
                  <td className="py-2.5 pr-3 align-middle">
                    <div className="text-foreground font-medium">
                      {m.full_name ?? "—"}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {m.email}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <select
                      aria-label={`Role for ${m.email ?? m.user_id}`}
                      defaultValue={m.role}
                      disabled={
                        locked ||
                        (mode === "org" && isSelf && m.role === "owner")
                      }
                      onChange={(e) => changeRole(m, e.target.value as Role)}
                      className={cn(
                        "border-border bg-background text-foreground hover:bg-state-hover hover:border-border-hover focus-visible:ring-ring/50 focus-visible:border-ring rounded-md border px-2 py-1 text-xs capitalize transition-colors",
                        "focus-visible:ring-3 focus-visible:outline-none",
                        "disabled:pointer-events-none disabled:opacity-50",
                      )}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r} className="capitalize">
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <StatusPill
                      color={deactivated ? "gray" : "green"}
                      variant="soft"
                    >
                      {deactivated ? "Deactivated" : "Active"}
                    </StatusPill>
                  </td>
                  <td className="py-2.5 pl-3 align-middle">
                    <div className="flex flex-wrap justify-end gap-1">
                      {deactivated ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={locked}
                          onClick={() =>
                            run(m.user_id, () =>
                              reactivateMember({ orgId, userId: m.user_id }),
                            )
                          }
                        >
                          Reactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={locked || isSelf}
                          onClick={() =>
                            run(m.user_id, () =>
                              deactivateMember({ orgId, userId: m.user_id }),
                            )
                          }
                        >
                          Deactivate
                        </Button>
                      )}
                      {mode === "org" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={locked}
                          onClick={() =>
                            run(m.user_id, () =>
                              resetMemberPassword({ orgId, userId: m.user_id }),
                            )
                          }
                        >
                          Reset password
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={locked || isSelf}
                        onClick={() =>
                          run(m.user_id, () =>
                            removeMember({ orgId, userId: m.user_id }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    {error?.id === m.user_id && (
                      <p
                        role="alert"
                        className="text-destructive mt-1 text-right text-xs"
                      >
                        {error.message}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

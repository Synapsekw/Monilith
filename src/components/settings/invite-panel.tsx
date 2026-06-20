"use client";

import { useState, useTransition } from "react";
import { inviteMember, revokeInvite } from "@/lib/org/admin-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Invite = {
  id: string;
  email: string;
  role: string;
  status: "pending" | "declined";
  created_at: string;
};

const ROLES = ["member", "admin", "guest"] as const;

export function InvitePanel({
  orgId,
  invites,
}: {
  orgId: string;
  invites: Invite[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [pending, start] = useTransition();
  // Minimal inline error surface (no toast primitive in the project yet).
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await inviteMember({ orgId, email, role });
            if (!r.ok) setError(r.error);
            else setEmail("");
          });
        }}
      >
        <Input
          type="email"
          required
          placeholder="name@company.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          aria-label="Invite email"
          className="min-w-0 flex-1"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Invite role"
          className={cn(
            "border-border bg-background text-foreground hover:bg-accent focus-visible:ring-ring/50 focus-visible:border-ring h-9 rounded-md border px-3 text-sm capitalize transition-colors",
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
        <Button type="submit" disabled={pending}>
          {pending ? "Inviting…" : "Invite"}
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      <ul className="divide-border divide-y text-sm">
        {invites.length === 0 && (
          <li className="text-muted-foreground py-2.5">No pending invites.</li>
        )}
        {invites.map((i) => (
          <li
            key={i.id}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <span className="min-w-0 truncate">
              <span className="text-foreground">{i.email}</span>
              <span className="text-muted-foreground capitalize">
                {" "}
                · {i.role}
              </span>
              {i.status === "declined" && (
                <span className="text-muted-foreground"> · Declined</span>
              )}
            </span>
            {i.status === "declined" ? (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await inviteMember({
                      orgId,
                      email: i.email,
                      role: i.role,
                    });
                    if (!r.ok) setError(r.error);
                  })
                }
              >
                Re-invite
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive shrink-0"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await revokeInvite({ inviteId: i.id });
                    if (!r.ok) setError(r.error);
                  })
                }
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

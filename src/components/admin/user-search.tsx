"use client";

import { useState, useTransition } from "react";
import {
  searchUsersAction,
  deactivateUserAction,
  reactivateUserAction,
} from "@/lib/platform/search-action";
import type { PlatformUser } from "@/lib/platform/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ActionResult = { ok: true; data: unknown } | { ok: false; error: string };

export function UserSearch() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PlatformUser[]>([]);
  const [searched, setSearched] = useState(false);
  // Inline error surface — the project has no toast primitive yet; mirrors
  // members-table / timezone-form. Keyed by the user row that failed.
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [pending, start] = useTransition();

  const search = () => {
    setError(null);
    start(async () => {
      const result = await searchUsersAction(q);
      setRows(result);
      setSearched(true);
    });
  };

  const runBan = (id: string, fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError({ id, message: res.error });
    });

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by email…"
          aria-label="Search users by email"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || q.trim() === ""}>
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>

      {searched && rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No matching users.</p>
      ) : rows.length > 0 ? (
        <ul className="divide-border bg-surface divide-y rounded-md border text-sm">
          {rows.map((u) => (
            <li key={u.id} className="flex flex-col gap-1 px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-foreground truncate">
                    {u.email ?? u.id}
                    {u.bannedUntil ? (
                      <span className="text-destructive ml-2 text-xs">
                        banned
                      </span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {u.orgNames.length
                      ? u.orgNames.join(" · ")
                      : "No organizations"}
                  </div>
                </div>
                <span className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      runBan(u.id, () => deactivateUserAction(u.id))
                    }
                  >
                    Ban
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      runBan(u.id, () => reactivateUserAction(u.id))
                    }
                  >
                    Unban
                  </Button>
                </span>
              </div>
              {error?.id === u.id && (
                <p role="alert" className="text-destructive text-right text-xs">
                  {error.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

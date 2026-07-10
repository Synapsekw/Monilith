"use client";

import { useSearchParams } from "next/navigation";
import { MembersTable, type Member } from "./members-table";
import { InvitePanel, type Invite } from "./invite-panel";
import { ActivityFeed, type AuditRow } from "./activity-feed";
import type { Database } from "@/types/database.types";
import { cn } from "@/lib/utils";

type Role = Database["public"]["Enums"]["org_role"];

const TABS = ["members", "invitations", "activity"] as const;
type Tab = (typeof TABS)[number];

export function OrgAdminConsole({
  orgId,
  members,
  invites,
  audit,
  currentUserId,
  currentUserRole,
}: {
  orgId: string;
  members: Member[];
  invites: Invite[];
  audit: AuditRow[];
  currentUserId: string;
  currentUserRole: Role;
}) {
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "")
    ? (raw as Tab)
    : "members";

  const select = (t: Tab) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", t);
    // History API only: no <Link>/router navigation, so the RSC does NOT
    // re-run and no server data is refetched (AGENTS.md §5 / spec §12).
    // Next 16 syncs pushState into useSearchParams(), re-rendering this client
    // component with the new tab from already-loaded props.
    window.history.pushState(null, "", `?${next.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div role="tablist" className="border-border flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors",
              "focus-visible:ring-ring/50 rounded-t-sm focus-visible:ring-2 focus-visible:outline-none",
              tab === t
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:border-border-hover border-transparent",
            )}
            onClick={() => select(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "members" && (
        <MembersTable
          orgId={orgId}
          members={members}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          mode="org"
        />
      )}
      {tab === "invitations" && <InvitePanel orgId={orgId} invites={invites} />}
      {tab === "activity" && <ActivityFeed rows={audit} />}
    </div>
  );
}

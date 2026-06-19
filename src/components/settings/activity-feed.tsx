const LABELS: Record<string, string> = {
  "member.invited": "invited",
  "member.invite_revoked": "revoked an invite",
  "member.role_changed": "changed a role",
  "member.removed": "removed a member",
  "member.password_reset": "sent a password reset",
  "member.deactivated": "deactivated a member",
  "member.reactivated": "reactivated a member",
  "org_admin.assigned": "assigned an org admin",
  "org_admin.revoked": "revoked an org admin",
  "platform.user_deactivated": "deactivated a user",
  "platform.user_reactivated": "reactivated a user",
};

export type AuditRow = {
  id: string;
  action: string;
  target_email: string | null;
  created_at: string;
};

export function ActivityFeed({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>;
  }
  return (
    <ul className="divide-border divide-y text-sm">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-3 py-2.5"
        >
          <span className="text-foreground min-w-0 truncate">
            {LABELS[r.action] ?? r.action}
            {r.target_email ? (
              <span className="text-muted-foreground"> · {r.target_email}</span>
            ) : null}
          </span>
          <time
            className="text-muted-foreground shrink-0 text-xs tabular-nums"
            dateTime={r.created_at}
          >
            {new Date(r.created_at).toLocaleString()}
          </time>
        </li>
      ))}
    </ul>
  );
}

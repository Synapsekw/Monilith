"use client";

import { revokeConnectionAction } from "@/lib/mcp/oauth/connections-actions";

type Connection = { id: string; clientName: string; createdAt: string };

export function ConnectedAppsSection({
  connections,
}: {
  connections: Connection[];
}) {
  if (connections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No apps connected via MCP yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {connections.map((c) => (
        <li
          key={c.id}
          className="flex items-center justify-between rounded-md border p-3"
        >
          <span>{c.clientName}</span>
          <form
            action={async () => {
              await revokeConnectionAction(c.id);
            }}
          >
            <button type="submit" className="text-destructive text-sm">
              Revoke
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

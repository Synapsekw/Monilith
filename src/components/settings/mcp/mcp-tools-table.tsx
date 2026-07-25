import { StatusPill } from "@/components/ui/status-pill";

/**
 * The tools a connected client can call.
 *
 * This list must stay in sync with the registrations in
 * `src/lib/mcp/tools/register.ts` — it is the user's only account of what they
 * are granting, so a tool added there without a row here understates the
 * access being approved.
 */
const TOOLS = [
  {
    name: "list_boards",
    access: "read",
    what: "List the boards you can see.",
  },
  {
    name: "get_board",
    access: "read",
    what: "Read a board's columns and groups.",
  },
  {
    name: "search_items",
    access: "read",
    what: "Find items by name within a board.",
  },
  {
    name: "get_item",
    access: "read",
    what: "Read one item's fields and values.",
  },
  {
    name: "create_item",
    access: "write",
    what: "Add a new item to a board.",
  },
  {
    name: "update_item",
    access: "write",
    what: "Change values on an existing item.",
  },
] as const;

export function McpToolsTable() {
  return (
    <div className="space-y-3 py-4">
      <ul className="border-border divide-border divide-y rounded-lg border">
        {TOOLS.map((tool) => (
          <li
            key={tool.name}
            className="flex items-center justify-between gap-4 px-3 py-2.5"
          >
            <div className="min-w-0">
              <code className="text-foreground font-mono text-xs">
                {tool.name}
              </code>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {tool.what}
              </p>
            </div>
            <StatusPill
              color={tool.access === "write" ? "blue" : "gray"}
              variant="soft"
            >
              {tool.access === "write" ? "Write" : "Read"}
            </StatusPill>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm">
        A connected client cannot delete anything — no delete tool exists on the
        server. Every call runs as you and is subject to the same permissions
        you have in the app.
      </p>
    </div>
  );
}

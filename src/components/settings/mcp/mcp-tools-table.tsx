import { StatusPill } from "@/components/ui/status-pill";

/**
 * The tools a connected client can call.
 *
 * Kept in sync with `src/lib/mcp/tools/register.ts` BY TEST
 * (`mcp-tools-table.test.tsx` compares this list against `MCP_TOOL_NAMES`).
 * This is the user's only account of what they are granting, so a registered
 * tool missing here understates the access being approved.
 */
export const MCP_TOOLS_TABLE_ROWS = [
  { name: "list_boards", access: "read", what: "List the boards you can see." },
  {
    name: "get_board",
    access: "read",
    what: "Read a board's metadata, columns, and groups.",
  },
  {
    name: "list_items",
    access: "read",
    what: "Read a board's items and their cell values.",
  },
  {
    name: "search_items",
    access: "read",
    what: "Find items by name within a board.",
  },
  {
    name: "get_item",
    access: "read",
    what: "Read one item's fields and cell values.",
  },
  {
    name: "create_item",
    access: "write",
    what: "Add a new item to a group, optionally setting field values.",
  },
  {
    name: "update_item",
    access: "write",
    what: "Rename an item and/or change its field values.",
  },
  {
    name: "list_organizations",
    access: "read",
    what: "List the organizations you belong to.",
  },
  {
    name: "get_my_work",
    access: "read",
    what: "Read everything assigned to you, grouped by due date.",
  },
  {
    name: "list_time_allocations",
    access: "read",
    what: "Read the time you have logged between two dates.",
  },
  {
    name: "get_time_summary",
    access: "read",
    what: "Read totals of your logged time, by item, category, or day.",
  },
  {
    name: "log_time_allocation",
    access: "write",
    what: "Set your logged time for a day and item or category — replaces any existing value for that day/target; 0 clears it.",
  },
  {
    name: "list_goals",
    access: "read",
    what: "Read your organization's goals and their hierarchy.",
  },
  {
    name: "get_goal",
    access: "read",
    what: "Read one goal's detail and a summary of its children.",
  },
  {
    name: "list_portfolios",
    access: "read",
    what: "List the portfolios you can see.",
  },
  {
    name: "get_portfolio",
    access: "read",
    what: "Read a portfolio's board rollup.",
  },
  {
    name: "list_dashboards",
    access: "read",
    what: "List the dashboards you can see.",
  },
  {
    name: "get_dashboard",
    access: "read",
    what: "Read a dashboard's widget list (not their data).",
  },
  {
    name: "get_widget_data",
    access: "read",
    what: "Read one widget's resolved data.",
  },
  {
    name: "get_workload",
    access: "read",
    what: "Read your team's planned load and capacity.",
  },
  {
    name: "list_reports",
    access: "read",
    what: "List a board's saved reports.",
  },
  {
    name: "get_report",
    access: "read",
    what: "Read a report's structure (not the underlying data).",
  },
] as const;

export function McpToolsTable() {
  return (
    <div className="space-y-3 py-4">
      <ul className="border-border divide-border divide-y rounded-lg border">
        {MCP_TOOLS_TABLE_ROWS.map((tool) => (
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

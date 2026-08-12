import { StatusPill } from "@/components/ui/status-pill";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/register";

/**
 * The tools a connected client can call.
 *
 * Kept in sync with `src/lib/mcp/tools/register.ts` BY TEST
 * (`mcp-tools-table.test.tsx` runs the REAL `registerTools` against a stub
 * server that records every `registerTool(name, …)` call, then compares the
 * recorded names against this list) — not by a second hand-maintained list,
 * which could drift in step with this one and still pass. This is the user's
 * only account of what they are granting, so a registered tool missing here
 * understates the access being approved.
 *
 * `access` is NOT hand-maintained — it is derived from the descriptor's
 * `capability`, so a new write tool cannot appear on the consent screen
 * labelled "read".
 */
const TOOL_PROSE: Record<string, string> = {
  list_boards: "List the boards you can see.",
  get_board: "Read a board's metadata, columns, and groups.",
  list_items: "Read a board's items and their cell values.",
  search_items: "Find items by name within a board.",
  get_item: "Read one item's fields and cell values.",
  create_item: "Add a new item to a group, optionally setting field values.",
  update_item: "Rename an item and/or change its field values.",
  create_attachment_upload:
    "Start a file upload for an item — returns a 2-hour signed URL that can place a file in your storage. Nothing appears on the item until attach_file is called.",
  attach_file:
    "Attach a file to an item, or into a Files column's cell. Cannot replace or remove an existing attachment.",
  list_organizations: "List the organizations you belong to.",
  get_my_work: "Read everything assigned to you, grouped by due date.",
  list_time_allocations: "Read the time you have logged between two dates.",
  get_time_summary:
    "Read totals of your logged time, by item, category, or day.",
  log_time_allocation:
    "Set your logged time for a day and item or category — replaces any existing value for that day/target; 0 clears it.",
  list_goals: "Read your organization's goals and their hierarchy.",
  get_goal: "Read one goal's detail and a summary of its children.",
  list_portfolios: "List the portfolios you can see.",
  get_portfolio: "Read a portfolio's board rollup.",
  list_dashboards: "List the dashboards you can see.",
  get_dashboard: "Read a dashboard's widget list (not their data).",
  get_widget_data: "Read one widget's resolved data.",
  get_workload: "Read your team's planned load and capacity.",
  list_reports:
    "List the saved reports that include a board — its own, plus any multi-board or portfolio roll-up covering it.",
  get_report:
    "Read a report's structure and which boards it spans (not the underlying data).",
};

export const MCP_TOOLS_TABLE_ROWS = ALL_TOOL_DESCRIPTORS.map((d) => ({
  name: d.name,
  access: d.capability === null ? ("read" as const) : ("write" as const),
  what: TOOL_PROSE[d.name] ?? "",
}));

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
        The only thing a connected client can erase is your logged time —
        setting a day&rsquo;s entry to 0 seconds clears it. Nothing else can be
        deleted: no other delete tool exists on the server. Every call runs as
        you and is subject to the same permissions you have in the app.
      </p>
    </div>
  );
}
